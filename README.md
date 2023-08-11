<div align="center">

# Twitch Authentication Provider for VS Code

[![Known Vulnerabilities](https://snyk.io/test/github/clarkio/vscode-authentication-twitch/badge.svg)](https://snyk.io/test/github/clarkio/vscode-authentication-twitch)
[![Discord](https://img.shields.io/discord/421902136457035777)](https://discord.gg/xB95beJ)
[![Twitch Status](https://img.shields.io/twitch/status/clarkio)](https://twitch.tv/clarkio)

<!-- [![Build and Test](https://github.com/clarkio/vscode-authentication-twitch/actions/workflows/ci-pipeline.yml/badge.svg?branch=main)](https://github.com/clarkio/vscode-authentication-twitch/actions/workflows/ci-pipeline.yml) -->

[![Twitter Follow](https://img.shields.io/twitter/follow/_clarkio?style=social)](https://twitter.com/intent/follow?screen_name=_clarkio)

</div>

An extension that enables OAuth implicit flow with Twitch from Visual Studio Code. It can be depended upon from other extensions and enable your users to authorize access to their Twitch account for your extension.

## Clarkio

This VS Code extension was built with 💙 live on stream with the programming community. Come and hang out with us over on Twitch and YouTube!

> https://twitch.tv/clarkio

> https://youtube.com/clarkio

## Prerequisites/Requirements

- Need to create an app for your extension in the [Twitch Dev Console](https://dev.twitch.tv/console/apps)
  - In the management view of your app in the Twitch Dev console be sure to add `http://localhost:40475/` (\*note the trailing `/` ) to your OAuth Redirect URLs
- Get the Client ID string that Twitch provides for your application and save it somewhere. You will need it later in your extension code.

## Getting Started

1. Update your extension `package.json` with the following:
   ```json
   "extensionDependencies": [
     "clarkio.vscode-twitch-authprovider"
   ],
   ```
2. Then to initiate an authenticated session in your extension you'll need to use the following code:
   ```javascript
   const twitchSession = await vscode.authentication.getSession(
     "twitch", // Always use this as it identifies the authentication provider to use
     ["TWITCH_CLIENT_ID:<your-client-id>", "chat:read", "chat:edit"], // The Twitch API scopes you wish to request permission for from the user.
     { createIfNone: true } // An option that will create a new session if one isn't already found
   );
   ```
   > ⚠ As part of the scopes you need to provide your Twitch App Client ID as a separate "scope" using the following convention: "TWITCH_CLIENT_ID:\<your-client-id>" ⚠
3. After you have successfully create an authenticated session `twitchSession` will consist of the following that you can use how you choose:
   ```json
   {
     "id": "A string of a unique identifier for the authenticated session",
     "accessToken": "A string representing the Twitch provided token for the user that authorized your extension/app",
     "account": {
       "id": "A string of a unique identifier for the user account",
       "label": "A string of the human readable user name"
     },
     "scopes": "An array of strings for the scopes associated with the authenticated session"
   }
   ```

## Licenses

- The software code is licensed under the MIT License.
- Some software code is adapted from Microsoft's GitHub Authentication provider Visual Studio Code extension and is licensed under the MIT License as well. See the `licenses/LICENSE-MIT-Microsoft` file and the `NOTICE` file for more details.
- The account-cowboy-hat image used in this project is licensed under the Apache License 2.0. See the `licenses/LICENSE-APACHE` file and the `NOTICE` file for more details.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md)
