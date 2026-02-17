<template>
  <div class="tuneboss" :style="themeStyles">
    <NowPlaying
      v-if="connected && authenticated && track"
      :track="track"
      :playback="playback"
      :spectrumColors="spectrumColors"
      :enableSpectrum="enableSpectrum"
      @colors-extracted="onColorsExtracted"
    />
    <div v-else-if="connected && authenticated && !track" class="idle-state">
      <div class="idle-icon">♪</div>
      <p class="idle-text">Nothing playing</p>
    </div>
    <div v-else-if="connected && !authenticated" class="setup-state">
      <h1 class="setup-title">TuneBoss</h1>
      <p class="setup-subtitle">Connect your music to get started</p>
      <a href="/auth/spotify" class="setup-btn spotify-btn">
        Connect Spotify
      </a>
    </div>
    <div v-else class="connecting">
      <p>Connecting...</p>
    </div>
    <button
      v-if="wakeLockSupported"
      class="wake-lock-toggle"
      :class="{ 'wake-lock-toggle--active': wakeLockActive }"
      @click="toggleWakeLock"
      aria-label="Toggle screen wake lock"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'
import NowPlaying from './components/NowPlaying.vue'
import { useWakeLock } from './composables/useWakeLock.js'

const { isSupported: wakeLockSupported, isActive: wakeLockActive, enable: enableWakeLock, disable: disableWakeLock } = useWakeLock()

function toggleWakeLock() {
  if (wakeLockActive.value) {
    disableWakeLock()
  } else {
    enableWakeLock()
  }
}

const connected = ref(false)
const authenticated = ref(false)
const enableSpectrum = ref(true)
const track = ref(null)
const playback = ref({ position: 0, duration: 0, timestamp: Date.now() })
const colors = ref({ bg: '#121212', text: '#ffffff' })
const spectrumColors = ref(null)

let socket = null

const themeStyles = computed(() => ({
  '--color-bg': colors.value.bg,
  '--color-text': colors.value.text,
  backgroundColor: colors.value.bg,
  color: colors.value.text
}))

function onColorsExtracted(extracted) {
  colors.value = extracted
  spectrumColors.value = extracted.spectrum || null
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status')
    const data = await res.json()
    authenticated.value = data.authenticated
  } catch {
    authenticated.value = false
  }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/config')
    const data = await res.json()
    enableSpectrum.value = data.enableSpectrum !== false
  } catch {
    // Default to enabled if config endpoint is unreachable
  }
}

onMounted(() => {
  checkAuthStatus()
  fetchConfig()

  const serverUrl = window.location.origin
  socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  })

  socket.on('connect', () => {
    connected.value = true
    checkAuthStatus()
  })

  socket.on('disconnect', () => {
    connected.value = false
  })

  socket.on('now-playing', (data) => {
    authenticated.value = true
    track.value = data
  })

  socket.on('playback-position', (data) => {
    playback.value = { position: data.position, duration: data.duration, timestamp: Date.now() }
  })

  socket.on('playback-stopped', () => {
    track.value = null
  })
})

onUnmounted(() => {
  if (socket) socket.disconnect()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.tuneboss {
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: background-color 1.5s ease, color 1s ease;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.idle-state {
  text-align: center;
  opacity: 0.4;
}

.idle-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.idle-text {
  font-size: 1.2rem;
  font-weight: 300;
  letter-spacing: 0.05em;
}

.connecting {
  text-align: center;
  opacity: 0.3;
  font-size: 1rem;
}

.setup-state {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.setup-title {
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.setup-subtitle {
  font-size: 1rem;
  opacity: 0.5;
  font-weight: 300;
  margin-bottom: 1.5rem;
}

.setup-btn {
  display: inline-block;
  padding: 0.85rem 2rem;
  border-radius: 50px;
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.setup-btn:active {
  transform: scale(0.96);
  opacity: 0.8;
}

.spotify-btn {
  background: #1db954;
}

.wake-lock-toggle {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom) + 12px);
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: background 0.3s ease, color 0.3s ease;
  -webkit-tap-highlight-color: transparent;
  padding: 0;
  z-index: 10;
}

.wake-lock-toggle:active {
  transform: scale(0.9);
}

.wake-lock-toggle--active {
  background: rgba(29, 185, 84, 0.2);
  color: rgba(29, 185, 84, 0.9);
}
</style>
