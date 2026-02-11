import { ref, onMounted, onUnmounted } from 'vue'

export function useWakeLock() {
  const isActive = ref(false)
  let wakeLock = null

  async function request() {
    if (!('wakeLock' in navigator)) {
      console.warn('Screen Wake Lock API not supported')
      return
    }

    try {
      wakeLock = await navigator.wakeLock.request('screen')
      isActive.value = true

      wakeLock.addEventListener('release', () => {
        isActive.value = false
      })
    } catch (err) {
      console.warn('Wake lock request failed:', err.message)
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && !isActive.value) {
      request()
    }
  }

  onMounted(() => {
    request()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (wakeLock) {
      wakeLock.release()
    }
  })

  return { isActive }
}
