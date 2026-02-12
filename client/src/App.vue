<template>
  <div class="tuneboss" :style="themeStyles">
    <NowPlaying
      v-if="connected && authenticated && track"
      :track="track"
      :playback="playback"
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'
import NowPlaying from './components/NowPlaying.vue'
import { useWakeLock } from './composables/useWakeLock.js'

useWakeLock()

const connected = ref(false)
const authenticated = ref(false)
const track = ref(null)
const playback = ref({ position: 0, timestamp: Date.now() })
const colors = ref({ bg: '#121212', text: '#ffffff' })

let socket = null

const themeStyles = computed(() => ({
  '--color-bg': colors.value.bg,
  '--color-text': colors.value.text,
  backgroundColor: colors.value.bg,
  color: colors.value.text
}))

function onColorsExtracted(extracted) {
  colors.value = extracted
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

onMounted(() => {
  checkAuthStatus()

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
    playback.value = { position: data.position, timestamp: Date.now() }
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
</style>
