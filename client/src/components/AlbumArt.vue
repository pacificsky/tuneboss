<template>
  <div class="album-art" :class="{ transitioning }">
    <img
      v-if="src"
      :src="src"
      :key="src"
      alt="Album art"
      class="album-art__image"
      crossorigin="anonymous"
      @load="onImageLoad"
    />
    <div v-else class="album-art__placeholder">♪</div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import Vibrant from 'node-vibrant'

const props = defineProps({
  src: { type: String, default: null }
})

const emit = defineEmits(['colors-extracted'])
const transitioning = ref(false)

let lastExtractedSrc = null

async function onImageLoad(event) {
  const img = event.target
  if (!img || img.src === lastExtractedSrc) return
  lastExtractedSrc = img.src

  try {
    const palette = await Vibrant.from(img).getPalette()
    const vibrant = palette.Vibrant || palette.Muted || palette.DarkVibrant
    const darkMuted = palette.DarkMuted || palette.DarkVibrant

    if (vibrant && darkMuted) {
      const bgRgb = darkMuted.rgb
      const textRgb = vibrant.rgb

      // Ensure text has enough contrast on the dark background
      const bg = `rgb(${Math.round(bgRgb[0] * 0.4)}, ${Math.round(bgRgb[1] * 0.4)}, ${Math.round(bgRgb[2] * 0.4)})`
      const text = `rgb(${Math.round(textRgb[0])}, ${Math.round(textRgb[1])}, ${Math.round(textRgb[2])})`

      emit('colors-extracted', { bg, text })
    }
  } catch (err) {
    console.warn('Color extraction failed:', err)
  }
}

watch(() => props.src, () => {
  transitioning.value = true
  setTimeout(() => { transitioning.value = false }, 600)
})
</script>

<style scoped>
.album-art {
  width: 100%;
  max-width: 320px;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}

.album-art__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.6s ease;
}

.transitioning .album-art__image {
  animation: fade-in 0.6s ease;
}

.album-art__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 4rem;
  opacity: 0.2;
  background: rgba(255, 255, 255, 0.05);
}

@keyframes fade-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
