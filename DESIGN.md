# TuneBoss Design Document

## Overview

TuneBoss is a real-time "now playing" display designed to run on an iPhone 12 Pro as a dedicated always-on screen mounted under a monitor. A Node.js/Express backend polls the Spotify Web API for the currently playing track and its audio analysis data, then pushes updates over Socket.io to a Vue 3 PWA frontend. The frontend renders album art, track metadata, a dynamic color theme extracted from the cover art, and a 10-band spectrum analyzer driven by Spotify's per-segment pitch and loudness data at 60 fps.

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
│  /audio-analysis/{trackId}       │
└──────────────────────────────────┘
```

The backend owns all OAuth credentials and API secrets. The iPhone is a stateless display client — it receives data exclusively through Socket.io and never talks to Spotify directly.

## Server Components

### `server/index.js` — Entry point

Creates the Express app and HTTP server, attaches Socket.io with wildcard CORS, mounts Spotify OAuth routes, and serves the built Vue client from `client/dist/` as static files. A catch-all route implements SPA fallback (serves `index.html` for any path not starting with `/api/` or `/auth/`). On startup, it enters a 2-second polling loop waiting for Spotify authentication before starting the aggregator.

### `server/auth/spotify.js` — OAuth 2.0

Implements the Authorization Code flow:

1. `GET /auth/spotify` — Generates a random CSRF state token and redirects the user to Spotify's authorization page. Requests `user-read-currently-playing` and `user-read-playback-state` scopes.
2. `GET /auth/spotify/callback` — Exchanges the authorization code for access and refresh tokens using Basic auth (client ID + secret). Stores tokens in an in-memory object.
3. `GET /api/auth/status` — Returns `{ authenticated, expiresAt }` so the client can show the right UI state.

Token refresh happens transparently: `getValidAccessToken()` checks if the token expires within 60 seconds and calls Spotify's token endpoint with the refresh token if needed. If refresh fails, the access token is cleared and the server logs the error.

### `server/providers/spotify.js` — Spotify polling

Polls `GET /me/player/currently-playing` every 3 seconds. On each poll:

- **204 (no content)** or `is_playing === false` → emits `onPlaybackStopped` if a track was previously active.
- **Track change** (new `trackId`) → emits `onTrackUpdate` with `{ source, trackId, title, artist, album, albumArt, isPlaying, position, duration }`, then kicks off a background fetch of `GET /audio-analysis/{trackId}`.
- **Same track** → emits `onPositionUpdate` with `{ position, duration }` for client-side time sync.

Audio analysis results are cached in a `Map` keyed by `trackId`, bounded to 50 entries (oldest evicted first). Each cached analysis contains the track's `segments` array (with `start`, `duration`, `loudnessStart`, `loudnessMax`, `loudnessMaxTime`, `pitches[12]`, `timbre[12]` per segment), plus top-level `tempo` and `duration`.

### `server/aggregator.js` — Event hub

Sits between the Spotify provider and Socket.io. It:

- Wires up the four provider callbacks (`onTrackUpdate`, `onAnalysisReady`, `onPositionUpdate`, `onPlaybackStopped`) to corresponding `io.emit()` calls.
- Caches `currentTrack` so newly connected clients can be synced immediately via `syncClient(socket)`, which sends the current track and its cached analysis.
- Provides the `start()` / `stop()` lifecycle for the provider.

The aggregator pattern decouples providers from the transport layer, making it straightforward to add future providers (Qobuz, YouTube Music) without changing the Socket.io plumbing.

## Client Components

### `App.vue` — Root state and theming

Manages all application state as reactive refs:

| Ref | Type | Purpose |
|-----|------|---------|
| `connected` | `boolean` | Socket.io connection status |
| `authenticated` | `boolean` | Spotify auth status (fetched from `/api/auth/status`) |
| `track` | `object \| null` | Current track metadata |
| `analysis` | `object \| null` | Audio analysis segments |
| `playback` | `{ position, timestamp }` | Playback position + local timestamp for interpolation |
| `colors` | `{ bg, text }` | Dynamic theme colors from album art |

Connects to Socket.io on mount with WebSocket as the primary transport (falls back to long-polling), auto-reconnection (1s initial delay, 5s max, infinite attempts). Listens for `now-playing`, `analysis-data`, `playback-position`, and `playback-stopped` events.

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

### `useAudioAnalysis.js` — Audio data composable

The core signal-processing composable that transforms Spotify's raw audio analysis into animated display bands. Inputs: `analysis` ref (segments array) and `playback` ref (position + timestamp). Outputs: reactive `bands[10]` and `peaks[10]` arrays (values 0 to 1).

**Per-frame pipeline (60 fps):**

1. **Position calculation**: `currentPosition = startPosition + (Date.now() - startTime) / 1000`. This interpolates smoothly between the 3-second server poll updates.
2. **Segment lookup**: Binary search through the segments array to find the segment containing the current position.
3. **Band computation**: Maps 12 Spotify pitch classes to 10 display bands using `PITCH_TO_BAND = [0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 7, 8]`:
   - Bands 0, 2, 4 each receive 2 pitch classes (results divided by 1.5 to normalize)
   - Bands 1, 3, 5, 6, 7, 8 each receive 1 pitch class
   - Band 9 is driven by `timbre[1]` (high-frequency energy), scaled by `1/200`
   - Each pitch value is multiplied by the segment's normalized loudness: `(loudnessMax + 60) / 60`
   - If transitioning between segments, pitch values are linearly interpolated by the progress ratio within the current segment
4. **Smoothing**: Exponential moving average with factor 0.3: `newBand = oldBand + (computed - oldBand) * 0.3`
5. **Peak tracking**: If a new value exceeds the current peak, the peak snaps to that value. Otherwise the peak decays by 0.015 per frame.

### `useWakeLock.js` — Screen wake lock composable

Requests `navigator.wakeLock.request('screen')` on mount to prevent the iPhone from sleeping. Re-acquires the lock on `visibilitychange` events (the lock is automatically released when the tab goes to the background). Releases the lock on unmount. Falls back gracefully if the API is unavailable.

## Real-Time Communication Protocol

All real-time data flows through Socket.io over a single WebSocket connection.

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `now-playing` | server → client | `{ source, trackId, title, artist, album, albumArt, isPlaying, position, duration }` | Track change |
| `analysis-data` | server → client | `{ trackId, segments[], tempo, duration }` | Analysis fetched (once per track) |
| `playback-position` | server → client | `{ position, duration }` | Every 3s poll |
| `playback-stopped` | server → client | *(empty)* | Playback paused or stopped |

**New client sync**: When a client connects, the aggregator immediately sends the current `now-playing` and `analysis-data` (if available) so the display populates instantly without waiting for the next poll cycle.

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
| **In-memory token store** | TuneBoss is a single-user appliance. No database overhead. Tokens simply re-auth on server restart. |
| **Aggregator pattern** | Decouples providers from the Socket.io transport. Adding a new music service means implementing a provider class and wiring it into the aggregator — no changes to the WebSocket layer. |
| **Client-side analysis processing** | The server sends raw analysis segments; the client computes display bands at 60 fps. This offloads CPU from the Raspberry Pi and allows smooth animation independent of the 3-second polling interval. |
| **Canvas over SVG/DOM** | Canvas is GPU-accelerated and avoids DOM churn. Critical for smooth 60 fps animation on mobile hardware. |
| **3-second polling interval** | Spotify's rate limit is approximately 3,600 requests/hour. A 3-second interval uses ~1,200 requests/hour, well within limits while keeping the display responsive. |
| **node-vibrant on the client** | Color extraction runs after the image loads in the browser, avoiding server-side image decoding. The server doesn't need to fetch or process album art at all. |
| **LRU analysis cache (50 entries)** | Bounded memory prevents unbounded growth during long-running sessions. Avoids re-fetching analysis for repeated tracks in a playlist. |
| **Binary search for segment lookup** | Audio analysis can contain thousands of segments per track. Binary search keeps per-frame segment lookup O(log n). |
| **Pitch-to-band grouping (12 → 10)** | 10 bars is visually cleaner than 12 on a small mobile screen. Adjacent pitch classes (e.g., C and C#) are grouped since they represent similar frequency regions. Band 9 uses timbre data for a distinct high-frequency "presence" band. |

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
