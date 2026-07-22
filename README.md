# Among Demons

A minimal Electron app that opens [amongdemons.com/camp](https://amongdemons.com/camp) in a borderless full-display desktop window. Press Escape to open the Steam-only exit confirmation.

The Windows wrapper deliberately uses borderless windowed mode instead of
native fullscreen. Affected Windows 11 builds can leave a new ghost thumbnail
in the Alt+Tab switcher each time a Chromium/Electron fullscreen window loses
focus. A frameless window covers the full display and is raised above the
taskbar only while focused, preserving the game presentation without triggering
that compositor bug or blocking other applications after Alt+Tab.

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

The wrapper also enables steamworks.js's Electron overlay compatibility mode
before creating its window. This keeps Chromium's GPU rendering hookable and
forces continuous frame invalidation so Shift+Tab works even when the page is
visually idle.

### Development

`steam_appid.txt` in the project root tells the SDK which app to impersonate during `npm start`. It currently contains `480` (Spacewar, Valve's public test app). Once the real Among Demons app id exists, update both this file and `STEAM_APP_ID` in `main.js`, and replace the placeholder achievement whitelist.
