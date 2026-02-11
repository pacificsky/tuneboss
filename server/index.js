require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { setupSpotifyAuth, getTokenStore } = require('./auth/spotify');
const Aggregator = require('./aggregator');

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Spotify OAuth routes
setupSpotifyAuth(app);

// Serve built Vue client in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res) => {
  // Don't intercept API/auth routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Aggregator
const aggregator = new Aggregator(io);

// Socket.io connections
io.on('connection', (socket) => {
  console.log('[socket] Client connected (%s)', socket.id);
  aggregator.syncClient(socket);

  socket.on('disconnect', () => {
    console.log('[socket] Client disconnected (%s)', socket.id);
  });
});

// Start polling once Spotify is authenticated
function waitForAuth() {
  const store = getTokenStore();
  if (store.accessToken) {
    aggregator.start();
    return;
  }
  console.log('[server] Waiting for Spotify auth... Visit http://localhost:%d/auth/spotify', PORT);
  const check = setInterval(() => {
    if (getTokenStore().accessToken) {
      clearInterval(check);
      aggregator.start();
    }
  }, 2000);
}

httpServer.listen(PORT, () => {
  console.log('[server] TuneBoss running on http://localhost:%d', PORT);
  waitForAuth();
});
