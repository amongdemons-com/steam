# Among Demons

A minimal Electron app that opens [amongdemons.com/camp](https://amongdemons.com/camp) in a fullscreen desktop window. Press Escape to open the Steam-only exit confirmation.

## Run locally

```sh
npm install
npm start
```

## Build for Windows

```sh
npm run build
```

The installer and unpacked application are written to `dist/`.

## Steam integration

The wrapper connects to the running Steam client via [steamworks.js](https://github.com/ceifa/steamworks.js) and exposes `window.steamBridge` to the game page:

- `steamBridge.isSteam` — `true` when running inside the wrapper.
- `steamBridge.getAuthTicket()` — resolves to a hex auth ticket for the backend to validate with `ISteamUserAuth/AuthenticateUserTicket` (identity: `amongdemons`), or `null` when Steam is unavailable.
- `steamBridge.unlockAchievement(name)` — triggers the local achievement toast; only names whitelisted in `ACHIEVEMENT_NAMES` (main.js) are accepted.

If Steam is not running (or the app is launched outside Steam), the wrapper still works — the bridge calls just return `null`/`false`.

### Development

`steam_appid.txt` in the project root tells the SDK which app to impersonate during `npm start`. It currently contains `480` (Spacewar, Valve's public test app). Once the real Among Demons app id exists, update both this file and `STEAM_APP_ID` in `main.js`, and replace the placeholder achievement whitelist.
