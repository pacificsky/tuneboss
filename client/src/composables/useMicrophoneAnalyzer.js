import { ref, onUnmounted } from 'vue'

const NUM_BANDS = 10
const FFT_SIZE = 2048

// Frequency band edges (Hz) for 10 bands.  Nine bands cover 20–2400 Hz with
// roughly octave spacing where the phone mic has strong signal; the final band
// lumps all upper frequencies (2400–20 kHz) into a single wide bar.
const BAND_EDGES = [20, 55, 100, 160, 250, 400, 630, 1000, 1500, 2400, 20000]

// Music detection: we look for sustained energy spread across multiple bands.
// Pure noise or a single transient (door slam) won't trigger this.
const ENERGY_THRESHOLD = 12   // min average energy (0–255 byte scale) after noise subtraction
const SPREAD_THRESHOLD = 4    // min number of active bands for "music" vs "noise/speech"
const CONFIDENCE_BUILD = 30   // frames of consistent detection → "confident" (~0.5s at 60 fps)
const CONFIDENCE_DECAY_RATE = 2

// Auto-normalization keeps the bars filling the visual range regardless of
// mic distance or speaker volume.  Fast attack (responds to loud hits),
// slow decay (doesn't collapse during quiet passages).
const NORM_ATTACK = 0.25
const NORM_DECAY = 0.0008
const NORM_MIN = 30      // floor to avoid amplifying silence
const NORM_HEADROOM = 1.25 // normalize to 125% of running max → steady signal sits ~80%

const PEAK_DECAY = 0.015
const SMOOTH_FACTOR = 0.3

// Noise floor calibration: capture N frames of ambient noise, then subtract
// the per-bin average from all subsequent frames. The user is prompted to
// mute speakers before calibration, so the snapshot contains only room noise.
const CALIBRATION_FRAMES = 120 // ~2s at 60 fps
const NOISE_MARGIN = 1.3      // subtract 130% of measured noise for a clean floor

// Perceptual weighting.  Bands 0–8 sit in the mic's sweet spot and need no
// boost.  Band 9 spans 2400–20 kHz — its average is diluted by hundreds of
// near-silent high-frequency bins, so it gets an 8× gain to compensate.
//
// Band centers (Hz):  33    74   126   200   316   502   794  1225  1897  6928
const BAND_GAIN = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 8.0]

export function useMicrophoneAnalyzer() {
  const isSupported = ref(
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
  const isListening = ref(false)
  const isCalibrating = ref(false)
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
  // Per-band normalization: each band tracks its own running maximum so that
  // quieter high-frequency bands aren't crushed by the dominant bass energy.
  let normMaxPerBand = new Array(NUM_BANDS).fill(NORM_MIN)

  // Noise floor state
  let calibrating = false
  let calibrationCount = 0
  let calibrationAccum = null
  let noiseFloor = null // per-band noise floor values (post-aggregation)

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

  // Aggregate raw FFT bins into a single band average
  function bandAverage(bandIndex) {
    const { low, high } = bandBinRanges[bandIndex]
    let sum = 0
    let count = 0
    for (let bin = low; bin <= high; bin++) {
      sum += frequencyData[bin]
      count++
    }
    return count > 0 ? sum / count : 0
  }

  function animate() {
    if (!analyser || !frequencyData) {
      animFrame = requestAnimationFrame(animate)
      return
    }

    analyser.getByteFrequencyData(frequencyData)

    // --- Calibration phase: accumulate per-band averages ---
    if (calibrating) {
      for (let b = 0; b < NUM_BANDS; b++) {
        calibrationAccum[b] += bandAverage(b)
      }
      calibrationCount++

      if (calibrationCount >= CALIBRATION_FRAMES) {
        noiseFloor = new Array(NUM_BANDS)
        for (let b = 0; b < NUM_BANDS; b++) {
          noiseFloor[b] = (calibrationAccum[b] / calibrationCount) * NOISE_MARGIN
        }
        calibrating = false
        isCalibrating.value = false
        calibrationAccum = null
      }

      // During calibration, output silence
      animFrame = requestAnimationFrame(animate)
      return
    }

    // --- Normal processing: subtract noise floor, aggregate bands ---
    const rawBands = new Array(NUM_BANDS)
    let totalEnergy = 0
    let activeBandCount = 0

    for (let b = 0; b < NUM_BANDS; b++) {
      const avg = bandAverage(b)
      const floor = noiseFloor ? noiseFloor[b] : 0
      const cleaned = Math.max(0, avg - floor) * BAND_GAIN[b]
      rawBands[b] = cleaned
      totalEnergy += cleaned
      if (cleaned > 20) activeBandCount++
    }

    // Per-band auto-normalization: each band tracks its own running maximum
    // with fast attack / slow decay.  NORM_HEADROOM prevents steady-state
    // signals from pegging to 100% — typical level sits at ~67%, leaving
    // room for real peaks to punch up to full height.
    const computed = new Array(NUM_BANDS)
    for (let b = 0; b < NUM_BANDS; b++) {
      if (rawBands[b] > normMaxPerBand[b]) {
        normMaxPerBand[b] += (rawBands[b] - normMaxPerBand[b]) * NORM_ATTACK
      } else {
        normMaxPerBand[b] = Math.max(NORM_MIN, normMaxPerBand[b] - normMaxPerBand[b] * NORM_DECAY)
      }
      computed[b] = Math.min(1, rawBands[b] / (normMaxPerBand[b] * NORM_HEADROOM))
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

  // Opens mic and gets permission, but does NOT start the animation loop yet.
  // Returns true if mic access was granted.
  async function start() {
    if (!isSupported.value) return false

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })

      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      await audioContext.resume()

      sourceNode = audioContext.createMediaStreamSource(mediaStream)
      analyser = audioContext.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.75

      sourceNode.connect(analyser)

      frequencyData = new Uint8Array(analyser.frequencyBinCount)
      bandBinRanges = calculateBandRanges(audioContext.sampleRate)

      confidenceCounter = 0
      normMaxPerBand = new Array(NUM_BANDS).fill(NORM_MIN)
      isListening.value = true

      return true
    } catch (err) {
      console.warn('Microphone access failed:', err)
      return false
    }
  }

  // Begin noise-floor calibration. The caller is responsible for ensuring
  // speakers are muted before calling this. After ~1s of sampling, the
  // animation loop starts automatically.
  function calibrate() {
    if (!analyser || !frequencyData) return

    calibrating = true
    isCalibrating.value = true
    calibrationCount = 0
    calibrationAccum = new Array(NUM_BANDS).fill(0)
    noiseFloor = null

    // Start animation loop — it will run calibration, then seamlessly
    // transition to normal processing once calibration completes.
    if (!animFrame) {
      animFrame = requestAnimationFrame(animate)
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
    isCalibrating.value = false
    isMusicDetected.value = false
    confidenceCounter = 0
    normMaxPerBand = new Array(NUM_BANDS).fill(NORM_MIN)
    calibrating = false
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
    isCalibrating,
    isMusicDetected,
    bands,
    peaks,
    start,
    calibrate,
    stop
  }
}
