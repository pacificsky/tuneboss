const { getValidAccessToken } = require('../auth/spotify');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const POLL_INTERVAL = 3000;

class SpotifyProvider {
  constructor() {
    this.currentTrackId = null;
    this.isPlaying = false;
    this.pollTimer = null;
    this.onTrackUpdate = null;
    this.onPositionUpdate = null;
    this.onPlaybackStopped = null;
    this.onPlaybackPaused = null;
  }

  start() {
    if (this.pollTimer) return;
    console.log('[spotify] Provider started, polling every %dms', POLL_INTERVAL);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[spotify] Provider stopped');
  }

  async poll() {
    const token = await getValidAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`${SPOTIFY_API}/me/player/currently-playing`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // 204 = no active playback
      if (res.status === 204) {
        if (this.currentTrackId) {
          this.currentTrackId = null;
          this.isPlaying = false;
          this.onPlaybackStopped?.();
        }
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          console.warn('[spotify] Token expired mid-poll, will refresh next cycle');
        }
        return;
      }

      const data = await res.json();
      if (!data || !data.item) return;

      const trackId = data.item.id;
      const isPlaying = data.is_playing;

      const trackData = {
        source: 'spotify',
        trackId,
        title: data.item.name,
        artist: data.item.artists.map(a => a.name).join(', '),
        album: data.item.album.name,
        albumArt: data.item.album.images[0]?.url || null,
        isPlaying,
        position: data.progress_ms,
        duration: data.item.duration_ms
      };

      // Track changed — emit full update regardless of play state
      if (trackId !== this.currentTrackId) {
        this.currentTrackId = trackId;
        this.isPlaying = isPlaying;
        this.onTrackUpdate?.(trackData);
        return;
      }

      // Play state changed on the same track
      if (isPlaying !== this.isPlaying) {
        this.isPlaying = isPlaying;
        if (isPlaying) {
          // Resumed — emit full track update to refresh UI
          this.onTrackUpdate?.(trackData);
        } else {
          // Paused — notify with current track data
          this.onPlaybackPaused?.(trackData);
        }
      }

      // Emit position update every poll (only when playing)
      if (isPlaying) {
        this.onPositionUpdate?.({
          position: data.progress_ms,
          duration: data.item.duration_ms
        });
      }
    } catch (err) {
      console.error('[spotify] Poll error:', err.message);
    }
  }

  // Playback control methods
  async pause() {
    return this._controlRequest('PUT', '/me/player/pause');
  }

  async play() {
    return this._controlRequest('PUT', '/me/player/play');
  }

  async next() {
    return this._controlRequest('POST', '/me/player/next');
  }

  async previous() {
    return this._controlRequest('POST', '/me/player/previous');
  }

  async _controlRequest(method, endpoint) {
    const token = await getValidAccessToken();
    if (!token) {
      console.warn('[spotify] No token for playback control');
      return false;
    }

    try {
      const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('[spotify] Control %s failed (%d): %s', endpoint, res.status, text);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[spotify] Control %s error: %s', endpoint, err.message);
      return false;
    }
  }
}

module.exports = SpotifyProvider;
