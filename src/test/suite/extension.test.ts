import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { describe, it } from 'mocha';
const packageJSON = require('../../../package.json');

describe('Extension', async () => {
	// it('should be able to activate', async (done) => {
	// 	console.log(`${packageJSON.publisher}.${packageJSON.name}`);
	// 	await vscode.extensions.getExtension(`${packageJSON.publisher}.${packageJSON.name}`)?.activate();
	// 	assert.ok(vscode.extensions.getExtension(`${packageJSON.publisher}.${packageJSON.name}`)?.isActive);
	// 	done();
	// });

	// it('should call vscode.authentication.getSession with "twitch" when the extension is activated', async (done) => {
	// 	const getSessionSpy = sinon.spy(vscode.authentication, 'getSession');
	// 	await vscode.extensions.getExtension(`${packageJSON.publisher}.${packageJSON.name}`)?.activate();
	// 	console.log(getSessionSpy);
	// 	assert.ok(getSessionSpy.calledWith("twitch"));
	// 	getSessionSpy.restore();
	// 	done();
	// });
});
