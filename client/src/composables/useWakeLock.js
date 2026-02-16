import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let sentinel = null
  let refreshInterval = null

  async function request() {
    if (!('wakeLock' in navigator)) return false
    if (document.visibilityState !== 'visible') return false

    try {
      const s = await navigator.wakeLock.request('screen')

      // Replace the previous sentinel (if any) so its stale release
      // listener can no longer flip isActive to false.
      sentinel = s
      isActive.value = true

      s.addEventListener('release', () => {
        // Ignore if a newer sentinel has already replaced this one.
        if (sentinel !== s) return

        sentinel = null
        isActive.value = false

        // Immediately try to re-acquire — iOS Safari can release the
        // lock silently for power-management reasons while the page is
        // still visible.  Re-requesting right away closes the gap
        // before the screen auto-locks.
        if (document.visibilityState === 'visible') {
          request()
        }
      })

      return true
    } catch (err) {
      console.warn('[wakelock] request failed:', err.message)
      return false
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return

    // Re-acquire when returning to the foreground — iOS releases the
    // wake lock whenever the page is hidden.
    request()
  }

  onMounted(() => {
    request()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Safety net: periodically check and re-acquire if the lock was
    // silently dropped without firing a release event.
    refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && !isActive.value) {
        request()
      }
    }, 10_000)
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (sentinel) {
      sentinel.release()
      sentinel = null
    }
    if (refreshInterval) clearInterval(refreshInterval)
  })

  return { isActive }
}
