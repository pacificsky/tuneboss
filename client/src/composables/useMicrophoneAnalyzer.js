import { ref, onUnmounted } from 'vue'

const NUM_BANDS = 10
const FFT_SIZE = 2048

// Logarithmic frequency band edges (Hz) for 10 perceptual bands.
// Each band spans roughly one octave in the musically interesting range.
const BAND_EDGES = [20, 60, 150, 300, 600, 1200, 2400, 4800, 8000, 14000, 20000]

// Music detection: we look for sustained energy spread across multiple bands.
// Pure noise or a single transient (door slam) won't trigger this.
const ENERGY_THRESHOLD = 12   // min average energy (0–255 byte scale) after noise subtraction
const SPREAD_THRESHOLD = 4    // min number of active bands for "music" vs "noise/speech"
const CONFIDENCE_BUILD = 30   // frames of consistent detection → "confident" (~0.5s at 60 fps)
const CONFIDENCE_DECAY_RATE = 2

// Auto-normalization keeps the bars filling the visual range regardless of
// mic distance or speaker volume.  Fast attack (responds to loud hits),
// slow decay (doesn't collapse during quiet passages).
const NORM_ATTACK = 0.12
const NORM_DECAY = 0.0008
const NORM_MIN = 30 // floor to avoid amplifying silence

const PEAK_DECAY = 0.015
const SMOOTH_FACTOR = 0.3

// Noise floor calibration: capture N frames of ambient noise on startup,
// then subtract the per-bin average from all subsequent frames.
const CALIBRATION_FRAMES = 45 // ~0.75s at 60 fps
const NOISE_MARGIN = 1.3      // subtract 130% of measured noise for a clean floor

// Per-band gain curve to compensate for iPhone mic's high-frequency rolloff.
// Lower bands (0–3) get no boost; upper bands (7–9) get progressively more.
// Values tuned empirically — enough to show cymbal/hi-hat energy without
// amplifying noise in bands where no signal exists.
const BAND_GAIN = [1.0, 1.0, 1.0, 1.0, 1.1, 1.3, 1.6, 2.0, 2.5, 3.0]

