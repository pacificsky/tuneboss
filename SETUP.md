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

## Homelab Deployment (HTTPS with Let's Encrypt)

If you're running TuneBoss on a VM in your homelab, you'll need HTTPS for:
- Spotify OAuth redirect URIs (Spotify requires HTTPS for non-localhost)
- The Screen Wake Lock API and `getDisplayMedia` in the browser

This setup uses **Caddy** as a reverse proxy with automatic Let's Encrypt certificates via the **DNS-01 challenge** through Cloudflare. This works even though your server has an internal (e.g. 10.x) IP — no inbound internet access required.

### How it works

```
iPhone (Safari)
    |
    | HTTPS :443
    v
  Caddy  ──DNS-01 challenge──>  Cloudflare API  ──>  Let's Encrypt
    |
    | HTTP :3000 (localhost)
    v
  Node.js (Express + Socket.io)
```

Caddy terminates TLS and proxies to your Node app. Certs are issued via DNS-01 (Caddy creates a temporary TXT record in your Cloudflare zone to prove domain ownership) and auto-renewed ~30 days before expiry.

### Prerequisites

- An Ubuntu VM (or similar) with sudo access
- A domain managed by Cloudflare (e.g. `example.com`)
- A Cloudflare API token with **Zone:DNS:Edit** permission

### Step 1: Create a Cloudflare DNS record

In the Cloudflare dashboard for your domain, create an **A record**:
- **Name**: `tuneboss` (or whatever subdomain you want)
- **Content**: your VM's internal IP (e.g. `10.0.1.50`)
- **Proxy status**: **DNS only** (grey cloud — do NOT proxy through Cloudflare)

### Step 2: Create a Cloudflare API token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use the **Edit zone DNS** template
4. Under **Zone Resources**, select your specific zone (e.g. `example.com`)
5. Save the token — you'll need it in Step 4

### Step 3: Install Caddy with the Cloudflare DNS module

```bash
sudo bash deploy/setup-caddy.sh
```

This builds Caddy from source with the Cloudflare DNS plugin (required for DNS-01 challenges) and installs the systemd service.

### Step 4: Configure Caddy

```bash
sudo cp deploy/caddy.env.example /etc/caddy/caddy.env
sudo nano /etc/caddy/caddy.env
```

Fill in your values:

```
TUNEBOSS_HOSTNAME=tuneboss.example.com
CLOUDFLARE_API_TOKEN=your_token_here
TUNEBOSS_PORT=3000
```

### Step 5: Configure TuneBoss for HTTPS

Update your `.env` to use the HTTPS redirect URI:

```
SPOTIFY_REDIRECT_URI=https://tuneboss.example.com/auth/spotify/callback
```

Then update the **Redirect URI** in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to match.

### Step 6: Start everything

```bash
# Start Caddy
sudo systemctl daemon-reload
sudo systemctl enable --now caddy

# Start TuneBoss (with pm2 for persistence)
pm2 start npm --name tuneboss -- start
pm2 save
```

Watch Caddy's logs to confirm the certificate is issued:

```bash
sudo journalctl -u caddy -f
```

You should see messages about obtaining a certificate for your domain. First-time issuance can take 30-60 seconds while the DNS-01 challenge propagates.

### Step 7: Access via HTTPS

Open `https://tuneboss.example.com` on your iPhone (or any device on the same network). Caddy handles HTTPS termination and certificate renewal automatically — no manual intervention needed.

> **Note**: Your devices must be able to resolve the hostname to the internal IP. Since the Cloudflare DNS A record points to the internal IP, this works automatically for any device using public DNS resolvers (e.g. 1.1.1.1, 8.8.8.8).

## Troubleshooting

**"Nothing playing" even though music is on**
- Make sure you're logged into the same Spotify account on both the server and the device playing music.
- Spotify's API only reports playback from Spotify apps — it won't detect music from other apps.

**Spectrum analyzer not showing**
- The analyzer appears once the audio analysis data loads, which takes a moment after a track change.
- If it never appears, the `/audio-analysis` endpoint may be returning errors — check the server logs.

**iPhone display goes to sleep**
- The Screen Wake Lock API requires HTTPS. If running without the Caddy HTTPS setup, go to Settings > Display & Brightness > Auto-Lock > Never.

**OAuth redirect fails**
- Double check that the redirect URI in `.env` matches exactly what's in your Spotify Dashboard (including `http` vs `https` and the port number).

**Caddy certificate not issuing**
- Check Caddy logs: `sudo journalctl -u caddy -f`
- Verify the Cloudflare API token has Zone:DNS:Edit permission for the correct zone.
- Ensure the DNS A record exists and the proxy status is set to **DNS only** (grey cloud), not **Proxied** (orange cloud).
- DNS-01 propagation can take a couple of minutes on first run. Be patient.
