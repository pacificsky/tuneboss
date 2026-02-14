Since your server is on an internal 10.x IP, Let's Encrypt's default HTTP-01 challenge won't work (their servers can't reach your VM from the internet). You need the **DNS-01 challenge**, which proves domain ownership by creating a TXT record in Cloudflare DNS instead.

**My recommendation: Caddy as a reverse proxy with the Cloudflare DNS plugin.**

Why Caddy over nginx+certbot:
- Automatic HTTPS and renewal with zero config beyond the Caddyfile
- Built-in DNS-01 challenge support via the Cloudflare module
- Single binary, minimal operational overhead
- Handles the reverse proxy to your Node app on port 3000

The setup:
1. Caddy listens on :443, terminates TLS, proxies to `localhost:3000`
2. Uses a Cloudflare API token to create/clean up DNS-01 TXT records
3. Auto-renews certs ~30 days before expiry
4. Your Express app stays HTTP on localhost — no code changes needed

Let me set this up.

Everything is pushed. Here's a summary of what was set up:

### Files created in `deploy/`

| File | Purpose |
|---|---|
| `Caddyfile` | Caddy config — reverse proxies HTTPS :443 to your Node app on :3000, uses Cloudflare DNS-01 for TLS |
| `setup-caddy.sh` | Installs Go, builds Caddy from source with the Cloudflare DNS module via xcaddy, creates the caddy user, copies config files |
| `caddy.service` | systemd unit file — runs Caddy as a service with auto-restart, reads env from `/etc/caddy/caddy.env` |
| `caddy.env.example` | Template for the three env vars Caddy needs: hostname, Cloudflare token, port |

### How it works

1. You point a Cloudflare DNS A record (e.g. `tuneboss.yourdomain.com`) at your VM's 10.x IP, with **proxy status off** (grey cloud)
2. You give Caddy a Cloudflare API token with DNS edit permission
3. Caddy uses DNS-01 challenge: it creates a temporary `_acme-challenge` TXT record via the Cloudflare API, Let's Encrypt verifies it, issues the cert
4. Caddy auto-renews ~30 days before expiry — completely hands-off
5. Your Express app stays unchanged on HTTP :3000, Caddy handles TLS termination

### What you need to do on the VM

1. Run `sudo bash deploy/setup-caddy.sh`
2. Fill in `/etc/caddy/caddy.env` with your hostname and Cloudflare token
3. Update your `.env` redirect URI to `https://tuneboss.yourdomain.com/auth/spotify/callback`
4. Match that URI in the Spotify Developer Dashboard
5. `sudo systemctl enable --now caddy`

No changes to the Node.js application code were needed — Caddy sits in front as a transparent reverse proxy.
