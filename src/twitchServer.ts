import * as vscode from 'vscode';
import { env } from 'vscode';
import * as path from 'path';
import { PromiseAdapter, promiseFromEvent } from './common/utils';
import { AuthProviderType, UriEventHandler } from './twitchAuthenticationProvider';
import { Log } from './common/logger';
import { isSupportedClient } from './common/env';
import { LoopbackAuthServer } from './authServer';
import { webcrypto as crypto } from 'node:crypto';
import fetch from 'node-fetch';
import { webcrypto } from 'crypto';
const fetching = fetch;

const CLIENT_ID = '5thawqf7lsbw8alj87gbcaial7mi3e';

export enum TwitchKeys {
  "clientId" = "5thawqf7lsbw8alj87gbcaial7mi3e",
  "scope" = "user:read:email",
}
const TWITCH_TOKEN_URL =
  'https://id.twitch.tv/oauth2/validate';

// This is the error message that we throw if the login was cancelled for any reason. Extensions
// calling `getSession` can handle this error to know that the user cancelled the login.
const CANCELLATION_ERROR = 'Cancelled';
// These error messages are internal and should not be shown to the user in any way.
const TIMED_OUT_ERROR = 'Timed out';
const USER_CANCELLATION_ERROR = 'User Cancelled';
const NETWORK_ERROR = 'network error';

const REDIRECT_URL_STABLE = 'https://vscode.dev/redirect';
const REDIRECT_URL_INSIDERS = 'https://insiders.vscode.dev/redirect';

export interface ITwitchServer {
  login(scopes: string): Promise<string>;
  getUserInfo(token: string): Promise<{ id: string; accountName: string }>;
  friendlyName: string;
}

export class TwitchServer implements ITwitchServer {
  readonly friendlyName: string;

  private readonly _pendingNonces = new Map<string, string[]>();
  private readonly _codeExchangePromises = new Map<
    string,
    { promise: Promise<string>; cancel: vscode.EventEmitter<void> }
  >();

  private _redirectEndpoint: string | undefined;

  constructor(
    private readonly _logger: Log,
    private readonly _uriHandler: UriEventHandler,
    private readonly _extensionKind: vscode.ExtensionKind,
    private readonly _packageJSON: any
  ) {
    this.friendlyName = 'Twitch';
  }

  get baseUri() {
    return vscode.Uri.parse('https://id.twitch.tv');
  }

  private async getRedirectEndpoint(): Promise<string> {
    if (this._redirectEndpoint) {
      return this._redirectEndpoint;
    }
    this._redirectEndpoint = 'http://localhost:40475/';
    return this._redirectEndpoint;
  }

  public async login(scopes: string): Promise<string> {
    this._logger.info(`Logging in for the following scopes: ${scopes}`);

    // Used for showing a friendlier message to the user when the explicitly cancel a flow.
    let userCancelled: boolean | undefined;
    const yes = vscode.l10n.t('Yes');
    const no = vscode.l10n.t('No');
    const promptToContinue = async (mode: string) => {
      if (userCancelled === undefined) {
        // We haven't had a failure yet so wait to prompt
        return;
      }
      const message = userCancelled
        ? vscode.l10n.t(
          'Having trouble logging in? Would you like to try a different way? ({0})',
          mode
        )
        : vscode.l10n.t(
          'You have not yet finished authorizing this extension to use Twitch. Would you like to try a different way? ({0})',
          mode
        );
      const result = await vscode.window.showWarningMessage(message, yes, no);
      if (result !== yes) {
        throw new Error(CANCELLATION_ERROR);
      }
    };

    const publisher = this._packageJSON.publisher;
    const name = this._packageJSON.name;
    // return `${env.uriScheme}://${publisher}.${name}`;
    const nonce: string = crypto
      .getRandomValues(new Uint32Array(2))
      .reduce((prev, curr) => (prev += curr.toString(16)), '');
    const callbackUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(
        `${vscode.env.uriScheme
        }://${publisher}.${name}/did-authenticate?nonce=${encodeURIComponent(
          nonce
        )}`
      )
    );

    // const supportedClient = isSupportedClient(callbackUri);
    // if (supportedClient) {
    //   try {
    //     return await this.doLoginWithoutLocalServer(scopes, nonce, callbackUri);
    //   } catch (e: any) {
    //     this._logger.error(e);
    //     userCancelled = e.message ?? e === USER_CANCELLATION_ERROR;
    //   }
    // }

    // Starting a local server is only supported if:
    // 1. We are in a UI extension because we need to open a port on the machine that has the browser
    // 2. We are in a node runtime because we need to open a port on the machine
    // 3. code exchange can only be done with a supported target
    // TODO: Figure out why this extension results in a Kind equal to 2 instead of 1
    // which results in the commented out logic to not be satisfied. Therefore it won't attempt login
    if (
      //this._extensionKind === vscode.ExtensionKind.UI &&
      typeof navigator === 'undefined'
    ) {
      try {
        await promptToContinue(vscode.l10n.t('local server'));
        return await this.doLoginWithLocalServer(scopes);
      } catch (e: any) {
        userCancelled = this.processLoginError(e);
      }
    }

