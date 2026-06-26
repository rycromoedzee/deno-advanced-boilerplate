<template>
  <div class="h-screen flex flex-col bg-theme-bg overflow-hidden">
    <div class="flex-shrink-0">
      <Header />
    </div>
    <main class="mx-auto max-w-screen-2xl flex-1 flex flex-col relative overflow-hidden w-full">
      <div class="mx-auto max-w-full pb-12 px-8 w-full flex flex-col flex-1 overflow-hidden">
        <router-view />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import Header from './Header.vue';
</script>