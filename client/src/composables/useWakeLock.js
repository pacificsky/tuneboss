import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let wakeLock = null
  let noSleepVideo = null
  let refreshInterval = null

  async function requestNative() {
    if (!('wakeLock' in navigator)) return false

    try {
      wakeLock = await navigator.wakeLock.request('screen')
      isActive.value = true

      wakeLock.addEventListener('release', () => {
        isActive.value = false
      })
      return true
    } catch (err) {
      console.warn('[wakelock] Native request failed:', err.message)
      return false
    }
  }

  // Fallback for insecure contexts (HTTP on local network) where the
  // Screen Wake Lock API is unavailable. A looping silent video tricks
  // iOS into keeping the screen on.
  function startVideoFallback() {
    if (noSleepVideo) return

    noSleepVideo = document.createElement('video')
    noSleepVideo.setAttribute('playsinline', '')
    noSleepVideo.setAttribute('loop', '')
    noSleepVideo.muted = true
    noSleepVideo.src = '/silence.mp4'
    noSleepVideo.style.cssText =
      'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;'
    document.body.appendChild(noSleepVideo)

    tryPlayVideo()
  }

  function tryPlayVideo() {
    if (!noSleepVideo) return
    noSleepVideo.play()
      .then(() => { isActive.value = true })
      .catch(() => {
        // iOS requires a user gesture before playback is allowed.
        // Wait for the first tap then retry.
        document.addEventListener('touchstart', onUserGesture, { once: true })
        document.addEventListener('click', onUserGesture, { once: true })
      })
  }

  function onUserGesture() {
    document.removeEventListener('touchstart', onUserGesture)
    document.removeEventListener('click', onUserGesture)
    tryPlayVideo()
  }

  async function acquire() {
    const nativeOk = await requestNative()
    if (!nativeOk) {
      console.log('[wakelock] Native API unavailable, using video fallback')
      startVideoFallback()
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return

    // Re-acquire when returning to the foreground — iOS releases the
    // wake lock whenever the page is hidden.
    if (wakeLock) {
      requestNative()
    } else if (noSleepVideo) {
      noSleepVideo.play().catch(() => {})
    }
  }

  onMounted(() => {
    acquire()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Guard against silent wake-lock releases by re-requesting
    // periodically while the page is visible.
    refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && !isActive.value) {
        acquire()
      }
    }, 30_000)
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    document.removeEventListener('touchstart', onUserGesture)
    document.removeEventListener('click', onUserGesture)
    if (wakeLock) wakeLock.release()
    if (noSleepVideo) {
      noSleepVideo.pause()
      noSleepVideo.remove()
    }
    if (refreshInterval) clearInterval(refreshInterval)
  })

  return { isActive }
}
