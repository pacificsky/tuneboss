import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let wakeLock = null
  let wantLock = false

  async function request() {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => {
        isActive.value = false
        wakeLock = null
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

  onMounted(() => {
    if ('wakeLock' in navigator) {
      wantLock = true
      request()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  onUnmounted(() => {
    wantLock = false
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (wakeLock) {
      wakeLock.release()
      wakeLock = null
    }
  })

  return { isActive }
}
