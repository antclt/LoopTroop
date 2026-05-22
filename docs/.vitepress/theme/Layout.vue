<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import GoToTop from './GoToTop.vue'
import ImageLightbox from './ImageLightbox.vue'
import SidebarToggle from './SidebarToggle.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <SidebarToggle />
    </template>
    <template #layout-bottom>
      <GoToTop />
      <ImageLightbox />
    </template>
  </Layout>
</template>
