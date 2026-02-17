<template>
  <div
    v-if="active"
    :key="wipeKey"
    class="track-wipe"
    :class="`track-wipe--${currentVariant}`"
    :style="{ backgroundColor: color }"
    @animationend="active = false"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  trackId: { type: String, default: null },
  color: { type: String, default: 'rgb(255, 255, 255)' },
  interval: { type: Number, default: 10 }
})

const active = ref(false)
const wipeKey = ref(0)
const trackChangeCount = ref(0)

const variants = ['horizontal', 'vertical', 'radial', 'diagonal']
const currentVariant = computed(() => variants[wipeKey.value % variants.length])

watch(() => props.trackId, (newId, oldId) => {
  // Only wipe on genuine track-to-track transitions, not initial load or stop/resume
  if (!newId || !oldId) return
  const count = trackChangeCount.value++
  if (count % props.interval !== 0) return
  wipeKey.value++
  active.value = true
})
</script>

<style scoped>
.track-wipe {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.45;
  transition: background-color 1s ease;
}

/* 1. Horizontal sweep — enters from left, exits right */
.track-wipe--horizontal {
  animation: wipe-horizontal 1.7s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

@keyframes wipe-horizontal {
  0%   { clip-path: inset(0 100% 0 0); }
  35%  { clip-path: inset(0 0 0 0); }
  50%  { clip-path: inset(0 0 0 0); }
  100% { clip-path: inset(0 0 0 100%); }
}

/* 2. Vertical sweep — enters from top, exits bottom */
.track-wipe--vertical {
  animation: wipe-vertical 1.7s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

@keyframes wipe-vertical {
  0%   { clip-path: inset(0 0 100% 0); }
  35%  { clip-path: inset(0 0 0 0); }
  50%  { clip-path: inset(0 0 0 0); }
  100% { clip-path: inset(100% 0 0 0); }
}

/* 3. Radial iris — blooms from album art center, fades out */
.track-wipe--radial {
  animation: wipe-radial 1.9s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

@keyframes wipe-radial {
  0%   { clip-path: circle(0% at 50% 35%); opacity: 0.45; }
  45%  { clip-path: circle(150% at 50% 35%); opacity: 0.45; }
  65%  { clip-path: circle(150% at 50% 35%); opacity: 0.45; }
  100% { clip-path: circle(150% at 50% 35%); opacity: 0; }
}

/* 4. Diagonal wipe — angled edge sweeps top-left to bottom-right */
.track-wipe--diagonal {
  animation: wipe-diagonal 1.7s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
}

@keyframes wipe-diagonal {
  0%   { clip-path: polygon(0 0, 0 0, 0 100%, 0 100%); }
  35%  { clip-path: polygon(0 0, 120% 0, 100% 100%, 0 100%); }
  50%  { clip-path: polygon(0 0, 120% 0, 100% 100%, 0 100%); }
  100% { clip-path: polygon(120% 0, 120% 0, 100% 100%, 100% 100%); }
}
</style>
