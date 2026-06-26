<template>
  <header class="sticky top-0 z-50 bg-slate-800 border-b border-slate-700 shadow-lg">
    <div class="mx-auto max-w-screen-2xl px-8 py-4">
      <!-- First Row: Logo/Title and Theme Toggle -->
      <div class="flex items-center justify-between mb-4 pt-0">
        <!-- Logo/Title on the left -->
        <div class="flex items-center text-xl font-bold tracking-tight text-white flex-shrink-0">
          <img
            class="w-10 h-10 mr-3"
            src="https://i.ibb.co/LhdSsx9P/5877b12b-337c-4d24-926e-96f719bc37cd-removebg-preview.png"
            alt="Logo"
          />
          <span>Map Cache Insights</span>
        </div>

        <!-- Theme Toggle on the right -->
        <div class="flex-shrink-0">
          <ThemeToggle />
        </div>
      </div>

      <!-- Second Row: Navigation -->
      <div>
        <Navigation />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import ThemeToggle from '@/components/common/ThemeToggle.vue';
import Navigation from './Navigation.vue';
</script>