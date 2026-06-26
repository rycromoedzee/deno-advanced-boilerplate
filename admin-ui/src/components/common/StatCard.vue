<template>
  <div class="relative overflow-hidden rounded-lg bg-theme-card px-4 pb-6 pt-5 shadow border border-theme sm:px-6 sm:pt-6">
    <dt>
      <p class="truncate text-sm font-medium text-theme-primary mb-4">
        {{ label }}
      </p>
    </dt>
    <dd class="flex items-baseline justify-between">
      <p class="text-2xl font-bold" :style="{ color: color || 'var(--accent-primary)' }">
        {{ displayValue }}
      </p>
    </dd>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  value: string | number;
  label: string;
  color?: string;
  formatter?: (value: any) => string;
}

const props = defineProps<Props>();

const displayValue = computed(() => {
  if (props.formatter) {
    return props.formatter(props.value);
  }
  return props.value;
});
</script>