<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue'
import { useData } from 'vitepress'

const { theme, page, frontmatter } = useData()

// Edit link logic
const hasEditLink = computed(() => {
  return theme.value.editLink && frontmatter.value.editLink !== false
})

const editLinkUrl = computed(() => {
  const pattern = theme.value.editLink?.pattern
  if (!pattern) return ''
  return pattern.replace(/:path/g, page.value.relativePath)
})

const editLinkText = computed(() => {
  return theme.value.editLink?.text || 'Edit this page on GitHub'
})

// Last updated logic
const date = computed(() => {
  if (!page.value.lastUpdated) return null
  return new Date(page.value.lastUpdated)
})

const commitUrl = computed(() => {
  const hash = frontmatter.value.lastUpdatedCommitHash
  if (!hash) return null
  const diffHash = frontmatter.value.lastUpdatedFileDiffHash
  const repo = theme.value.editLink?.pattern?.split('/edit/')[0] || 'https://github.com/looptroop-ai/LoopTroop'
  const anchor = diffHash ? `#diff-${diffHash}` : ''
  return `${repo}/commit/${hash}${anchor}`
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
  <div v-if="hasEditLink || date" class="custom-edit-info">
    <div v-if="hasEditLink" class="custom-edit-link">
      <a class="custom-edit-link-button" :href="editLinkUrl" target="_blank" rel="noopener noreferrer">
        <span class="custom-edit-link-icon" />
        {{ editLinkText }}
      </a>
    </div>

    <div v-if="date" class="custom-last-updated">
      <p class="custom-last-updated-text">
        {{ theme.lastUpdated?.text || theme.lastUpdatedText || 'Last updated' }}:
        <a v-if="commitUrl" :href="commitUrl" target="_blank" rel="noopener noreferrer" class="custom-commit-link">
          <time :datetime="isoDatetime">{{ datetime }}</time>
        </a>
        <time v-else :datetime="isoDatetime">{{ datetime }}</time>
      </p>
    </div>
  </div>
</template>

<style scoped>
.custom-edit-info {
  padding-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (min-width: 640px) {
  .custom-edit-info {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 14px;
  }
}

.custom-edit-link-button {
  display: flex;
  align-items: center;
  border: 0;
  line-height: 32px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  transition: color 0.25s;
}

.custom-edit-link-button:hover {
  color: var(--vp-c-brand-2);
}

.custom-edit-link-icon {
  margin-right: 8px;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 20h9'/><path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/></svg>") no-repeat center;
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 20h9'/><path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/></svg>") no-repeat center;
}

.custom-last-updated-text {
  line-height: 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.custom-commit-link {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-decoration-style: dotted;
  transition: color 0.25s;
}

.custom-commit-link:hover {
  color: var(--vp-c-brand-2);
  text-decoration-style: solid;
}

@media (min-width: 640px) {
  .custom-last-updated-text {
    line-height: 32px;
  }
}
</style>
