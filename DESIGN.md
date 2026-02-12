# TuneBoss Design Document

## Overview

TuneBoss is a real-time "now playing" display designed to run on an iPhone 12 Pro as a dedicated always-on screen mounted under a monitor. A Node.js/Express backend polls the Spotify Web API for the currently playing track, then pushes updates over Socket.io to a Vue 3 PWA frontend. The frontend renders album art, track metadata, a dynamic color theme extracted from the cover art, and a 10-band spectrum analyzer with procedurally generated visuals at 60 fps.

## Architecture

```
┌──────────────────────────────────┐
│  iPhone 12 Pro (Safari PWA)      │
│                                  │
│  Vue 3 + Vite SPA               │
│  ├─ Album art + color theming   │
│  ├─ Track info (title/artist)   │
│  ├─ 10-band spectrum analyzer   │
│  └─ Screen Wake Lock            │
└──────────┬───────────────────────┘
           │ Socket.io (WebSocket)
┌──────────▼───────────────────────┐
│  Node.js Backend (Express)       │
│                                  │
│  server/index.js ─ HTTP + WS     │
│  server/auth/spotify.js ─ OAuth  │
│  server/aggregator.js ─ Hub      │
│  server/providers/spotify.js     │
│          │                       │
└──────────┼───────────────────────┘
           │ HTTPS (polling every 3s)
┌──────────▼───────────────────────┐
│  Spotify Web API                 │
│  /me/player/currently-playing    │
└──────────────────────────────────┘
```

The backend owns all OAuth credentials and API secrets. The iPhone is a stateless display client — it receives data exclusively through Socket.io and never talks to Spotify directly.

## Server Components

### `server/index.js` — Entry point

Creates the Express app and HTTP server, attaches Socket.io with wildcard CORS, mounts Spotify OAuth routes, and serves the built Vue client from `client/dist/` as static files. A catch-all route implements SPA fallback (serves `index.html` for any path not starting with `/api/` or `/auth/`). Socket.io connection and disconnection events are delegated to the aggregator, which manages the Spotify polling lifecycle.

### `server/auth/spotify.js` — OAuth 2.0

Implements the Authorization Code flow:

1. `GET /auth/spotify` — Generates a random CSRF state token and redirects the user to Spotify's authorization page. Requests `user-read-currently-playing` and `user-read-playback-state` scopes.
2. `GET /auth/spotify/callback` — Exchanges the authorization code for access and refresh tokens using Basic auth (client ID + secret). Stores tokens in memory and persists them to `.tokens.json` on disk.
3. `GET /api/auth/status` — Returns `{ authenticated, expiresAt }` so the client can show the right UI state.

**Token persistence**: Tokens are saved to `.tokens.json` (gitignored) in the project root after every mutation — initial auth, refresh, and clear-on-failure. On startup, `loadTokens()` restores them from disk so the server can resume authenticated after a restart without requiring the user to re-authorize through the browser.

Token refresh happens transparently: `getValidAccessToken()` checks if the token expires within 60 seconds and calls Spotify's token endpoint with the refresh token if needed. If refresh fails, the access token is cleared, the file is updated, and the server logs the error.

### `server/providers/spotify.js` — Spotify polling

Polls `GET /me/player/currently-playing` every 3 seconds. Polling only runs while at least one Socket.io client is connected (managed by the aggregator). On each poll:

- **204 (no content)** or `is_playing === false` → emits `onPlaybackStopped` if a track was previously active.
- **Track change** (new `trackId`) → emits `onTrackUpdate` with `{ source, trackId, title, artist, album, albumArt, isPlaying, position, duration }`.
- **Same track** → emits `onPositionUpdate` with `{ position, duration }` for client-side time sync.

> **Note**: Spotify's `/audio-analysis/{trackId}` endpoint was deprecated in November 2024 and returns 403 for apps without prior usage. TuneBoss generates its spectrum visualization client-side instead (see `useAudioAnalysis.js` below).

### `server/aggregator.js` — Event hub

Sits between the Spotify provider and Socket.io. It:

- Wires up the provider callbacks (`onTrackUpdate`, `onPositionUpdate`, `onPlaybackStopped`) to corresponding `io.emit()` calls.
- Caches `currentTrack` so newly connected clients can be synced immediately via `syncClient(socket)`.
- Manages **client-gated polling**: tracks a `clientCount` and starts the Spotify provider when the first client connects, stops it when the last one disconnects. This avoids burning Spotify API quota when nobody is watching.

The aggregator pattern decouples providers from the transport layer, making it straightforward to add future providers (Qobuz, YouTube Music) without changing the Socket.io plumbing.

## Client Components

### `App.vue` — Root state and theming

Manages all application state as reactive refs:

