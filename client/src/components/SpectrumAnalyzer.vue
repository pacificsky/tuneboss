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

    <button
      v-if="micSupported"
      class="mic-toggle"
      :class="{
        'mic-toggle--listening': micListening && !micCalibrating,
        'mic-toggle--active': micDetected
      }"
      @click="toggleMic"
      aria-label="Toggle microphone analyzer"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref, toRef, watch, onMounted, onUnmounted } from 'vue'
import { useAudioAnalysis } from '../composables/useAudioAnalysis.js'
import { useMicrophoneAnalyzer } from '../composables/useMicrophoneAnalyzer.js'

const props = defineProps({
  trackId: { type: String, default: null },
  playback: { type: Object, default: () => ({ position: 0, timestamp: Date.now() }) },
  spectrumColors: { type: Object, default: null }
})

const canvasRef = ref(null)
const canvasWidth = 340
const canvasHeight = 100

// Procedural spectrum (existing — always runs as fallback)
const { bands, peaks } = useAudioAnalysis(
  toRef(props, 'trackId'),
  toRef(props, 'playback')
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
const SEGMENT_HEIGHT = 5

// Default fallback colors (cyan / red like the reference image)
const DEFAULT_PRIMARY = [0, 210, 210]
const DEFAULT_LIGHT = [100, 255, 255]
const DEFAULT_HOT = [255, 50, 50]

let drawFrame = null

// Crossfade blend factor: 0 = procedural, 1 = microphone
let blendFactor = 0
const BLEND_SPEED = 0.04 // ~25 frames (~0.4s) for full transition

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

  const totalGaps = (NUM_BANDS - 1) * BAR_GAP
  const barWidth = (canvasWidth - totalGaps) / NUM_BANDS
  const maxBarHeight = canvasHeight - 6 // leave room at top for peak
  const totalSegments = Math.floor(maxBarHeight / (SEGMENT_HEIGHT + SEGMENT_GAP))

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

.mic-toggle {
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

.mic-toggle:active {
  transform: scale(0.9);
}

.mic-toggle--listening {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.5);
  animation: mic-pulse 2s ease infinite;
}

.mic-toggle--active {
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