export function useMicrophoneAnalyzer() {
  const isSupported = ref(
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
  const isListening = ref(false)
  const isMusicDetected = ref(false)
  const bands = ref(new Array(NUM_BANDS).fill(0))
  const peaks = ref(new Array(NUM_BANDS).fill(0))

  let audioContext = null
  let analyser = null
  let mediaStream = null
  let sourceNode = null
  let animFrame = null
  let frequencyData = null
  let bandBinRanges = []
  let confidenceCounter = 0
  let normMax = NORM_MIN

  // Noise floor calibration state
  let isCalibrating = false
  let calibrationCount = 0
  let calibrationAccum = null // Float64Array accumulating per-bin sums
  let noiseFloor = null       // Uint8Array of per-bin noise floor values

  // Convert Hz band edges to FFT bin indices based on actual sample rate
  function calculateBandRanges(sampleRate) {
    const binHz = sampleRate / FFT_SIZE
    const ranges = []
    for (let i = 0; i < NUM_BANDS; i++) {
      const low = Math.max(1, Math.floor(BAND_EDGES[i] / binHz))
      const high = Math.min(Math.floor(BAND_EDGES[i + 1] / binHz), FFT_SIZE / 2 - 1)
      ranges.push({ low, high: Math.max(low, high) })
    }
    return ranges
  }

  function animate() {
    if (!analyser || !frequencyData) {
      animFrame = requestAnimationFrame(animate)
      return
    }

    analyser.getByteFrequencyData(frequencyData)

    // --- Noise floor calibration phase ---
    if (isCalibrating) {
      for (let i = 0; i < frequencyData.length; i++) {
        calibrationAccum[i] += frequencyData[i]
      }
      calibrationCount++

      if (calibrationCount >= CALIBRATION_FRAMES) {
        // Compute per-bin noise floor (average × margin)
        noiseFloor = new Uint8Array(frequencyData.length)
        for (let i = 0; i < frequencyData.length; i++) {
          noiseFloor[i] = Math.min(255,
            Math.round((calibrationAccum[i] / calibrationCount) * NOISE_MARGIN)
          )
        }
        isCalibrating = false
        calibrationAccum = null
      }

      // During calibration, output silence (bars stay at zero)
      animFrame = requestAnimationFrame(animate)
      return
    }

    // --- Normal processing: subtract noise floor, aggregate bands ---
    const rawBands = new Array(NUM_BANDS)
    let totalEnergy = 0
    let activeBandCount = 0

    for (let b = 0; b < NUM_BANDS; b++) {
      const { low, high } = bandBinRanges[b]
      let sum = 0
      let count = 0
      for (let bin = low; bin <= high; bin++) {
        // Subtract per-bin noise floor, clamp to zero
        const cleaned = noiseFloor
          ? Math.max(0, frequencyData[bin] - noiseFloor[bin])
          : frequencyData[bin]
        sum += cleaned
        count++
      }
      const avg = count > 0 ? sum / count : 0
      // Apply per-band gain to compensate for mic rolloff at high frequencies
      rawBands[b] = avg * BAND_GAIN[b]
      totalEnergy += rawBands[b]
      if (rawBands[b] > 20) activeBandCount++
    }

    // Auto-normalization: track a running maximum with fast attack / slow decay
    const maxBand = Math.max(...rawBands)
    if (maxBand > normMax) {
      normMax += (maxBand - normMax) * NORM_ATTACK
    } else {
      normMax = Math.max(NORM_MIN, normMax - normMax * NORM_DECAY)
    }

    // Normalize bands to 0–1 range
    const computed = new Array(NUM_BANDS)
    for (let b = 0; b < NUM_BANDS; b++) {
      computed[b] = Math.min(1, rawBands[b] / normMax)
    }

    // Music detection: sustained energy across multiple frequency bands
    const avgEnergy = totalEnergy / NUM_BANDS
    const musicNow = avgEnergy > ENERGY_THRESHOLD && activeBandCount >= SPREAD_THRESHOLD

    if (musicNow) {
      confidenceCounter = Math.min(confidenceCounter + 1, CONFIDENCE_BUILD * 2)
    } else {
      confidenceCounter = Math.max(confidenceCounter - CONFIDENCE_DECAY_RATE, 0)
    }
    isMusicDetected.value = confidenceCounter >= CONFIDENCE_BUILD

    // Exponential smoothing + peak tracking (same approach as procedural analyzer)
    const curBands = bands.value
    const curPeaks = peaks.value
    const newBands = []
    const newPeaks = []

    for (let i = 0; i < NUM_BANDS; i++) {
      const smoothed = curBands[i] + (computed[i] - curBands[i]) * SMOOTH_FACTOR
      newBands.push(smoothed)
      newPeaks.push(
        smoothed > curPeaks[i] ? smoothed : Math.max(0, curPeaks[i] - PEAK_DECAY)
      )
    }

    bands.value = newBands
    peaks.value = newPeaks

    animFrame = requestAnimationFrame(animate)
  }

  async function start() {
    if (!isSupported.value) return false

    try {
      // Request raw mic input — disable all processing so the FFT
      // reflects the actual acoustic signal, not a cleaned-up version
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })

      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      await audioContext.resume() // required on iOS — must follow user gesture

      sourceNode = audioContext.createMediaStreamSource(mediaStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.75

      sourceNode.connect(analyser)
      // Intentionally NOT connecting to destination — we don't want to
      // play the mic audio through the speakers (feedback loop)

      frequencyData = new Uint8Array(analyser.frequencyBinCount)
      bandBinRanges = calculateBandRanges(audioContext.sampleRate)

      // Begin noise floor calibration: accumulate ambient noise for ~0.75s
      isCalibrating = true
      calibrationCount = 0
      calibrationAccum = new Float64Array(analyser.frequencyBinCount)
      noiseFloor = null

      confidenceCounter = 0
      normMax = NORM_MIN
      isListening.value = true

      animFrame = requestAnimationFrame(animate)
      return true
    } catch (err) {
      console.warn('Microphone access failed:', err)
      return false
    }
  }

  function stop() {
    if (animFrame) {
      cancelAnimationFrame(animFrame)
      animFrame = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    analyser = null
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop())
      mediaStream = null
    }
    frequencyData = null
    isListening.value = false
    isMusicDetected.value = false
    confidenceCounter = 0
    normMax = NORM_MIN
    isCalibrating = false
    calibrationCount = 0
    calibrationAccum = null
    noiseFloor = null
    // Note: bands/peaks are intentionally NOT reset here.
    // SpectrumAnalyzer crossfades using a blend factor — stale mic values
    // are harmless and allow the transition back to procedural to be smooth.
  }

  onUnmounted(() => stop())

  return {
    isSupported,
    isListening,
    isMusicDetected,
    bands,
    peaks,
    start,
    stop
  }
}
