import * as vscode from 'vscode';
import { Keychain } from './common/keychain';
import { TwitchServer, ITwitchServer } from './twitchServer';
import { arrayEquals } from './common/utils';
import { Log } from './common/logger';
import { webcrypto as crypto } from 'node:crypto';

interface SessionData {
  id: string;
  account?: {
    label?: string;
    displayName?: string;
    id: string;
  };
  scopes: string[];
  accessToken: string;
}

export enum AuthProviderType {
  twitch = 'twitch',
}

export class UriEventHandler
  extends vscode.EventEmitter<vscode.Uri>
  implements vscode.UriHandler {
  public handleUri(uri: vscode.Uri) {
    this.fire(uri);
  }
}

export class TwitchAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable {
  private readonly _sessionChangeEmitter =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private readonly _logger: Log;
  private readonly _twitchServer: ITwitchServer;
  private readonly _keychain: Keychain;
  private readonly _disposable: vscode.Disposable | undefined;

  private _getSessionsPromise: Promise<vscode.AuthenticationSession[]>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    uriHandler: UriEventHandler
  ) {

    const type = AuthProviderType.twitch;

    this._logger = new Log();

    this._keychain = new Keychain(this.context, `twitch.auth`, this._logger);

    this._twitchServer = new TwitchServer(
      this._logger,
      uriHandler,
      context.extension.extensionKind,
      context.extension.packageJSON
    );

    // Contains the current state of the sessions we have available.
    this._getSessionsPromise = this.readSessions().then((sessions) => {
      return sessions;
    });

    this._disposable = vscode.Disposable.from(
      vscode.authentication.registerAuthenticationProvider(
        type,
        this._twitchServer.friendlyName,
        this,
        { supportsMultipleAccounts: false }
      ),
      this.context.secrets.onDidChange(() => this.checkForUpdates())
    );
  }

  dispose() {
    this._disposable?.dispose();
  }

  get onDidChangeSessions() {
    return this._sessionChangeEmitter.event;
  }

  async getSessions(
    scopes?: string[]
  ): Promise<vscode.AuthenticationSession[]> {
    const sortedScopes = scopes?.sort() || [];
    this._logger.info(
      `Getting sessions for ${sortedScopes.length ? sortedScopes.join(',') : 'all scopes'
      }...`
    );
    const sessions = await this._getSessionsPromise;
    const finalSessions = sortedScopes.length
      ? sessions.filter((session) =>
        arrayEquals([...session.scopes].sort(), sortedScopes)
      )
      : sessions;

    this._logger.info(
      `Got ${finalSessions.length} sessions for ${sortedScopes?.join(',') ?? 'all scopes'
      }...`
    );
    return finalSessions;
  }

  private async checkForUpdates() {
    const previousSessions = await this._getSessionsPromise;
    this._getSessionsPromise = this.readSessions();
    const storedSessions = await this._getSessionsPromise;

    const added: vscode.AuthenticationSession[] = [];
    const removed: vscode.AuthenticationSession[] = [];

    storedSessions.forEach((session) => {
      const matchesExisting = previousSessions.some((s) => s.id === session.id);
      // Another window added a session to the keychain, add it to our state as well
      if (!matchesExisting) {
        this._logger.info('Adding session found in keychain');
        added.push(session);
      }
    });

    previousSessions.forEach((session) => {
      const matchesExisting = storedSessions.some((s) => s.id === session.id);
      // Another window has logged out, remove from our state
      if (!matchesExisting) {
        this._logger.info('Removing session no longer found in keychain');
        removed.push(session);
      }
    });

    if (added.length || removed.length) {
      this._sessionChangeEmitter.fire({ added, removed, changed: [] });
    }
  }

  private async readSessions(): Promise<vscode.AuthenticationSession[]> {
    let sessionData: SessionData[];
    try {
      this._logger.info('Reading sessions from keychain...');
      const storedSessions = await this._keychain.getToken();
      if (!storedSessions) {
        return [];
      }
      this._logger.info('Got stored sessions!');

      try {
        sessionData = JSON.parse(storedSessions);
      } catch (e) {
        await this._keychain.deleteToken();
        throw e;
      }
    } catch (e) {
      this._logger.error(`Error reading token: ${e}`);
      return [];
    }

    // TODO: eventually remove this Set because we should only have one session per set of scopes.
    const scopesSeen = new Set<string>();
    const sessionPromises = sessionData.map(async (session: SessionData) => {
      // For Twitch scope list, order doesn't matter so we immediately sort the scopes
      const scopesStr = [...session.scopes].sort().join(' ');
      if (scopesSeen.has(scopesStr)) {
        return undefined;
      }
      let userInfo: { id: string; accountName: string } | undefined;
      if (!session.account) {
        try {
          userInfo = await this._twitchServer.getUserInfo(session.accessToken);
          this._logger.info(
            `Verified session with the following scopes: ${scopesStr}`
          );
        } catch (e: any) {
          // Remove sessions that return unauthorized response
          if (e.message === 'Unauthorized') {
            return undefined;
          }
        }
      }

      this._logger.trace(
        `Read the following session from the keychain with the following scopes: ${scopesStr}`
      );
      scopesSeen.add(scopesStr);
      return {
        id: session.id,
        account: {
          label: session.account
            ? session.account.label ??
            session.account.displayName ??
            '<unknown>'
            : userInfo?.accountName ?? '<unknown>',
          id: session.account?.id ?? userInfo?.id ?? '<unknown>',
        },
        // we set this to session.scopes to maintain the original order of the scopes requested
        // by the extension that called getSession()
        scopes: session.scopes,
        accessToken: session.accessToken,
      };
    });

    const verifiedSessions = (await Promise.allSettled(sessionPromises))
      .filter((p) => p.status === 'fulfilled')
      .map(
        (p) =>
          (
            p as PromiseFulfilledResult<
              vscode.AuthenticationSession | undefined
            >
          ).value
      )
      .filter(<T>(p?: T): p is T => Boolean(p));

    this._logger.info(`Got ${verifiedSessions.length} verified sessions.`);
    if (verifiedSessions.length !== sessionData.length) {
      await this.storeSessions(verifiedSessions);
    }

    return verifiedSessions;
  }

  private async storeSessions(
    sessions: vscode.AuthenticationSession[]
  ): Promise<void> {
    this._logger.info(`Storing ${sessions.length} sessions...`);
    this._getSessionsPromise = Promise.resolve(sessions);
    await this._keychain.setToken(JSON.stringify(sessions));
    this._logger.info(`Stored ${sessions.length} sessions!`);
  }

  public async createSession(
    scopes: string[]
  ): Promise<vscode.AuthenticationSession> {
    try {
      // For Twitch scope list, order doesn't matter so we use a sorted scope to determine
      // if we've got a session already.
      const sortedScopes = [...scopes].sort();
      let clientId = '<Please provide your own clientId in the scopes array>';
      if (sortedScopes.length > 0) {
        const clientIdScope = scopes.find(n => n.startsWith('TWITCH_CLIENT_ID:')) ?? '';
        clientId = clientIdScope.slice(17); if (!clientId.length) { throw new Error('The extension attempting to sign in with Twitch needs to provide a Client Id'); }
      }

      // Don't send the Twitch Auth Provider custom scopes to the login flow for Twitch API
      const filteredScopes = scopes.filter(n => !n.startsWith('TWITCH_'));
      const scopeString = filteredScopes.join(' ');
      const token = await this._twitchServer.login(scopeString, clientId);
      if (!token) {
        throw new Error('There was an issue retrieving an access token');
      }
      const session = await this.tokenToSession(token, scopes);

      const sessions = await this._getSessionsPromise;
      const sessionIndex = sessions.findIndex(
        (s) =>
          s.id === session.id || arrayEquals([...s.scopes].sort(), sortedScopes)
      );
      if (sessionIndex > -1) {
        sessions.splice(sessionIndex, 1, session);
      } else {
        sessions.push(session);
      }
      await this.storeSessions(sessions);

      this._sessionChangeEmitter.fire({
        added: [session],
        removed: [],
        changed: [],
      });

      this._logger.info('Login success!');

      return session;
    } catch (e: any) {
      // If login was cancelled, do not notify user.
      if (e === 'Cancelled' || e.message === 'Cancelled') {
        throw e;
      }

      vscode.window.showErrorMessage(
        vscode.l10n.t('Sign in failed: {0}', `${e}`)
      );
      this._logger.error(e);
      throw e;
    }
  }

  private async tokenToSession(
    token: string,
    scopes: string[]
  ): Promise<vscode.AuthenticationSession> {
    const userInfo = await this._twitchServer.getUserInfo(token);
    // From Twitch Docs:
    // Claim "sub" is the value of the User's ID on Twitch (ex: 12345678)
    // Claim "preferred_username" is the value of the User's display name on Twitch (ex: clarkio)
    return {
      id: crypto
        .getRandomValues(new Uint32Array(2))
        .reduce((prev: any, curr: any) => (prev += curr.toString(16)), ''),
      accessToken: token,
      account: { label: userInfo.accountName, id: userInfo.id },
      scopes,
    };
  }

  public async removeSession(id: string) {
    try {
      this._logger.info(`Logging out of ${id}`);
      this._logger.info(`Just testing real quick`);

      const sessions = await this._getSessionsPromise;
      const sessionIndex = sessions.findIndex((session) => session.id === id);
      if (sessionIndex > -1) {
        const session = sessions[sessionIndex];
        sessions.splice(sessionIndex, 1);

        await this.storeSessions(sessions);

        this._sessionChangeEmitter.fire({
          added: [],
          removed: [session],
          changed: [],
        });
      } else {
        this._logger.error('Session not found');
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Sign out failed: {0}', `${e}`)
      );
      this._logger.error(e);
      throw e;
    }
  }
}
