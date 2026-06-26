<template>
  <div
    ref="containerRef"
    class="overflow-auto scroll-container h-full"
    @scroll="handleScroll"
  >
    <div :style="{ height: totalHeight + 'px', position: 'relative' }">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        :style="{
          position: 'absolute',
          top: item.top + 'px',
          width: '100%',
        }"
        class="border-b border-theme hover:opacity-90 cursor-pointer transition"
        @click="$emit('select', item.data)"
      >
        <slot :item="item.data" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import { useVirtualScroll } from '@/composables/useVirtualScroll';

interface Props {
  items: any[];
  itemHeight?: number;
}

const props = withDefaults(defineProps<Props>(), {
  itemHeight: 80,
});

defineEmits<{
  select: [item: any];
}>();

const { items, itemHeight } = toRefs(props);

const { containerRef, totalHeight, visibleItems, handleScroll } = useVirtualScroll({
  items,
  itemHeight: itemHeight.value,
  buffer: 5,
});
</script>