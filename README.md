# Among Demons Steam Wrapper

This folder is a separate Git repo for the Electron Steam wrapper.

Remote:

```sh
git remote add origin https://github.com/amongdemons-com/steam
```

The shared frontend source comes from `../app`. For development, Electron loads `../app/index.html` directly. For production packaging, Electron Builder includes `../app` in the packaged app resources under `resources/frontend/app` at build time, so there is no persistent copied frontend folder in this repo.

The browser website keeps using relative API calls under `/api`. This Steam wrapper resolves those same frontend API calls to `https://amongdemons.com/api`.

The Windows build output under `dist/` can later be uploaded to Steamworks.

## Setup

```sh
git init
git remote add origin https://github.com/amongdemons-com/steam
npm install
npm run steam:build:win
```

## Scripts

```sh
npm run steam:dev
npm run steam:prepare
npm run steam:build:win
```

`npm run steam:prepare` verifies that `../app/index.html` and the local Electron dependencies are present. `npm run steam:build:win` packages the current `../app` contents into the Windows build output under `dist/`, which can later be uploaded to Steamworks.
