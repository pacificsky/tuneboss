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
  trackId: { type: String, default: null },
  playback: { type: Object, default: () => ({ position: 0, timestamp: Date.now() }) },
  spectrumColors: { type: Object, default: null }
})

const canvasRef = ref(null)
const canvasWidth = 340
const canvasHeight = 100

const { bands, peaks } = useAudioAnalysis(
  toRef(props, 'trackId'),
  toRef(props, 'playback')
)

const NUM_BANDS = 10
const BAR_GAP = 4
const SEGMENT_GAP = 2
const SEGMENT_HEIGHT = 5

// Default fallback colors (cyan / red like the reference image)
const DEFAULT_PRIMARY = [0, 210, 210]
const DEFAULT_LIGHT = [100, 255, 255]
const DEFAULT_HOT = [255, 50, 50]

let drawFrame = null

// Interpolate between two RGB arrays
function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
}

// Brighten an RGB color (push toward white)
function brighten(rgb, amount) {
  return [
    Math.min(255, rgb[0] + (255 - rgb[0]) * amount),
    Math.min(255, rgb[1] + (255 - rgb[1]) * amount),
    Math.min(255, rgb[2] + (255 - rgb[2]) * amount)
  ]
}

// Compute a "hot" accent color from the primary: shift toward warm red/orange
function deriveHotColor(rgb) {
  return [
    Math.min(255, rgb[0] * 0.4 + 255 * 0.6),
    Math.min(255, rgb[1] * 0.25),
    Math.min(255, rgb[2] * 0.2)
  ]
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) {
    drawFrame = requestAnimationFrame(draw)
    return
  }

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1

  canvas.width = canvasWidth * dpr
  canvas.height = canvasHeight * dpr
  canvas.style.width = canvasWidth + 'px'
  canvas.style.height = canvasHeight + 'px'
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // Resolve colors from album art or use defaults
  const sc = props.spectrumColors
  const primary = sc ? sc.primary : DEFAULT_PRIMARY
  const light = sc ? sc.light : DEFAULT_LIGHT
  const hot = deriveHotColor(primary)

  const totalGaps = (NUM_BANDS - 1) * BAR_GAP
  const barWidth = (canvasWidth - totalGaps) / NUM_BANDS
  const maxBarHeight = canvasHeight - 6 // leave room at top for peak
  const totalSegments = Math.floor(maxBarHeight / (SEGMENT_HEIGHT + SEGMENT_GAP))

  for (let i = 0; i < NUM_BANDS; i++) {
    const x = i * (barWidth + BAR_GAP)
    const bandVal = Math.min(1, bands.value[i] || 0)
    const peakVal = Math.min(1, peaks.value[i] || 0)

    const litSegments = Math.round(bandVal * totalSegments)
    const peakSegment = Math.round(peakVal * totalSegments)

    // Draw segments bottom-up
    for (let s = 0; s < totalSegments; s++) {
      const segY = canvasHeight - (s + 1) * (SEGMENT_HEIGHT + SEGMENT_GAP)
      const ratio = s / totalSegments // 0 = bottom, 1 = top

      if (s < litSegments) {
        // Lit segment: color transitions from primary at bottom to hot at top
        let segColor
        if (ratio < 0.65) {
          // Primary zone — use primary, subtly brighten toward middle
          segColor = lerpRgb(primary, light, ratio * 0.3)
        } else if (ratio < 0.85) {
          // Transition zone — blend primary to hot
          const t = (ratio - 0.65) / 0.2
          segColor = lerpRgb(primary, hot, t)
        } else {
          // Hot zone — full hot color
          segColor = hot
        }

        // Glow effect
        ctx.shadowColor = `rgba(${Math.round(segColor[0])}, ${Math.round(segColor[1])}, ${Math.round(segColor[2])}, 0.6)`
        ctx.shadowBlur = 4

        ctx.fillStyle = `rgb(${Math.round(segColor[0])}, ${Math.round(segColor[1])}, ${Math.round(segColor[2])})`
        ctx.fillRect(x, segY, barWidth, SEGMENT_HEIGHT)
      } else if (s === peakSegment && peakSegment > 0) {
        // Peak indicator segment
        const peakColor = brighten(primary, 0.5)
        ctx.shadowColor = `rgba(${Math.round(peakColor[0])}, ${Math.round(peakColor[1])}, ${Math.round(peakColor[2])}, 0.5)`
        ctx.shadowBlur = 3
        ctx.fillStyle = `rgba(${Math.round(peakColor[0])}, ${Math.round(peakColor[1])}, ${Math.round(peakColor[2])}, 0.85)`
        ctx.fillRect(x, segY, barWidth, SEGMENT_HEIGHT)
      } else {
        // Unlit segment — very faint outline for the grid effect
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
        ctx.fillRect(x, segY, barWidth, SEGMENT_HEIGHT)
      }
    }

    // Reset shadow for next bar
    ctx.shadowBlur = 0
  }

  drawFrame = requestAnimationFrame(draw)
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
