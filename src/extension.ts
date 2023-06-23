// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TwitchAuthenticationProvider, UriEventHandler } from './twitchAuthenticationProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log("Twitch Auth Provider Activated");
	const uriHandler = new UriEventHandler();
	context.subscriptions.push(uriHandler);
	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

	const twitchAuthProvider = new TwitchAuthenticationProvider(context, uriHandler);
	context.subscriptions.push(twitchAuthProvider);
	getSession();

	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions(async e => {
			getSession();
		})
	);
}

const getSession = async () => {
	const session = await vscode.authentication.getSession("twitch", [], { createIfNone: false });
	if (session) {
		vscode.window.showInformationMessage(`You are signed into Twitch as ${session.account.label}`)
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
