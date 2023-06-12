import * as vscode from 'vscode';

export class Log {
  private output: vscode.LogOutputChannel;

  constructor() {
    const friendlyName = 'Twitch';
    this.output = vscode.window.createOutputChannel(
      `${friendlyName} Authentication`,
      { log: true }
    );
  }

  public trace(message: string): void {
    this.output.trace(message);
  }

  public info(message: string): void {
    this.output.info(message);
  }

  public error(message: string): void {
    this.output.error(message);
  }
}
