<template>
  <div class="spectrum-analyzer">
    <canvas
      ref="canvasRef"
      :width="canvasWidth"
      :height="canvasHeight"
    ></canvas>
  </div>
</template>

<script setup>
import { ref, toRef, onMounted, onUnmounted, watch } from 'vue'
import { useAudioAnalysis } from '../composables/useAudioAnalysis.js'

const props = defineProps({
  analysis: { type: Object, default: null },
  playback: { type: Object, default: () => ({ position: 0, timestamp: Date.now() }) }
})

const canvasRef = ref(null)
const canvasWidth = 340
const canvasHeight = 100

const { bands, peaks } = useAudioAnalysis(
  toRef(props, 'analysis'),
  toRef(props, 'playback')
)

const NUM_BANDS = 10
const BAR_GAP = 4
const BAR_RADIUS = 3

let drawFrame = null

function getBarColor(height, maxHeight) {
  const ratio = height / maxHeight
  if (ratio > 0.85) return '#ff4444' // Red zone
  if (ratio > 0.65) return '#ffaa00' // Orange/yellow
  return '#44dd66'                   // Green
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) {
    drawFrame = requestAnimationFrame(draw)
    return
  }

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1

  // Handle high-DPI displays
  canvas.width = canvasWidth * dpr
  canvas.height = canvasHeight * dpr
  canvas.style.width = canvasWidth + 'px'
  canvas.style.height = canvasHeight + 'px'
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  const totalGaps = (NUM_BANDS - 1) * BAR_GAP
  const barWidth = (canvasWidth - totalGaps) / NUM_BANDS
  const maxBarHeight = canvasHeight - 10 // Leave room for peaks

  for (let i = 0; i < NUM_BANDS; i++) {
    const x = i * (barWidth + BAR_GAP)
    const bandVal = Math.min(1, bands.value[i] || 0)
    const peakVal = Math.min(1, peaks.value[i] || 0)
    const barHeight = Math.max(2, bandVal * maxBarHeight)
    const peakY = canvasHeight - peakVal * maxBarHeight

    // Bar glow
    ctx.shadowColor = getBarColor(barHeight, maxBarHeight)
    ctx.shadowBlur = 8

    // Main bar
    ctx.fillStyle = getBarColor(barHeight, maxBarHeight)
    const y = canvasHeight - barHeight
    roundRect(ctx, x, y, barWidth, barHeight, BAR_RADIUS)

    // Peak indicator
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillRect(x, peakY - 2, barWidth, 2)
  }

  drawFrame = requestAnimationFrame(draw)
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
}

onMounted(() => {
  drawFrame = requestAnimationFrame(draw)
})

onUnmounted(() => {
  if (drawFrame) cancelAnimationFrame(drawFrame)
})
</script>

<style scoped>
.spectrum-analyzer {
  width: 100%;
  max-width: 340px;
  display: flex;
  justify-content: center;
}

.spectrum-analyzer canvas {
  display: block;
}
</style>
