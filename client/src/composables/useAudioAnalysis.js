import { ref, watch, onUnmounted } from 'vue'

const NUM_BANDS = 10

// Simple hash to derive per-track seed from trackId
function hashCode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h
}

// Seeded PRNG (mulberry32) — deterministic sequence per track
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Attempt to derive a plausible BPM from the track duration.
// Most popular music is 90–150 BPM.  We hash the trackId to pick
// a value in that range so each song gets a consistent tempo.
function deriveTempo(seed) {
  const rng = mulberry32(seed)
  return 90 + rng() * 60 // 90–150 BPM
}

// Generate smooth per-band amplitude curves using layered sine waves
// with frequencies/phases seeded by the track.
function buildBandOscillators(seed) {
  const rng = mulberry32(seed)
  const oscillators = []
  for (let b = 0; b < NUM_BANDS; b++) {
    // Each band gets 3 layered sinusoids with different speeds
    const layers = []
    for (let l = 0; l < 3; l++) {
      layers.push({
        freq: 0.3 + rng() * 1.2,   // cycles per second
        phase: rng() * Math.PI * 2, // starting phase
        amp: 0.25 + rng() * 0.35    // contribution weight
      })
    }
    oscillators.push(layers)
  }
  return oscillators
}

export function useAudioAnalysis(trackId, playback) {
  const bands = ref(new Array(NUM_BANDS).fill(0))
  const peaks = ref(new Array(NUM_BANDS).fill(0))
  let animFrame = null
  let startTime = 0
  let startPosition = 0

  // Per-track state
  let bpm = 120
  let oscillators = []
  let beatPhase = 0

  function applyTrack(id) {
    if (!id) return
    const seed = hashCode(id)
    bpm = deriveTempo(seed)
    oscillators = buildBandOscillators(seed)
    beatPhase = (seed & 0xff) / 255 * Math.PI * 2
  }

  function getCurrentPosition() {
    return startPosition + (Date.now() - startTime) / 1000
  }

  const PEAK_DECAY = 0.015
  const SMOOTH_FACTOR = 0.25

  function animate() {
    if (!oscillators.length) {
      animFrame = requestAnimationFrame(animate)
      return
    }

    const t = getCurrentPosition()
    const beatInterval = 60 / bpm
    // Pulsing envelope synced to the derived BPM
    const beatT = ((t / beatInterval) + beatPhase) % 1
    const beatPulse = 0.5 + 0.5 * Math.cos(beatT * Math.PI * 2)

    const computed = new Array(NUM_BANDS)
    for (let b = 0; b < NUM_BANDS; b++) {
      let val = 0
      const layers = oscillators[b]
      for (let l = 0; l < layers.length; l++) {
        const { freq, phase, amp } = layers[l]
        val += amp * (0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2 + phase))
      }
      // Mix in the beat pulse — lower bands feel it more
      const beatWeight = 0.4 * (1 - b / NUM_BANDS)
      val = val * (1 - beatWeight) + beatPulse * beatWeight
      computed[b] = Math.max(0, Math.min(1, val))
    }

    const curBands = bands.value
    const curPeaks = peaks.value
    const newBands = []
    const newPeaks = []

    for (let i = 0; i < NUM_BANDS; i++) {
      const smoothed = curBands[i] + (computed[i] - curBands[i]) * SMOOTH_FACTOR
      newBands.push(smoothed)
      newPeaks.push(smoothed > curPeaks[i] ? smoothed : Math.max(0, curPeaks[i] - PEAK_DECAY))
    }

    bands.value = newBands
    peaks.value = newPeaks

    animFrame = requestAnimationFrame(animate)
  }

  watch(trackId, (id) => applyTrack(id), { immediate: true })

  watch(playback, (p) => {
    if (p) {
      startPosition = (p.position || 0) / 1000
      startTime = p.timestamp || Date.now()
    }
  }, { immediate: true })

  animFrame = requestAnimationFrame(animate)

  onUnmounted(() => {
    if (animFrame) cancelAnimationFrame(animFrame)
  })

  return { bands, peaks }
}
