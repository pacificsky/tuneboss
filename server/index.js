require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { setupSpotifyAuth } = require('./auth/spotify');
const Aggregator = require('./aggregator');

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Client-facing runtime config
app.get('/api/config', (req, res) => {
  const wipeInterval = parseInt(process.env.TRACK_WIPE_INTERVAL, 10);
  res.json({
    enableSpectrum: process.env.ENABLE_SPECTRUM !== 'false',
    enableTrackWipe: process.env.ENABLE_TRACK_WIPE === 'true',
    trackWipeInterval: wipeInterval > 0 ? wipeInterval : 10
  });
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
  aggregator.clientConnected(socket);

  socket.on('disconnect', () => {
    aggregator.clientDisconnected();
  });
});

httpServer.listen(PORT, () => {
  console.log('[server] TuneBoss running on http://localhost:%d', PORT);
});
