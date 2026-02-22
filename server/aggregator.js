const SpotifyProvider = require('./providers/spotify');

class Aggregator {
  constructor(io) {
    this.io = io;
    this.spotify = new SpotifyProvider();
    this.currentTrack = null;
    this.clientCount = 0;

    this.spotify.onTrackUpdate = (track) => {
      this.currentTrack = track;
      console.log('[aggregator] Now playing: %s — %s', track.title, track.artist);
      this.io.emit('now-playing', track);
    };

    this.spotify.onPositionUpdate = (position) => {
      this.io.emit('playback-position', position);
    };

    this.spotify.onPlaybackPaused = (track) => {
      this.currentTrack = track;
      console.log('[aggregator] Paused: %s — %s', track.title, track.artist);
      this.io.emit('playback-paused', track);
    };

    this.spotify.onPlaybackStopped = () => {
      this.currentTrack = null;
      console.log('[aggregator] Playback stopped');
      this.io.emit('playback-stopped');
    };
  }

  clientConnected(socket) {
    this.clientCount++;
    console.log('[aggregator] Client connected (%d active)', this.clientCount);
    this.syncClient(socket);
    this.setupControlListeners(socket);
    if (this.clientCount === 1) {
      this.spotify.start();
    }
  }

  clientDisconnected() {
    this.clientCount = Math.max(0, this.clientCount - 1);
    console.log('[aggregator] Client disconnected (%d active)', this.clientCount);
    if (this.clientCount === 0) {
      this.spotify.stop();
      console.log('[aggregator] No clients — paused Spotify polling');
    }
  }

  // Send current state to a newly connected client
  syncClient(socket) {
    if (this.currentTrack) {
      socket.emit('now-playing', this.currentTrack);
    }
  }

  // Listen for playback control events from a client
  setupControlListeners(socket) {
    socket.on('playback-control', async (action) => {
      console.log('[aggregator] Playback control: %s', action);

      let success = false;
      switch (action) {
        case 'play':
          success = await this.spotify.play();
          break;
        case 'pause':
          success = await this.spotify.pause();
          break;
        case 'next':
          success = await this.spotify.next();
          break;
        case 'previous':
          success = await this.spotify.previous();
          break;
        default:
          console.warn('[aggregator] Unknown control action: %s', action);
          return;
      }

      // Re-poll immediately so the UI updates fast
      if (success) {
        setTimeout(() => this.spotify.poll(), 300);
      }
    });
  }
}

module.exports = Aggregator;