| Ref | Type | Purpose |
|-----|------|---------|
| `connected` | `boolean` | Socket.io connection status |
| `authenticated` | `boolean` | Spotify auth status (fetched from `/api/auth/status`) |
| `track` | `object \| null` | Current track metadata |
| `playback` | `{ position, timestamp }` | Playback position + local timestamp for interpolation |
| `colors` | `{ bg, text }` | Dynamic theme colors from album art |

Connects to Socket.io on mount with WebSocket as the primary transport (falls back to long-polling), auto-reconnection (1s initial delay, 5s max, infinite attempts). Listens for `now-playing`, `playback-position`, and `playback-stopped` events.

Dynamic theming is driven by CSS custom properties (`--color-bg`, `--color-text`) with smooth transitions (1.5s on background, 1s on text color). The root `.tuneboss` container uses `100dvh` height and `env(safe-area-inset-*)` padding to handle the iPhone notch and Dynamic Island.

Four UI states: **playing** (NowPlaying component), **idle** (music note + "Nothing playing"), **unauthenticated** ("Connect Spotify" button), **connecting** (loading indicator).

### `NowPlaying.vue` — Layout container

A vertical flex column that composes AlbumArt, TrackInfo, and SpectrumAnalyzer. Includes a footer with a pulsing green dot and "Spotify" label to indicate the source.

### `AlbumArt.vue` — Cover art + color extraction

Displays the album art image at 320px square with 12px border radius and a box shadow. On image load, uses `node-vibrant` to extract the color palette:

- **Text color**: `Vibrant` swatch (fallback: `Muted`, then `DarkVibrant`)
- **Background color**: `DarkMuted` swatch (fallback: `DarkVibrant`), **darkened by 60%** (RGB multiplied by 0.4) to ensure sufficient contrast with the text

Emits `colors-extracted` up to App.vue. On track change, applies a 600ms fade-in animation via CSS keyframes.

### `TrackInfo.vue` — Metadata display

Presentational component showing title (1.5rem, bold, 2-line clamp), artist (1.1rem, 80% opacity, 1-line clamp), and album (0.85rem, 50% opacity, 1-line clamp).

### `SpectrumAnalyzer.vue` — Canvas renderer

Renders 10 vertical bars on a 340x100 canvas at 60 fps via `requestAnimationFrame`. High-DPI support scales the canvas by `devicePixelRatio`. Each bar has:

- **Width**: `(340 - 9 * 4px gaps) / 10 = ~30px`
- **Height**: `bands[i] * maxBarHeight` (clamped to min 2px)
- **Color**: green (`< 65%`), orange (`65-85%`), red (`> 85%`) based on height ratio
- **Glow**: `shadowBlur: 8` in the bar's color
- **Shape**: Rounded top corners (3px radius)
- **Peak indicator**: White 2px line at the peak position

### `useAudioAnalysis.js` — Synthetic spectrum composable

Generates procedural spectrum-analyzer visuals without any external audio analysis data. Spotify deprecated the `/audio-analysis` endpoint in November 2024, so TuneBoss produces its own visualization seeded deterministically from the Spotify track ID — each song gets a unique, consistent "personality". Inputs: `trackId` ref (string) and `playback` ref (position + timestamp). Outputs: reactive `bands[10]` and `peaks[10]` arrays (values 0 to 1).

**Per-track initialization:**

1. **Seed**: The track ID is hashed (`hashCode`) to produce a 32-bit integer seed.
2. **BPM**: A seeded PRNG (mulberry32) derives a plausible tempo in the 90–150 BPM range.
3. **Oscillators**: Each of the 10 bands gets 3 layered sinusoids with seeded frequencies (0.3–1.5 Hz), phases, and amplitude weights. This produces unique wave shapes per band per track.

**Per-frame pipeline (60 fps):**

1. **Position calculation**: `currentPosition = startPosition + (Date.now() - startTime) / 1000`. Interpolates smoothly between the 3-second server poll updates.
2. **Beat pulse**: A cosine wave at the derived BPM creates a pulsing envelope. Lower bands receive a stronger beat weight (40% at band 0, tapering to 0% at band 9), giving the visualization a bass-heavy rhythmic feel.
3. **Band computation**: Each band sums its 3 sine-wave layers (each producing values 0–1), then mixes in the beat pulse proportionally.
4. **Smoothing**: Exponential moving average with factor 0.25: `newBand = oldBand + (computed - oldBand) * 0.25`
5. **Peak tracking**: If a new value exceeds the current peak, the peak snaps to that value. Otherwise the peak decays by 0.015 per frame.

### `useWakeLock.js` — Screen wake lock composable

Keeps the iPhone screen on using a two-tier strategy:

