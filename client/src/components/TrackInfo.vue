<template>
  <div class="track-info">
    <h1 class="track-info__title">{{ title }}</h1>
    <p class="track-info__artist">{{ artist }}</p>
    <p class="track-info__album">{{ album }}</p>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  artist: { type: String, default: '' },
  album: { type: String, default: '' }
})
</script>

<style scoped>
.track-info {
  text-align: center;
  padding: 0 1.5rem;
  max-width: 100%;
}

.track-info__title {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.2;
  margin-bottom: 0.35rem;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.track-info__artist {
  font-size: 1.1rem;
  font-weight: 400;
  opacity: 0.8;
  margin-bottom: 0.2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-info__album {
  font-size: 0.85rem;
  font-weight: 300;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
