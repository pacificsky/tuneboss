<template>
  <div class="track-progress">
    <div class="track-progress__bar">
      <div class="track-progress__fill" :style="{ width: progressPercent + '%' }">
        <span class="track-progress__dot"></span>
      </div>
    </div>
    <div class="track-progress__times">
      <span>{{ elapsedFormatted }}</span>
      <span>-{{ remainingFormatted }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  playback: { type: Object, default: () => ({ position: 0, duration: 0, timestamp: Date.now() }) },
  isPlaying: { type: Boolean, default: true }
})

const progressPercent = ref(0)
const elapsedFormatted = ref('0:00')
const remainingFormatted = ref('0:00')

let animFrame = null

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function update() {
  const p = props.playback
  if (!p || !p.duration) {
    progressPercent.value = 0
    elapsedFormatted.value = '0:00'
    remainingFormatted.value = '0:00'
    animFrame = requestAnimationFrame(update)
    return
  }

  const elapsed = props.isPlaying ? p.position + (Date.now() - p.timestamp) : p.position
  const clamped = Math.max(0, Math.min(elapsed, p.duration))

  progressPercent.value = (clamped / p.duration) * 100
  elapsedFormatted.value = formatTime(clamped)
  remainingFormatted.value = formatTime(p.duration - clamped)

  animFrame = requestAnimationFrame(update)
}

onMounted(() => {
  animFrame = requestAnimationFrame(update)
})

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
})
</script>

<style scoped>
.track-progress {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.track-progress__bar {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1.5px;
  overflow: visible;
}

.track-progress__fill {
  height: 100%;
  background: currentColor;
  opacity: 0.5;
  border-radius: 1.5px;
  position: relative;
}

.track-progress__dot {
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  opacity: 1;
}

.track-progress__times {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  font-weight: 400;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
</style>
