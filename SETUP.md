# TuneBoss Setup Guide

A now-playing display designed for an iPhone used as a dedicated monitor. Shows album art, track info, a 10-band spectrum analyzer, and dynamic color theming — all driven by Spotify.

## Architecture

```
iPhone (Safari PWA)  <--WebSocket-->  Node.js server (Express + Socket.io)
                                          |
                                     Spotify Web API
```

In production, the server is a single process that both serves the frontend and handles the Spotify API. The iPhone just points to `http://<server-ip>:3000`.

## Prerequisites

- Node.js 18+ (LTS recommended)
- A Spotify account (free or premium)
- A Spotify Developer app (created below)

## 1. Create a Spotify App

1. Go to https://developer.spotify.com/dashboard
2. Click **Create App**
3. Fill in:
   - **App name**: TuneBoss (or anything you like)
   - **App description**: Now playing display
   - **Redirect URI**: `http://<your-server-ip>:3000/auth/spotify/callback`
     - For local testing, use `http://localhost:3000/auth/spotify/callback`
     - For a Raspberry Pi, use its LAN IP, e.g. `http://192.168.1.50:3000/auth/spotify/callback`
   - **Which APIs are you planning to use?**: Web API
4. Click **Save**
5. Go to **Settings** and note your **Client ID** and **Client Secret**

> **Note**: In development mode, the app is limited to 25 users. Since this is personal use, that's fine — just add your Spotify account under **User Management** in the dashboard.

## 2. Install Dependencies

```bash
git clone <repo-url> tuneboss
cd tuneboss
npm run install:all
```

This installs both the server dependencies (Express, Socket.io) and the client dependencies (Vue 3, Vite).

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Spotify credentials:

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://192.168.1.50:3000/auth/spotify/callback
PORT=3000
```

Replace `192.168.1.50` with your server's actual LAN IP address. The redirect URI here **must match exactly** what you entered in the Spotify Dashboard.

## 4. Build the Frontend

```bash
npm run build:client
```

This compiles the Vue app into `client/dist/`, which the Express server will serve as static files.

## 5. Start the Server

```bash
npm start
```

You should see:

```
[server] TuneBoss running on http://localhost:3000
[server] Waiting for Spotify auth... Visit http://localhost:3000/auth/spotify
```

## 6. Authenticate with Spotify

Open `http://<server-ip>:3000` in a browser. You'll see the TuneBoss setup screen with a **Connect Spotify** button. Click it to:

1. Redirect to Spotify's login page
2. Grant TuneBoss permission to read your currently playing track
3. Redirect back to TuneBoss

Once authenticated, the server starts polling Spotify every 3 seconds. Play a song on any device logged into your Spotify account and it should appear on the display.

## 7. Set Up the iPhone

On your iPhone 12 Pro:

1. Open Safari and navigate to `http://<server-ip>:3000`
2. Tap the **Share** button (square with arrow)
3. Tap **Add to Home Screen**
4. Name it "TuneBoss" and tap **Add**

Launching from the Home Screen opens the app in **fullscreen mode** (no Safari chrome). The app also requests a screen wake lock to prevent the display from sleeping.

> **Tip**: Enable **Guided Access** (Settings > Accessibility > Guided Access) to lock the iPhone to TuneBoss and disable accidental touches.

## Development Mode

For active development, run the backend and frontend separately:

```bash
# Terminal 1: Start the backend
npm run dev:server

# Terminal 2: Start the Vite dev server (hot reload)
npm run dev:client
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api`, `/auth`, and `/socket.io` requests to the backend on port 3000 (configured in `client/vite.config.js`).

## Running on a Raspberry Pi

For a persistent always-on setup:

```bash
# Install pm2 globally
npm install -g pm2

# Start TuneBoss with pm2
pm2 start npm --name tuneboss -- start

# Auto-start on boot
pm2 startup
pm2 save
```

This ensures TuneBoss restarts automatically after power outages or reboots.

## Troubleshooting

**"Nothing playing" even though music is on**
- Make sure you're logged into the same Spotify account on both the server and the device playing music.
- Spotify's API only reports playback from Spotify apps — it won't detect music from other apps.

**Spectrum analyzer not showing**
- The analyzer appears once the audio analysis data loads, which takes a moment after a track change.
- If it never appears, the `/audio-analysis` endpoint may be returning errors — check the server logs.

**iPhone display goes to sleep**
- The Screen Wake Lock API requires HTTPS on some browsers. For local HTTP, it may not work. As a workaround, go to Settings > Display & Brightness > Auto-Lock > Never.

**OAuth redirect fails**
- Double check that the redirect URI in `.env` matches exactly what's in your Spotify Dashboard (including `http` vs `https` and the port number).
