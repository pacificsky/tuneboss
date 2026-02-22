<template>
  <div class="now-playing">
    <AlbumArt
      :src="track?.albumArt"
      @colors-extracted="$emit('colors-extracted', $event)"
    />
    <TrackProgress
      :playback="playback"
      :isPlaying="isPlaying"
      class="now-playing__progress"
    />
    <PlaybackControls
      :isPlaying="isPlaying"
      @control="$emit('playback-control', $event)"
    />
    <TrackInfo
      :title="track?.title"
      :artist="track?.artist"
      :album="track?.album"
    />
    <SpectrumAnalyzer
      v-if="enableSpectrum"
      :trackId="track?.trackId"
      :playback="playback"
      :isPlaying="isPlaying"
      :spectrumColors="spectrumColors"
      :wakeLockSupported="wakeLockSupported"
      :wakeLockActive="wakeLockActive"
      @toggle-wake-lock="$emit('toggle-wake-lock')"
    />
    <div class="now-playing__source">
      <span class="source-dot"></span>
      {{ track?.source || 'spotify' }}
    </div>
  </div>
</template>

<script setup>
import AlbumArt from './AlbumArt.vue'
import TrackInfo from './TrackInfo.vue'
import TrackProgress from './TrackProgress.vue'
import PlaybackControls from './PlaybackControls.vue'
import SpectrumAnalyzer from './SpectrumAnalyzer.vue'

defineProps({
  track: { type: Object, default: null },
  playback: { type: Object, default: () => ({ position: 0, timestamp: Date.now() }) },
  isPlaying: { type: Boolean, default: true },
  spectrumColors: { type: Object, default: null },
  enableSpectrum: { type: Boolean, default: true },
  wakeLockSupported: { type: Boolean, default: false },
  wakeLockActive: { type: Boolean, default: false }
})

defineEmits(['colors-extracted', 'toggle-wake-lock', 'playback-control'])
</script>

<style scoped>
.now-playing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  width: 100%;
  padding: 2rem 1.5rem;
}

.now-playing__progress {
  margin-top: 0.75rem;
  margin-bottom: -1rem;
}

.now-playing__source {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.3;
  margin-top: 0.5rem;
}

.source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1db954;
  animation: pulse 2s ease infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
