import * as vscode from 'vscode';
import { Log } from './logger';

export class Keychain {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly serviceId: string,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private readonly Logger: Log
  ) { }

  async setToken(token: string): Promise<void> {
    try {
      return await this.context.secrets.store(this.serviceId, token);
    } catch (e) {
      // Ignore
      this.Logger.error(`Setting token failed: ${e}`);
    }
  }

  async getToken(): Promise<string | null | undefined> {
    try {
      // secretlint-disable
      const secret = await this.context.secrets.get(this.serviceId);
      if (secret && secret !== '[]') {
        this.Logger.trace('Token acquired from secret storage.');
      }
      return secret;
      // secretlint-enable
    } catch (e) {
      // Ignore
      this.Logger.error(`Getting token failed: ${e}`);
      return Promise.resolve(undefined);
    }
  }

  async deleteToken(): Promise<void> {
    try {
      return await this.context.secrets.delete(this.serviceId);
    } catch (e) {
      // Ignore
      this.Logger.error(`Deleting token failed: ${e}`);
      return Promise.resolve(undefined);
    }
  }
}
