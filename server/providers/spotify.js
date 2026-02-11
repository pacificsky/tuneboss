const { getValidAccessToken } = require('../auth/spotify');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const POLL_INTERVAL = 3000;

class SpotifyProvider {
  constructor() {
    this.currentTrackId = null;
    this.analysisCache = new Map(); // trackId -> analysis
    this.pollTimer = null;
    this.onTrackUpdate = null;
    this.onPositionUpdate = null;
    this.onPlaybackStopped = null;
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

      if (!isPlaying) {
        if (this.currentTrackId) {
          this.currentTrackId = null;
          this.onPlaybackStopped?.();
        }
        return;
      }

      // Emit position update every poll
      this.onPositionUpdate?.({
        position: data.progress_ms,
        duration: data.item.duration_ms
      });

      // Track changed — emit full update
      if (trackId !== this.currentTrackId) {
        this.currentTrackId = trackId;

        const trackData = {
          source: 'spotify',
          trackId,
          title: data.item.name,
          artist: data.item.artists.map(a => a.name).join(', '),
          album: data.item.album.name,
          albumArt: data.item.album.images[0]?.url || null,
          isPlaying: true,
          position: data.progress_ms,
          duration: data.item.duration_ms
        };

        this.onTrackUpdate?.(trackData);

        // Fetch audio analysis in background
        this.fetchAnalysis(trackId, token);
      }
    } catch (err) {
      console.error('[spotify] Poll error:', err.message);
    }
  }

  async fetchAnalysis(trackId, token) {
    // Check cache
    if (this.analysisCache.has(trackId)) {
      this.onAnalysisReady?.(this.analysisCache.get(trackId));
      return;
    }

    try {
      const res = await fetch(`${SPOTIFY_API}/audio-analysis/${trackId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        console.warn('[spotify] Audio analysis fetch failed (%d)', res.status);
        return;
      }

      const data = await res.json();
      const segments = data.segments.map(seg => ({
        start: seg.start,
        duration: seg.duration,
        loudnessStart: seg.loudness_start,
        loudnessMax: seg.loudness_max,
        loudnessMaxTime: seg.loudness_max_time,
        pitches: seg.pitches,
        timbre: seg.timbre
      }));

      const analysis = {
        trackId,
        segments,
        tempo: data.track.tempo,
        duration: data.track.duration
      };

      // Keep cache bounded
      if (this.analysisCache.size > 50) {
        const oldest = this.analysisCache.keys().next().value;
        this.analysisCache.delete(oldest);
      }
      this.analysisCache.set(trackId, analysis);

      this.onAnalysisReady?.(analysis);
    } catch (err) {
      console.error('[spotify] Analysis fetch error:', err.message);
    }
  }
}

module.exports = SpotifyProvider;
