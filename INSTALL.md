# Installation

TuneBoss offers three ways to run, depending on your setup. All options require a [Spotify Developer App](https://developer.spotify.com/dashboard) — see the [README](README.md#prerequisites) for setup instructions.

---

## Option 1: Local Docker Container

The simplest path. Runs everything in a single container on your local machine with Docker.

### Prerequisites

- Docker and Docker Compose

### Steps

```bash
git clone <repo-url> tuneboss
cd tuneboss
cp .env.example .env
```

Edit `.env` with your Spotify credentials:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback
PORT=3000
```

Start the container:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

TuneBoss is now running at `http://localhost:3000`. Open it in a browser to authenticate with Spotify.

To access from an iPhone on the same network, replace `localhost` with your machine's LAN IP (e.g., `192.168.1.100`) in both the `.env` redirect URI and the Spotify Dashboard.

### Managing the container

```bash
# View logs
docker compose -f docker-compose.local.yml logs -f

# Stop
docker compose -f docker-compose.local.yml down

# Rebuild after changes
docker compose -f docker-compose.local.yml up -d --build
```

---

## Option 2: Homelab with HTTPS

For running TuneBoss on a separate machine (Raspberry Pi, NAS, VM) with HTTPS via Caddy and Let's Encrypt. This setup uses two containers — Caddy as a reverse proxy and the TuneBoss server — orchestrated by `docker-compose.yml`.

HTTPS is required for the Screen Wake Lock API and is recommended for Spotify OAuth redirect URIs in production.

### Prerequisites

- Docker and Docker Compose on the target machine
- A domain managed by Cloudflare (e.g., `example.com`)
- A Cloudflare API token with **Zone:DNS:Edit** permission

To create the token:

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **Edit zone DNS** template
4. Under **Zone Resources**, select your specific zone (e.g., `example.com`)
5. Save the token

### Step 1: Create a Cloudflare DNS record

In the Cloudflare dashboard for your domain, create an **A record**:

- **Name**: `tuneboss` (or your preferred subdomain)
- **Content**: your server's internal IP (e.g., `10.0.1.50`)
- **Proxy status**: **DNS only** (grey cloud — do NOT proxy through Cloudflare)

### Step 2: Configure environment

```bash
git clone <repo-url> tuneboss
cd tuneboss
cp .env.example .env
```

Edit `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=https://tuneboss.example.com/auth/spotify/callback
PORT=3000

TUNEBOSS_HOSTNAME=tuneboss.example.com
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
```

Update the **Redirect URI** in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to match the HTTPS URL.

### Step 3: Start the stack

```bash
docker compose up -d --build
```

This starts both Caddy (ports 80/443) and the TuneBoss server (port 3000, internal only). Caddy automatically obtains a Let's Encrypt certificate using the DNS-01 challenge via Cloudflare — no inbound internet access required.

Watch the logs to confirm certificate issuance:

```bash
docker compose logs -f caddy
```

First-time issuance can take 30–60 seconds while the DNS challenge propagates.

### Step 4: Access

Open `https://tuneboss.example.com` on any device on your network. Your devices must resolve the hostname to the internal IP — since the Cloudflare A record points to the internal IP and proxy is off, this works automatically with any public DNS resolver (1.1.1.1, 8.8.8.8, etc.).

### Managing the stack

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after changes
docker compose up -d --build
```

> For more detail on why Caddy was chosen over nginx + certbot, see [WHY_CADDY.md](WHY_CADDY.md).

---

## Option 3: Bare Metal (Developer Mode)

Run directly with Node.js — useful for development or if you prefer not to use Docker.

### Prerequisites

- Node.js 18+ (LTS recommended)

### Steps

```bash
git clone <repo-url> tuneboss
cd tuneboss
cp .env.example .env
```

Edit `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback
PORT=3000
```

Install dependencies and build:

```bash
npm run install:all
npm run build:client
```

Start the production server:

```bash
npm start
```

TuneBoss is now running at `http://localhost:3000`.

### Development with hot reload

For active development, run the backend and frontend separately:

```bash
# Terminal 1: Backend
npm run dev:server

# Terminal 2: Frontend (Vite dev server with hot reload)
npm run dev:client
```

The Vite dev server runs on `http://localhost:5173` and proxies API, auth, and Socket.io requests to the backend on port 3000.

### Running as a persistent service (Raspberry Pi)

To keep TuneBoss running across reboots:

```bash
npm install -g pm2
pm2 start npm --name tuneboss -- start
pm2 startup && pm2 save
```

### Adding HTTPS without Docker (Caddy + systemd)

If you want HTTPS on a bare-metal install (required for Screen Wake Lock and recommended for Spotify OAuth), you can run Caddy natively as a systemd service instead of using the Docker setup in Option 2.

Prerequisites: a domain on Cloudflare and an API token with Zone:DNS:Edit permission (see [Option 2](#option-2-homelab-with-https) for details).

**Install Caddy with the Cloudflare DNS module:**

```bash
sudo bash deploy/setup-caddy.sh
```

**Configure Caddy:**

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

**Update your `.env`** to use the HTTPS redirect URI:

```
SPOTIFY_REDIRECT_URI=https://tuneboss.example.com/auth/spotify/callback
```

Then update the Redirect URI in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to match.

**Start Caddy:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caddy
```

Watch the logs to confirm the certificate is issued:

```bash
sudo journalctl -u caddy -f
```

---

## Troubleshooting

**Port 3000 already in use**
- Another process (often another dev server) is already listening on port 3000.
- Change `PORT` in `.env` to an available port (e.g., `3001`) and update `SPOTIFY_REDIRECT_URI` to match (e.g., `http://localhost:3001/auth/spotify/callback`).
- Update the Redirect URI in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) to match the new port.
- If using Docker, also update the port mapping in your `docker-compose.local.yml`.

**`INVALID_CLIENT` error during OAuth**
- Double-check that `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` match exactly what's shown in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) — no extra spaces or quotes.
- Make sure you copied the **Client Secret** (click "View client secret"), not the Client ID twice.
- Confirm your Spotify app hasn't been deleted or recreated — credentials change if you make a new app.

**`Insecure redirect URI` or redirect URI mismatch**
- Spotify requires the redirect URI to use HTTPS or a loopback address (`http://localhost:...` or `http://127.0.0.1:...`).
- LAN IPs over plain HTTP (e.g., `http://192.168.1.100:3000/...`) will be rejected. For local development, use `http://127.0.0.1:3000/auth/spotify/callback` as the redirect URI in both `.env` and the Spotify Dashboard.
- The redirect URI in `.env` must match **exactly** what's in the Spotify Dashboard — including the scheme (`http` vs `https`), host, port, and path.
- If you need to access from other devices on your network, use the HTTPS setup in [Option 2](#option-2-homelab-with-https) or [Option 3's Caddy section](#adding-https-without-docker-caddy--systemd).

**"Nothing playing" even though music is on**
- Verify you're logged into the same Spotify account on both the server and the device playing music.
- Spotify's API only reports playback from Spotify apps — it won't detect other audio sources.

**iPhone display goes to sleep**
- The Screen Wake Lock API requires HTTPS. Without HTTPS, set Auto-Lock to Never (Settings → Display & Brightness → Auto-Lock).

**Caddy certificate not issuing**
- Check logs: `docker compose logs -f caddy`
- Verify the Cloudflare API token has Zone:DNS:Edit permission.
- Ensure the DNS A record proxy status is **DNS only** (grey cloud), not Proxied (orange cloud).
- DNS-01 propagation can take a few minutes on first run.
