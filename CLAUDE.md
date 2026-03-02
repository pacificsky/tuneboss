# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

TuneBoss is a real-time Spotify "now playing" display — a Node.js/Express backend polls the Spotify API and pushes updates via Socket.io to a Vue 3 PWA frontend designed to run fullscreen on an iPhone as a dedicated always-on music screen.

## Commands

```bash
npm run install:all          # Install both server and client dependencies
npm run dev:server           # Run backend on port 3000
npm run dev:client           # Run Vite dev server on port 5173 (proxies /api, /auth, /socket.io to :3000)
npm run build:client         # Production build of Vue client to client/dist/
npm start                    # Production server (NODE_ENV=production, serves built client)
```

Docker (local): `docker compose -f docker-compose.local.yml up -d --build`
Docker (production with Caddy/HTTPS): `docker compose up -d --build`

There are no linting or testing frameworks configured.

## Architecture

**Backend** (`server/`): Express + Socket.io. Three key modules:
- `auth/spotify.js` — OAuth 2.0 Authorization Code flow, token persistence to `.tokens.json`
- `providers/spotify.js` — Polls Spotify `/me/player/currently-playing` every 3 seconds
- `aggregator.js` — Event hub between providers and Socket.io; manages client-gated polling (only polls when clients are connected)

**Frontend** (`client/`): Vue 3 + Vite SPA with Composition API (`<script setup>`).
- `App.vue` — Root state, Socket.io connection, dynamic CSS theming via `node-vibrant` color extraction
- `components/` — `NowPlaying`, `AlbumArt`, `TrackInfo`, `TrackWipe`, `SpectrumAnalyzer`, `PlaybackControls`
- `composables/` — `useAudioAnalysis` (procedural spectrum from track ID hash), `useMicrophoneAnalyzer` (real-time FFT), `useWakeLock` (screen wake lock)

**Data flow**: Spotify API → provider (polling) → aggregator (caching + event dispatch) → Socket.io → Vue client

**Socket.io events**: `now-playing` (track change), `playback-position` (every 3s), `playback-paused`, `playback-stopped` (server→client); `playback-control` (client→server for play/pause/next/prev)

## Key Patterns

- **Client-gated polling**: Spotify polling starts/stops based on Socket.io client count to avoid wasting API quota.
- **Aggregator pattern**: Providers are decoupled from transport. New music services implement a provider and wire into the aggregator.
- **Procedural spectrum**: Each track gets a deterministic visual "personality" seeded from its Spotify track ID hash (BPM, oscillator shapes). Spotify's `/audio-analysis` endpoint is deprecated.
- **Canvas rendering**: Spectrum analyzer uses `requestAnimationFrame` at 60fps on HTML5 Canvas (not DOM/SVG) for mobile GPU performance.
- **Token persistence**: OAuth tokens saved to `.tokens.json` (gitignored) on every mutation; auto-restored on server startup.
- **Dynamic theming**: `node-vibrant` extracts palette from album art client-side; background darkened by 60% for contrast.

## Code Style

- Vanilla JavaScript throughout (no TypeScript)
- Vue 3 Composition API with `<script setup>` in all components
- Semicolons required
- camelCase for variables/functions, PascalCase for components
- Console logs use `[component]` prefix tags (e.g., `console.log('[auth] Token refreshed')`)

## Environment Variables

Copy `.env.example` to `.env`. Required: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`. Optional feature flags: `ENABLE_SPECTRUM`, `SPECTRUM_STYLE` (modern/retro), `ENABLE_TRACK_WIPE`, `TRACK_WIPE_INTERVAL`.