    throw new Error(
      userCancelled ? CANCELLATION_ERROR : 'No auth flow succeeded.'
    );
  }

  private async doLoginWithLocalServer(scopes: string): Promise<string> {
    this._logger.info(`Trying with local server... (${scopes})`);
    return await vscode.window.withProgress<string>(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t({
          message: 'Signing in to {0}...',
          args: [this.baseUri.authority],
          comment: ['The {0} will be a url, e.g. twitch.com'],
        }),
        cancellable: true,
      },
      async (_, token) => {
        const redirectUri = await this.getRedirectEndpoint();
        const searchParams = new URLSearchParams([
          ['client_id', CLIENT_ID],
          ['redirect_uri', redirectUri],
          ['response_type', 'token'],
          ['scope', scopes],
          ['force_verify', 'true'],
          ['claims', JSON.stringify({ userinfo: { preferred_username: null } })]
        ]);

        const loginUrl = this.baseUri.with({
          path: '/oauth2/authorize',
          query: searchParams.toString(),
        });
        const server = new LoopbackAuthServer(
          path.join(__dirname, './login'),
          loginUrl.toString(true)
        );
        const port = await server.start();

        let accessTokenData;
        try {
          vscode.env.openExternal(
            vscode.Uri.parse(
              `http://127.0.0.1:${port}/signin?nonce=${encodeURIComponent(
                server.nonce
              )}`
            )
          );
          accessTokenData = await Promise.race([
            server.waitForOAuthResponse(),
            new Promise<any>((_, reject) =>
              setTimeout(() => reject(TIMED_OUT_ERROR), 300_000)
            ), // 5min timeout
            promiseFromEvent<any, any>(
              token.onCancellationRequested,
              (_, __, reject) => {
                reject(USER_CANCELLATION_ERROR);
              }
            ).promise,
          ]);
        } finally {
          setTimeout(() => {
            void server.stop();
          }, 5000);
        }
        return accessTokenData.accessToken;
      }
    );
  }

  private getServerUri(path: string = '') {
    const apiUri = this.baseUri;
    return vscode.Uri.parse(
      `${apiUri.scheme}://${apiUri.authority}`
    ).with({ path });
  }

  public async getUserInfo(
    token: string
  ): Promise<{ id: string; accountName: string }> {
    let result;
    // GET https://id.twitch.tv/oauth2/userinfo
    // -H 'Content-Type: application/json'
    // -H 'Authorization: Bearer <token>'
    try {
      this._logger.info('Getting user info...');
      result = await fetching(this.getServerUri('/oauth2/userinfo').toString(), {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': `${vscode.env.appName} (${vscode.env.appHost})`,
        },
      });
    } catch (ex: any) {
      this._logger.error(ex.message);
      throw new Error(NETWORK_ERROR);
    }
    /* Response example:
    {
      "aud": "<client-id>",
      "exp": 1644342250,
      "iat": 1644341350,
      "iss": "https://id.twitch.tv/oauth2",
      "sub": "12345678", // Twitch User ID
      "email": "foo@justin.tv", // Twitch Email
      "email_verified": true,
      "picture": "https://static-cdn.jtvnw.net/user-default-pictures-uv/998f01ae-def8-11e9-b95c-784f43822e80-profile_image-150x150.png",
      "updated_at": "2022-02-03T16:16:16.968509Z"
    }
    */
    if (result.ok) {
      try {
        const json: any = await result.json();
        this._logger.info('Got account info!');
        return { id: json.sub, accountName: json.preferred_username };
      } catch (e: any) {
        this._logger.error(
          `Unexpected error parsing response from Twitch: ${e.message ?? e}`
        );
        throw e;
      }
    } else {
      // either display the response message or the http status text
      let errorMessage = result.statusText;
      try {
        const json: any = await result.json();
        if (json.message) {
          errorMessage = json.message;
        }
      } catch (err) {
        // noop
      }
      this._logger.error(`Getting account info failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  // Used if you're following the OIDC authorization code grant flow
  private async exchangeCodeForToken(code: string): Promise<string> {
    this._logger.info('Exchanging code for token...');
    // Call Twitch API to exchange code for token
    /*
    client_id=hof5gwx0su6owfnys0yan9c87zr6t
    &client_secret=41vpdji4e9gif29md0ouet6fktd2
    &code=gulfwdmys5lsm6qyz4xiz9q32l10
    &grant_type=authorization_code
    &redirect_uri=http://localhost:3000
    */

    const proxyEndpoints: { [providerId: string]: string } | undefined =
      await vscode.commands.executeCommand(
        'workbench.getCodeExchangeProxyEndpoints'
      );
    const endpointUrl = proxyEndpoints?.twitch
      ? `${proxyEndpoints.twitch}login/oauth/access_token`
      : TWITCH_TOKEN_URL;

    const body = new URLSearchParams([['code', code]]);

    const result = await fetching(endpointUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.toString(),
      },
      body: body.toString(),
    });

    if (result.ok) {
      const json: any = await result.json();
      this._logger.info('Token exchange success!');
      return json.access_token;
    } else {
      const text = await result.text();
      const error = new Error(text);
      error.name = 'TwitchTokenExchangeError';
      throw error;
    }
  }

  private processLoginError(error: Error): boolean {
    if (error.message === CANCELLATION_ERROR) {
      throw error;
    }
    this._logger.error(error.message ?? error);
    return error.message === USER_CANCELLATION_ERROR;
  }

  public static async validateToken(token: string) {
    // https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/#validating-an-id-token
    const url = `https://id.twitch.tv/oauth2/validate`;
    const result = await new Promise<{ valid: boolean, login: string }>(async (resolve, reject) => {
      try {
        const validateResult = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (validateResult.ok) {
          const json = await validateResult.json();
          resolve({ valid: true, login: json.login });
        } else {
          resolve({ valid: false, login: '' });
        }
      } catch (e: any) {
        reject(e);
      }
    });

    return result;
  }

  private handleUri: (scopes: string) => PromiseAdapter<vscode.Uri, string> =
    (scopes) => (uri, resolve, reject) => {
      const query = new URLSearchParams(uri.query);
      const code = query.get('code');
      const nonce = query.get('nonce');
      const state = query.get('state');
      if (!code) {
        reject(new Error('No code'));
        return;
      }
      if (!nonce) {
        reject(new Error('No nonce'));
        return;
      }

      const acceptedNonces = this._pendingNonces.get(scopes) || [];
      if (!acceptedNonces.includes(nonce)) {
        // A common scenario of this happening is if you:
        // 1. Trigger a sign in with one set of scopes
        // 2. Before finishing 1, you trigger a sign in with a different set of scopes
        // In this scenario we should just return and wait for the next UriHandler event
        // to run as we are probably still waiting on the user to hit 'Continue'
        this._logger.info(
          'Nonce not found in accepted nonces. Skipping this execution...'
        );
        return;
      }

      resolve(this.exchangeCodeForToken(code));
    };

  // private async doLoginWithoutLocalServer(
  //   scopes: string,
  //   nonce: string,
  //   callbackUri: vscode.Uri
  // ): Promise<string> {
  //   this._logger.info(`Trying without local server... (${scopes})`);
  //   return await vscode.window.withProgress<string>(
  //     {
  //       location: vscode.ProgressLocation.Notification,
  //       title: vscode.l10n.t({
  //         message: 'Signing in to {0}...',
  //         args: [this.baseUri.authority],
  //         comment: ['The {0} will be a url, e.g. twitch.com'],
  //       }),
  //       cancellable: true,
  //     },
  //     async (_, token) => {
  //       const existingNonces = this._pendingNonces.get(scopes) || [];
  //       this._pendingNonces.set(scopes, [...existingNonces, nonce]);
  //       const redirectUri = await this.getRedirectEndpoint();
  //       const searchParams = new URLSearchParams([
  //         ['client_id', CLIENT_ID],
  //         ['redirect_uri', redirectUri],
  //         ['response_type', 'code'],
  //         ['scope', TwitchKeys.scope],
  //         ['force_verify', 'false'],
  //         ['state', encodeURIComponent(callbackUri.toString(true))],
  //       ]);

  //       const uri = vscode.Uri.parse(
  //         this.baseUri
  //           .with({
  //             path: '/oauth2/authorize',
  //             query: searchParams.toString(),
  //           })
  //           .toString(true)
  //       );
  //       await vscode.env.openExternal(uri);

  //       // Register a single listener for the URI callback, in case the user starts the login process multiple times
  //       // before completing it.
  //       let codeExchangePromise = this._codeExchangePromises.get(scopes);
  //       if (!codeExchangePromise) {
  //         codeExchangePromise = promiseFromEvent(
  //           this._uriHandler!.event,
  //           this.handleUri(scopes)
  //         );
  //         this._codeExchangePromises.set(scopes, codeExchangePromise);
  //       }

  //       try {
  //         return await Promise.race([
  //           codeExchangePromise.promise,
  //           new Promise<string>((_, reject) =>
  //             setTimeout(() => reject(TIMED_OUT_ERROR), 300_000)
  //           ), // 5min timeout
  //           promiseFromEvent<any, any>(
  //             token.onCancellationRequested,
  //             (_, __, reject) => {
  //               reject(USER_CANCELLATION_ERROR);
  //             }
  //           ).promise,
  //         ]);
  //       } finally {
  //         this._pendingNonces.delete(scopes);
  //         codeExchangePromise?.cancel.fire();
  //         this._codeExchangePromises.delete(scopes);
  //       }
  //     }
  //   );
  // }
}
