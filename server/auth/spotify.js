const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = 'user-read-currently-playing user-read-playback-state';

const TOKEN_PATH = path.join(__dirname, '..', '..', '.tokens.json');

let tokenStore = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0
};

function loadTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    tokenStore.accessToken = data.accessToken || null;
    tokenStore.refreshToken = data.refreshToken || null;
    tokenStore.expiresAt = data.expiresAt || 0;
    console.log('[auth] Loaded saved tokens from disk');
  } catch {
    // No saved tokens — fresh start
  }
}

function saveTokens() {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({
      accessToken: tokenStore.accessToken,
      refreshToken: tokenStore.refreshToken,
      expiresAt: tokenStore.expiresAt
    }), 'utf8');
  } catch (err) {
    console.warn('[auth] Failed to save tokens:', err.message);
  }
}

// Load any previously saved tokens on startup
loadTokens();

function getTokenStore() {
  return tokenStore;
}

function setupSpotifyAuth(app) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    console.warn('[auth] SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set');
    return;
  }

  // Step 1: Redirect user to Spotify login
  app.get('/auth/spotify', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state
    });
    res.redirect(`${SPOTIFY_AUTH_URL}?${params}`);
  });

  // Step 2: Handle callback, exchange code for tokens
  app.get('/auth/spotify/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
      return res.status(400).send(`Spotify auth error: ${error}`);
    }

    try {
      const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri);
      tokenStore.accessToken = tokens.access_token;
      tokenStore.refreshToken = tokens.refresh_token;
      tokenStore.expiresAt = Date.now() + tokens.expires_in * 1000;
      saveTokens();

      console.log('[auth] Spotify authenticated successfully');
      res.redirect('/');
    } catch (err) {
      console.error('[auth] Token exchange failed:', err.message);
      res.status(500).send('Authentication failed');
    }
  });

  // API: Check auth status
  app.get('/api/auth/status', (req, res) => {
    res.json({
      authenticated: !!tokenStore.accessToken,
      expiresAt: tokenStore.expiresAt
    });
  });
}

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function refreshAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!tokenStore.refreshToken) {
    throw new Error('No refresh token available');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenStore.refreshToken
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  tokenStore.accessToken = data.access_token;
  if (data.refresh_token) {
    tokenStore.refreshToken = data.refresh_token;
  }
  tokenStore.expiresAt = Date.now() + data.expires_in * 1000;
  saveTokens();

  console.log('[auth] Spotify token refreshed');
  return tokenStore.accessToken;
}

async function getValidAccessToken() {
  if (!tokenStore.accessToken) return null;

  // Refresh if expiring within 60 seconds
  if (Date.now() > tokenStore.expiresAt - 60000) {
    try {
      return await refreshAccessToken();
    } catch (err) {
      console.error('[auth] Failed to refresh token:', err.message);
      tokenStore.accessToken = null;
      saveTokens();
      return null;
    }
  }

  return tokenStore.accessToken;
}

module.exports = { setupSpotifyAuth, getValidAccessToken, getTokenStore };
