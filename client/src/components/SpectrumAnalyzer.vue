<template>
  <div class="spectrum-analyzer">
    <canvas
      ref="canvasRef"
      :width="canvasWidth"
      :height="canvasHeight"
    ></canvas>

    <!-- Calibration prompt overlay -->
    <div v-if="showCalibrationPrompt" class="calibration-prompt">
      <p>Mute speakers, then tap to calibrate</p>
      <button class="calibration-btn" @click="onCalibrate">Calibrate</button>
      <button class="calibration-cancel" @click="onCancelCalibration">Cancel</button>
    </div>

    <!-- Calibrating indicator -->
    <div v-else-if="micCalibrating" class="calibration-prompt">
      <p>Calibrating...</p>
    </div>

    <!-- Post-calibration unmute reminder (auto-dismisses after 2s) -->
    <div v-else-if="showUnmuteMessage" class="calibration-prompt calibration-prompt--fade">
      <p>Unmute and play!</p>
    </div>

    <div class="toggle-row">
      <button
        v-if="micSupported"
        class="toggle-btn"
        :class="{
          'toggle-btn--listening': micCalibrating,
          'toggle-btn--active': micListening && !micCalibrating
        }"
        @click="toggleMic"
        aria-label="Toggle microphone analyzer"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>
      <button
        v-if="wakeLockSupported"
        class="toggle-btn"
        :class="{ 'toggle-btn--active': wakeLockActive }"
        @click="$emit('toggle-wake-lock')"
        aria-label="Toggle screen wake lock"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>
          <line x1="12" y1="2" x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="5" y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="4.93" x2="6.76" y2="6.76"/>
          <line x1="17.24" y1="17.24" x2="19.07" y2="19.07"/>
          <line x1="4.93" y1="19.07" x2="6.76" y2="17.24"/>
          <line x1="17.24" y1="6.76" x2="19.07" y2="4.93"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, toRef, watch, onMounted, onUnmounted } from 'vue'
import { useAudioAnalysis } from '../composables/useAudioAnalysis.js'
import { useMicrophoneAnalyzer } from '../composables/useMicrophoneAnalyzer.js'

const props = defineProps({
  trackId: { type: String, default: null },
  playback: { type: Object, default: () => ({ position: 0, timestamp: Date.now() }) },
  isPlaying: { type: Boolean, default: true },
  spectrumColors: { type: Object, default: null },
  spectrumStyle: { type: String, default: 'modern' },
  wakeLockSupported: { type: Boolean, default: false },
  wakeLockActive: { type: Boolean, default: false }
})

defineEmits(['toggle-wake-lock'])

const canvasRef = ref(null)
const canvasWidth = 340
const canvasHeight = 100

// Procedural spectrum (existing — always runs as fallback)
const { bands, peaks } = useAudioAnalysis(
  toRef(props, 'trackId'),
  toRef(props, 'playback'),
  toRef(props, 'isPlaying')
)

// Microphone-based real spectrum
const {
  isSupported: micSupported,
  isListening: micListening,
  isCalibrating: micCalibrating,
  isMusicDetected: micDetected,
  bands: micBands,
  peaks: micPeaks,
  start: micStart,
  calibrate: micCalibrate,
  stop: micStop
} = useMicrophoneAnalyzer()

const showCalibrationPrompt = ref(false)
const showUnmuteMessage = ref(false)
let unmuteTimer = null

// When calibration finishes, flash "Unmute and play" for 2s
watch(micCalibrating, (calibrating, wasCalibrating) => {
  if (wasCalibrating && !calibrating && micListening.value) {
    showUnmuteMessage.value = true
    clearTimeout(unmuteTimer)
    unmuteTimer = setTimeout(() => { showUnmuteMessage.value = false }, 2000)
  }
})

async function toggleMic() {
  if (micListening.value) {
    // Already listening — stop
    micStop()
    showCalibrationPrompt.value = false
  } else if (showCalibrationPrompt.value) {
    // Prompt is showing — cancel
    showCalibrationPrompt.value = false
  } else {
    // First tap: acquire mic permission, then show calibration prompt
    const granted = await micStart()
    if (granted) {
      showCalibrationPrompt.value = true
    }
  }
}

