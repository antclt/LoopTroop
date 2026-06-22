<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue'
import { useData } from 'vitepress'

const { theme, page } = useData()

const date = computed(() => {
  if (!page.value.lastUpdated) return null
  return new Date(page.value.lastUpdated)
})

const isoDatetime = computed(() => date.value ? date.value.toISOString() : '')
const datetime = ref('')

onMounted(() => {
  watchEffect(() => {
    if (!date.value) return
    const d = date.value
    const day = String(d.getUTCDate()).padStart(2, '0')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[d.getUTCMonth()]
    const year = d.getUTCFullYear()
    const hours = String(d.getUTCHours()).padStart(2, '0')
    const minutes = String(d.getUTCMinutes()).padStart(2, '0')
    datetime.value = `${day}/${month}/${year}, ${hours}:${minutes} UTC`
  })
})
</script>

<template>
  <p v-if="date" class="VPLastUpdated">
    {{ theme.lastUpdated?.text || theme.lastUpdatedText || 'Last updated' }}:
    <time :datetime="isoDatetime">{{ datetime }}</time>
  </p>
</template>

<style scoped>
.VPLastUpdated {
  line-height: 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

@media (min-width: 640px) {
  .VPLastUpdated {
    line-height: 32px;
    font-size: 14px;
    font-weight: 500;
  }
}
</style>
