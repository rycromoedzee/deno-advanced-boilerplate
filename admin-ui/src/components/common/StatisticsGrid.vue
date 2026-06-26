<template>
  <div>
    <!-- Loading State -->
    <div v-if="loading" class="mt-5 grid gap-5 grid-cols-3">
      <div
        v-for="i in skeletonCount"
        :key="i"
        class="relative overflow-hidden rounded-lg bg-theme-card px-4 pb-12 pt-5 shadow border border-theme sm:px-6 sm:pt-6"
      >
        <div class="animate-pulse">
          <div class="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
          <div class="h-8 bg-gray-300 rounded w-1/2"></div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <dl v-else class="mt-5 grid gap-5 grid-cols-3">
      <div
        v-for="item in stats"
        :key="item.id"
        class="relative overflow-hidden rounded-lg bg-theme-card px-4 pb-6 pt-5 shadow border border-theme sm:px-6 sm:pt-6"
      >
        <dt>
          <p class="truncate text-sm font-medium text-theme-primary mb-4">
            {{ item.name }}
          </p>
        </dt>
        <div class="divide-y divide-[--bg-primary] max-h-36 pr-4 scroll-container" style="scrollbar-width: thin">
          <dd
            class="flex items-baseline justify-between py-1"
            v-for="stat in item.stat"
            :key="stat.name"
          >
            <p class="text-sm text-theme-primary capitalize">{{ stat.name }}</p>
            <p class="text-sm text-theme-primary capitalize">{{ stat.val }}</p>
          </dd>
        </div>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
interface StatItem {
  name: string;
  val: string | number;
}

interface StatGroup {
  id: string;
  name: string;
  stat: StatItem[];
}

interface Props {
  stats: StatGroup[];
  loading?: boolean;
  skeletonCount?: number;
}

withDefaults(defineProps<Props>(), {
  loading: false,
  skeletonCount: 2,
});
</script>