function onCalibrate() {
  showCalibrationPrompt.value = false
  micCalibrate()
}

function onCancelCalibration() {
  showCalibrationPrompt.value = false
  micStop()
}

const NUM_BANDS = 10
const BAR_GAP = 4
const SEGMENT_GAP = 2
const SEGMENT_HEIGHT_MODERN = 5
const SEGMENT_HEIGHT_RETRO = 8

// Retro dot-grid rendering (Sony boombox LED-matrix style)
const DOT_GRID_COLS = 4
const DOT_GRID_ROWS = 1
const DOT_GAP = 1 // thin dark line between cells

// Default fallback colors (cyan / red like the reference image)
const DEFAULT_PRIMARY = [0, 210, 210]
const DEFAULT_LIGHT = [100, 255, 255]
const DEFAULT_HOT = [255, 50, 50]

let drawFrame = null

// Crossfade blend factor: 0 = procedural, 1 = microphone
let blendFactor = 0
const BLEND_SPEED = 0.04 // ~25 frames (~0.4s) for full transition

// Afterglow: per-band trail that decays slower than the bar itself,
// drawn as fading segments between the current level and the glow boundary.
const AFTERGLOW_DECAY = 0.965 // per frame @ 60fps → half-life ~20 frames (~0.33s)
const AFTERGLOW_MAX_ALPHA = 0.35
let afterglow = new Array(NUM_BANDS).fill(0)

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

