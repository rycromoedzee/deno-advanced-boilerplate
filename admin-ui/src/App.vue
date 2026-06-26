<template>
  <div class="h-screen overflow-hidden">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useTheme } from '@/composables/useTheme';

const { initializeTheme } = useTheme();

onMounted(() => {
  initializeTheme();
});
</script>