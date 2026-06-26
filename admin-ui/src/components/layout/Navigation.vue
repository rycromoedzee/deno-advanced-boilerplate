<template>
  <nav class="flex gap-1">
    <router-link
      v-for="route in routes"
      :key="route.path"
      :to="route.path"
      class="px-5 py-2 text-gray-300 no-underline font-medium text-sm transition-all hover:text-white rounded"
      active-class="text-white bg-slate-600/30"
    >
      {{ route.label }}
    </router-link>
  </nav>
</template>

<script setup lang="ts">
const routes = [
  { path: '/internal/__admin/cache', label: 'Cache Visualizer' },
  { path: '/internal/__admin/tracing', label: 'Tracing' },
  { path: '/internal/__admin/threat-intel', label: 'Threat Intelligence' },
];
</script>