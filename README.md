# STGTIME

STGTIME is a self-contained stage timer for Raspberry Pi 4, a 64×32 P3 HUB75 RGB matrix, and a native USB Stream Deck. It provides countdown, stopwatch, presets, three configurable warning colors, optional negative overtime and blinking, an NTP-backed clock, short messages, a pixel-exact web preview, and a documented REST API.

The Web GUI is mobile-first and responsive, with no frontend build step. The service itself has no npm runtime dependencies; only the optional Stream Deck sidecar installs native Node packages.

Published GitHub releases can be checked and installed from the Web GUI. STGTIME also accepts an offline release upload, keeps persistent configuration outside the application release, and automatically rolls back when the updated service fails its startup health check. See [docs/UPDATES.md](docs/UPDATES.md).

## Development simulator

```sh
STGTIME_DISPLAY_DRIVER=simulator npm start
```

On PowerShell, use `$env:STGTIME_DISPLAY_DRIVER='simulator'; npm start`. Open `http://localhost:8080` and sign in with `stagetimer`. The framebuffer endpoint refreshes at 2 Hz in the UI. Run tests with `npm test`.

The Bitfocus Companion module is maintained as a separate project. It provides timer, preset, message, generic video, and display actions plus live feedbacks and variables through the authenticated STGTIME API.

See [installation](docs/INSTALL.md), [hardware](docs/HARDWARE.md), [API](docs/API.md), and [architecture](docs/ARCHITECTURE.md).
