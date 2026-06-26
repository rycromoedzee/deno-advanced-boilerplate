import { computed, Ref, ref } from "vue";

interface VirtualScrollOptions {
  items: Ref<any[]>;
  itemHeight: number;
  buffer?: number;
}

export function useVirtualScroll(options: VirtualScrollOptions) {
  const { items, itemHeight, buffer = 5 } = options;

  const containerRef = ref<HTMLElement | null>(null);
  const visibleStart = ref(0);
  const visibleEnd = ref(0);

  const totalHeight = computed(() => items.value.length * itemHeight);

  const visibleItems = computed(() => {
    return items.value
      .slice(visibleStart.value, visibleEnd.value)
      .map((item, index) => ({
        data: item,
        top: (visibleStart.value + index) * itemHeight,
        id: `${visibleStart.value + index}`,
      }));
  });

  const handleScroll = (e: Event) => {
    const el = e.target as HTMLElement;
    const scrollTop = el.scrollTop;
    const containerHeight = el.clientHeight;

    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.value.length, start + visibleCount + buffer * 2);

    visibleStart.value = start;
    visibleEnd.value = end;
  };

  return {
    containerRef,
    totalHeight,
    visibleItems,
    handleScroll,
  };
}
