import { ref, watch, onUnmounted } from 'vue'

const NUM_BANDS = 10

// Map 12 Spotify pitch classes to 10 display bands
// Pitch classes: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
// Bands roughly group: low → mid → high
const PITCH_TO_BAND = [0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 7, 8]
// Bands 9 is driven by timbre high-frequency component

export function useAudioAnalysis(analysis, playback) {
  const bands = ref(new Array(NUM_BANDS).fill(0))
  const peaks = ref(new Array(NUM_BANDS).fill(0))
  let animFrame = null
  let segments = []
  let startTime = 0
  let startPosition = 0

  function findSegmentIndex(positionSec) {
    // Binary search for the segment at this position
    let lo = 0
    let hi = segments.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const seg = segments[mid]
      if (positionSec < seg.start) {
        hi = mid - 1
      } else if (positionSec >= seg.start + seg.duration) {
        lo = mid + 1
      } else {
        return mid
      }
    }
    return Math.max(0, lo - 1)
  }

  function getCurrentPosition() {
    const elapsed = (Date.now() - startTime) / 1000
    return startPosition + elapsed
  }

  function computeBands(seg, nextSeg, progress) {
    const result = new Array(NUM_BANDS).fill(0)

    if (!seg) return result

    // Normalize loudness: Spotify loudness is in dB (typically -60 to 0)
    // Map to 0..1 range
    const loudness = Math.max(0, Math.min(1, (seg.loudnessMax + 60) / 60))

    // Map pitches to bands
    for (let i = 0; i < 12; i++) {
      const band = PITCH_TO_BAND[i]
      const pitch = seg.pitches[i] || 0

      // Interpolate with next segment if available
      let value = pitch
      if (nextSeg && progress > 0) {
        const nextPitch = nextSeg.pitches[i] || 0
        value = pitch + (nextPitch - pitch) * progress
      }

      result[band] = Math.max(result[band], value * loudness)
    }

    // Band 9: driven by timbre high-frequency energy
    if (seg.timbre) {
      const highFreqTimbre = Math.max(0, seg.timbre[1] || 0) / 200
      result[9] = Math.min(1, highFreqTimbre * loudness)
    }

    // Normalize band values that got multiple pitch contributions
    // Bands 0, 2, 4 get 2 pitches each — average them
    result[0] /= 1.5
    result[2] /= 1.5
    result[4] /= 1.5

    return result
  }

  const PEAK_DECAY = 0.015 // per frame
  const SMOOTH_FACTOR = 0.3

  function animate() {
    if (!segments.length) {
      animFrame = requestAnimationFrame(animate)
      return
    }

    const posSec = getCurrentPosition()
    const idx = findSegmentIndex(posSec)
    const seg = segments[idx]
    const nextSeg = segments[idx + 1] || null

    // Progress within current segment (0..1)
    const progress = seg ? Math.min(1, (posSec - seg.start) / seg.duration) : 0

    const computed = computeBands(seg, nextSeg, progress)
    const currentBands = bands.value
    const currentPeaks = peaks.value
    const newBands = []
    const newPeaks = []

    for (let i = 0; i < NUM_BANDS; i++) {
      // Smooth transition
      const smoothed = currentBands[i] + (computed[i] - currentBands[i]) * SMOOTH_FACTOR
      newBands.push(smoothed)

      // Peak hold with decay
      if (smoothed > currentPeaks[i]) {
        newPeaks.push(smoothed)
      } else {
        newPeaks.push(Math.max(0, currentPeaks[i] - PEAK_DECAY))
      }
    }

    bands.value = newBands
    peaks.value = newPeaks

    animFrame = requestAnimationFrame(animate)
  }

  watch(analysis, (a) => {
    if (a?.segments) {
      segments = a.segments
    }
  }, { immediate: true })

  watch(playback, (p) => {
    if (p) {
      startPosition = (p.position || 0) / 1000 // ms -> sec
      startTime = p.timestamp || Date.now()
    }
  }, { immediate: true })

  // Start animation loop
  animFrame = requestAnimationFrame(animate)

  onUnmounted(() => {
    if (animFrame) cancelAnimationFrame(animFrame)
  })

  return { bands, peaks }
}
