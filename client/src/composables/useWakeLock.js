import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let wakeLock = null

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
    if (wakeLock !== null && document.visibilityState === 'visible') {
      setTimeout(() => { request() }, 1000)
    }
  }

  onMounted(() => {
    if ('wakeLock' in navigator) {
      request()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (wakeLock) {
      wakeLock.release()
      wakeLock = null
    }
  })

  return { isActive }
}