1. **Native Wake Lock API** (primary): Requests `navigator.wakeLock.request('screen')` on mount. This works when the page is served over HTTPS or from localhost.
2. **Silent video fallback** (for HTTP on local network): When the Wake Lock API is unavailable (insecure context), a hidden 1×1 `<video>` element loops a tiny silent mp4 (`public/silence.mp4`, 482 bytes). iOS treats active video playback as a reason to keep the screen on. The video requires a user gesture to start on iOS, so the composable listens for the first `touchstart` or `click` event and retries playback.

Both strategies re-acquire on `visibilitychange` (iOS releases the wake lock when the tab is hidden). A 30-second `setInterval` periodically re-requests the lock as a guard against silent releases. Everything is cleaned up on unmount.

## Real-Time Communication Protocol

All real-time data flows through Socket.io over a single WebSocket connection.

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `now-playing` | server → client | `{ source, trackId, title, artist, album, albumArt, isPlaying, position, duration }` | Track change |
| `playback-position` | server → client | `{ position, duration }` | Every 3s poll |
| `playback-stopped` | server → client | *(empty)* | Playback paused or stopped |

**New client sync**: When a client connects, the aggregator immediately sends the current `now-playing` so the display populates instantly without waiting for the next poll cycle.

**Reconnection**: The client is configured with `reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`, and `reconnectionAttempts: Infinity`, so it will persistently try to reconnect after network interruptions.

## PWA and Always-On Display

**Web App Manifest** (`client/public/manifest.json`):
- `display: "fullscreen"` — no browser chrome when launched from the home screen
- `orientation: "portrait"` — locks to portrait on the iPhone
- `background_color` and `theme_color`: `#000000`

**iOS meta tags** (`client/index.html`):
- `apple-mobile-web-app-capable: yes` — enables standalone mode
- `apple-mobile-web-app-status-bar-style: black-translucent` — blends status bar with the app
- `viewport-fit=cover` with `env(safe-area-inset-*)` CSS — fills edge to edge including the notch area
- `user-scalable=no` — prevents accidental pinch-to-zoom

**Screen Wake Lock**: The `useWakeLock` composable keeps the display on indefinitely. Recommended to also enable iOS Guided Access (Settings → Accessibility → Guided Access) to lock the iPhone into TuneBoss and prevent accidental navigation.

## Design Decisions

| Decision | Rationale |
|---|---|
| **Token persistence to disk** | Saves tokens to `.tokens.json` so the server resumes authenticated after a restart. A flat JSON file is appropriate for a single-user appliance — no database needed. |
| **Client-gated polling** | Spotify polling only runs while at least one Socket.io client is connected. Avoids burning API quota when nobody is watching. |
| **Procedural spectrum (no audio analysis API)** | Spotify deprecated the `/audio-analysis` endpoint in November 2024 (returns 403 for new apps). Instead, TuneBoss generates per-track visuals using a seeded PRNG keyed on the Spotify track ID — each song gets a unique, deterministic "personality" with its own BPM and oscillator shapes, without any external dependency. |
| **Silent mp4 video for wake lock fallback** | The Screen Wake Lock API requires HTTPS, but the server runs on the local network over HTTP. A hidden looping silent video (`silence.mp4`, 482 bytes) tricks iOS into keeping the screen on. This is the standard fallback used by libraries like NoSleep.js. |
| **Aggregator pattern** | Decouples providers from the Socket.io transport. Adding a new music service means implementing a provider class and wiring it into the aggregator — no changes to the WebSocket layer. |
| **Canvas over SVG/DOM** | Canvas is GPU-accelerated and avoids DOM churn. Critical for smooth 60 fps animation on mobile hardware. |
| **3-second polling interval** | Spotify's rate limit is approximately 3,600 requests/hour. A 3-second interval uses ~1,200 requests/hour, well within limits while keeping the display responsive. |
| **node-vibrant on the client** | Color extraction runs after the image loads in the browser, avoiding server-side image decoding. The server doesn't need to fetch or process album art at all. |

## Deployment

TuneBoss is designed to run as a single Node.js process on a Raspberry Pi or NAS on the local network.

**Single process**: Express serves the API routes, Socket.io WebSocket connections, and the built Vue client from `client/dist/` — no separate web server needed.

**Process management**: Use pm2 for auto-restart on crashes and auto-start on boot:
```bash
pm2 start npm --name tuneboss -- start
pm2 startup && pm2 save
```

**Environment configuration** (`.env`):
```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://<pi-ip>:3000/auth/spotify/callback
PORT=3000
```

**Build pipeline**: `npm run install:all` installs both server and client dependencies. `npm run build:client` runs Vite to produce the optimized `client/dist/` bundle. `npm start` launches the production server.

## Future Work

- **Qobuz provider**: Integrate Qobuz's playback status API (or build a browser extension using the MediaSession API from the Qobuz web player).
- **YouTube Music provider**: Browser extension approach capturing MediaSession metadata from the YouTube Music web player.
- **Multi-provider priority**: Extend the aggregator to poll multiple providers and display whichever is currently active.
