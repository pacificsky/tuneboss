#!/usr/bin/env bash
#
# Sets up Caddy with Cloudflare DNS module for TuneBoss HTTPS.
#
# Prerequisites:
#   - Ubuntu VM with sudo access
#   - A Cloudflare-managed domain with a DNS A record pointing to this machine's IP
#   - A Cloudflare API token with Zone:DNS:Edit permission
#
# Usage:
#   sudo bash deploy/setup-caddy.sh
#

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Error: run this script with sudo"
  exit 1
fi

CADDY_VERSION="2.9.1"
ARCH=$(dpkg --print-architecture)  # amd64, arm64, etc.

echo "==> Installing xcaddy build dependencies..."
apt-get update -qq
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl

# Install Go if not present (needed by xcaddy)
if ! command -v go &>/dev/null; then
  echo "==> Installing Go..."
  GO_VERSION="1.23.5"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" | tar -C /usr/local -xz
  export PATH="/usr/local/go/bin:$PATH"
fi
export PATH="/usr/local/go/bin:$PATH"

# Install xcaddy
echo "==> Installing xcaddy..."
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
XCADDY="$(go env GOPATH)/bin/xcaddy"

# Build Caddy with Cloudflare DNS module
echo "==> Building Caddy ${CADDY_VERSION} with cloudflare DNS module..."
TMPDIR=$(mktemp -d)
pushd "$TMPDIR" >/dev/null
"$XCADDY" build "v${CADDY_VERSION}" \
  --with github.com/caddy-dns/cloudflare
popd >/dev/null

# Install the binary
echo "==> Installing Caddy binary to /usr/local/bin/caddy..."
install -m 0755 "${TMPDIR}/caddy" /usr/local/bin/caddy
rm -rf "$TMPDIR"

# Create caddy user/group if they don't exist
if ! id caddy &>/dev/null; then
  groupadd --system caddy
  useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
fi

# Create config directories
mkdir -p /etc/caddy
mkdir -p /var/lib/caddy/.config
mkdir -p /var/lib/caddy/.data
chown -R caddy:caddy /var/lib/caddy

# Copy Caddyfile
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 0644 "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile

# Install systemd service
install -m 0644 "${SCRIPT_DIR}/caddy.service" /etc/systemd/system/caddy.service

echo "==> Caddy installed successfully."
echo ""
echo "Next steps:"
echo "  1. Edit /etc/caddy/caddy.env with your Cloudflare token and hostname"
echo "     (see deploy/caddy.env.example for reference)"
echo "  2. sudo systemctl daemon-reload"
echo "  3. sudo systemctl enable --now caddy"
echo "  4. sudo journalctl -u caddy -f   # watch for cert issuance"
