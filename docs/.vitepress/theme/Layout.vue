<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import GoToTop from './GoToTop.vue'
import ImageLightbox from './ImageLightbox.vue'
import OutlineToggle from './OutlineToggle.vue'
import SidebarToggle from './SidebarToggle.vue'
import CustomDocFooter from './CustomDocFooter.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <SidebarToggle />
    </template>
    <template #nav-bar-content-after>
      <OutlineToggle />
    </template>
    <template #doc-footer-before>
      <CustomDocFooter />
    </template>
    <template #layout-bottom>
      <GoToTop />
      <ImageLightbox />
    </template>
  </Layout>
</template>
