const SpotifyProvider = require('./providers/spotify');

class Aggregator {
  constructor(io) {
    this.io = io;
    this.spotify = new SpotifyProvider();
    this.currentTrack = null;

    this.spotify.onTrackUpdate = (track) => {
      this.currentTrack = track;
      console.log('[aggregator] Now playing: %s — %s', track.title, track.artist);
      this.io.emit('now-playing', track);
    };

    this.spotify.onPositionUpdate = (position) => {
      this.io.emit('playback-position', position);
    };

    this.spotify.onPlaybackStopped = () => {
      this.currentTrack = null;
      console.log('[aggregator] Playback stopped');
      this.io.emit('playback-stopped');
    };
  }

  start() {
    this.spotify.start();
    console.log('[aggregator] Started');
  }

  stop() {
    this.spotify.stop();
  }

  // Send current state to a newly connected client
  syncClient(socket) {
    if (this.currentTrack) {
      socket.emit('now-playing', this.currentTrack);
    }
  }
}

module.exports = Aggregator;