// Draw a segment — style-dependent
function drawSegment(ctx, x, y, width, height, retro) {
  if (!retro) {
    ctx.fillRect(x, y, width, height)
    return
  }
  // Retro: grid of tightly-packed square cells with thin dark gaps
  const cellW = (width - (DOT_GRID_COLS - 1) * DOT_GAP) / DOT_GRID_COLS
  const cellH = (height - (DOT_GRID_ROWS - 1) * DOT_GAP) / DOT_GRID_ROWS

  for (let r = 0; r < DOT_GRID_ROWS; r++) {
    for (let c = 0; c < DOT_GRID_COLS; c++) {
      const cx = x + c * (cellW + DOT_GAP)
      const cy = y + r * (cellH + DOT_GAP)
      ctx.fillRect(cx, cy, cellW, cellH)
    }
  }
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

  // Ease the blend factor toward its target.
  // Mic mode is an explicit user choice — stay on mic data for the entire
  // session, even during silence.  Music detection only drives the icon color.
  const blendTarget = micListening.value && !micCalibrating.value ? 1 : 0
  blendFactor += (blendTarget - blendFactor) * BLEND_SPEED
  if (Math.abs(blendFactor - blendTarget) < 0.001) blendFactor = blendTarget

  // Resolve colors from album art or use defaults
  const sc = props.spectrumColors
  const primary = sc ? sc.primary : DEFAULT_PRIMARY
  const light = sc ? sc.light : DEFAULT_LIGHT
  const hot = deriveHotColor(primary)

  const retro = props.spectrumStyle === 'retro'
  const segHeight = retro ? SEGMENT_HEIGHT_RETRO : SEGMENT_HEIGHT_MODERN

  const totalGaps = (NUM_BANDS - 1) * BAR_GAP
  const barWidth = (canvasWidth - totalGaps) / NUM_BANDS
  const maxBarHeight = canvasHeight - 6 // leave room at top for peak
  const totalSegments = Math.floor(maxBarHeight / (segHeight + SEGMENT_GAP))

  for (let i = 0; i < NUM_BANDS; i++) {
    const x = i * (barWidth + BAR_GAP)

    // Blend procedural and microphone band/peak values
    const procBand = bands.value[i] || 0
    const micBand = micBands.value[i] || 0
    const bandVal = Math.min(1, procBand * (1 - blendFactor) + micBand * blendFactor)

    const procPeak = peaks.value[i] || 0
    const micPeak = micPeaks.value[i] || 0
    const peakVal = Math.min(1, procPeak * (1 - blendFactor) + micPeak * blendFactor)

    const litSegments = Math.round(bandVal * totalSegments)
    const peakSegment = Math.round(peakVal * totalSegments)

    // Update afterglow: instant attack, slow decay
    if (bandVal >= afterglow[i]) {
      afterglow[i] = bandVal
    } else {
      afterglow[i] *= AFTERGLOW_DECAY
      if (afterglow[i] < 0.01) afterglow[i] = 0
    }
    const glowSegments = Math.round(afterglow[i] * totalSegments)

    // Draw segments bottom-up
    for (let s = 0; s < totalSegments; s++) {
      const segY = canvasHeight - (s + 1) * (segHeight + SEGMENT_GAP)
      const ratio = s / totalSegments // 0 = bottom, 1 = top

      // Compute the color for this segment's vertical position
      let segColor
      if (ratio < 0.65) {
        segColor = lerpRgb(primary, light, ratio * 0.3)
      } else if (ratio < 0.85) {
        const t = (ratio - 0.65) / 0.2
        segColor = lerpRgb(primary, hot, t)
      } else {
        segColor = hot
      }

      if (s < litSegments) {
        // Lit segment
        ctx.shadowColor = `rgba(${Math.round(segColor[0])}, ${Math.round(segColor[1])}, ${Math.round(segColor[2])}, 0.6)`
        ctx.shadowBlur = 4
        ctx.fillStyle = `rgb(${Math.round(segColor[0])}, ${Math.round(segColor[1])}, ${Math.round(segColor[2])})`
        drawSegment(ctx, x, segY, barWidth, segHeight, retro)
      } else if (s === peakSegment && peakSegment > 0) {
        // Peak indicator segment (takes priority over afterglow)
        const peakColor = brighten(primary, 0.5)
        ctx.shadowColor = `rgba(${Math.round(peakColor[0])}, ${Math.round(peakColor[1])}, ${Math.round(peakColor[2])}, 0.5)`
        ctx.shadowBlur = 3
        ctx.fillStyle = `rgba(${Math.round(peakColor[0])}, ${Math.round(peakColor[1])}, ${Math.round(peakColor[2])}, 0.85)`
        drawSegment(ctx, x, segY, barWidth, segHeight, retro)
      } else if (s < glowSegments) {
        // Afterglow: fades from near-current to transparent at the glow boundary
        const t = (s - litSegments) / Math.max(1, glowSegments - litSegments)
        const glowAlpha = AFTERGLOW_MAX_ALPHA * (1 - t)
        ctx.shadowBlur = 0
        ctx.fillStyle = `rgba(${Math.round(segColor[0])}, ${Math.round(segColor[1])}, ${Math.round(segColor[2])}, ${glowAlpha})`
        drawSegment(ctx, x, segY, barWidth, segHeight, retro)
      } else {
        // Unlit segment — very faint outline for the grid effect
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
        drawSegment(ctx, x, segY, barWidth, segHeight, retro)
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
  clearTimeout(unmuteTimer)
})
</script>

<style scoped>
.spectrum-analyzer {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}

.spectrum-analyzer canvas {
  display: block;
}

.calibration-prompt {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 8px;
  z-index: 1;
}

.calibration-prompt--fade {
  animation: overlay-fade 2s ease forwards;
}

.calibration-prompt p {
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  margin: 0;
  text-align: center;
}

.calibration-btn {
  background: rgba(29, 185, 84, 0.3);
  color: rgba(29, 185, 84, 1);
  border: 1px solid rgba(29, 185, 84, 0.4);
  border-radius: 16px;
  padding: 6px 20px;
  font-size: 13px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.calibration-btn:active {
  transform: scale(0.95);
}

.calibration-cancel {
  background: none;
  color: rgba(255, 255, 255, 0.4);
  border: none;
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.toggle-row {
  display: flex;
  gap: 0.5rem;
}

.toggle-btn {
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
}

.toggle-btn:active {
  transform: scale(0.9);
}

.toggle-btn--listening {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.5);
  animation: mic-pulse 2s ease infinite;
}

.toggle-btn--active {
  background: rgba(29, 185, 84, 0.2);
  color: rgba(29, 185, 84, 0.9);
  animation: none;
}

@keyframes overlay-fade {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; pointer-events: none; }
}

@keyframes mic-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
