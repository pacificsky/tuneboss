<template>
  <div class="playback-controls">
    <button
      class="playback-controls__btn"
      :class="{ 'playback-controls__btn--tap': tapped === 'previous' }"
      @click="tap('previous')"
      aria-label="Previous track"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
      </svg>
    </button>
    <button
      class="playback-controls__btn playback-controls__btn--main"
      :class="{ 'playback-controls__btn--tap': tapped === 'toggle' }"
      @click="tap(isPlaying ? 'pause' : 'play', 'toggle')"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
    >
      <svg v-if="isPlaying" viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </button>
    <button
      class="playback-controls__btn"
      :class="{ 'playback-controls__btn--tap': tapped === 'next' }"
      @click="tap('next')"
      aria-label="Next track"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  isPlaying: { type: Boolean, default: true }
})

const emit = defineEmits(['control'])

const tapped = ref(null)
let tapTimer = null

function tap(action, key) {
  emit('control', action)
  tapped.value = key || action
  clearTimeout(tapTimer)
  tapTimer = setTimeout(() => { tapped.value = null }, 300)
}
</script>

<style scoped>
.playback-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
}

.playback-controls__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: currentColor;
  opacity: 0.7;
  cursor: pointer;
  padding: 0.4rem;
  border-radius: 50%;
  transition: opacity 0.2s ease, transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.playback-controls__btn--tap {
  animation: btn-tap 0.3s ease;
}

.playback-controls__btn--main {
  opacity: 0.9;
  background: rgba(255, 255, 255, 0.1);
  padding: 0.6rem;
}

@keyframes btn-tap {
  0%   { transform: scale(1);    opacity: 0.7; }
  40%  { transform: scale(0.8);  opacity: 1; }
  100% { transform: scale(1);    opacity: 0.7; }
}
</style>
