<script setup lang="ts">
import { useData } from 'vitepress'
import { computed, onMounted, ref } from 'vue'

const storageKey = 'outline-collapsed'
const htmlClass = 'outline-collapsed'
const isCollapsed = ref(false)
const { frontmatter, theme } = useData()

const canToggleOutline = computed(() => {
  const layout = frontmatter.value.layout
  const pageAside = frontmatter.value.aside
  const themeAside = theme.value.aside

  return (
    layout !== false &&
    layout !== 'home' &&
    layout !== 'page' &&
    pageAside !== false &&
    pageAside !== 'left' &&
    themeAside !== false &&
    themeAside !== 'left'
  )
})

const updateHtmlClass = () => {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.classList.toggle(htmlClass, isCollapsed.value)
}

const toggleOutline = () => {
  isCollapsed.value = !isCollapsed.value
  updateHtmlClass()
  localStorage.setItem(storageKey, isCollapsed.value ? 'true' : 'false')
}

onMounted(() => {
  isCollapsed.value = localStorage.getItem(storageKey) === 'true'
  updateHtmlClass()
})
</script>

<template>
  <button
    v-if="canToggleOutline"
    class="outline-toggle"
    :class="{ 'is-collapsed': isCollapsed }"
    type="button"
    :aria-label="isCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'"
    :aria-pressed="isCollapsed"
    :title="isCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'"
    @click="toggleOutline"
  >
    <span class="outline-toggle__icon" aria-hidden="true" />
  </button>
</template>

<style scoped>
.outline-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  z-index: 100;
}

.outline-toggle:hover,
.outline-toggle:focus-visible {
  background: var(--vp-c-bg-soft);
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

.outline-toggle__icon {
  width: 8px;
  height: 8px;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.2s;
}

.outline-toggle.is-collapsed .outline-toggle__icon {
  transform: rotate(225deg);
}

@media (min-width: 1280px) {
  .outline-toggle {
    display: flex;
  }
}
</style>
