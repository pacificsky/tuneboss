import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let wakeLock = null
  let wantLock = false
  let sentinel = 0
  let pollTimer = null

  async function request() {
    const id = ++sentinel
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      if (id !== sentinel) {
        wakeLock.release()
        return
      }
      wakeLock.addEventListener('release', () => {
        if (id !== sentinel) return
        isActive.value = false
        wakeLock = null
        if (wantLock) request()
      })
      isActive.value = true
    } catch (err) {
      console.error(`[wakelock] ${err.name}, ${err.message}`)
    }
  }

  function handleVisibilityChange() {
    if (wantLock && document.visibilityState === 'visible') {
      setTimeout(() => { request() }, 1000)
    }
  }

  function poll() {
    if (wantLock && !wakeLock && document.visibilityState === 'visible') {
      request()
    }
  }

  onMounted(() => {
    if ('wakeLock' in navigator) {
      wantLock = true
      request()
      document.addEventListener('visibilitychange', handleVisibilityChange)
      pollTimer = setInterval(poll, 10000)
    }
  })

  onUnmounted(() => {
    wantLock = false
    clearInterval(pollTimer)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (wakeLock) {
      wakeLock.release()
      wakeLock = null
    }
  })

  return { isActive }
}
