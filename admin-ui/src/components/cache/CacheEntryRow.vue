<template>
  <div class="border-b border-theme">
    <div
      class="grid grid-cols-12 gap-4 p-4 hover:opacity-50 cursor-pointer items-center transition"
      @click="$emit('toggle')"
    >
      <div class="col-span-1 flex items-center gap-2">
        <span class="font-medium text-sm text-theme-primary capitalize">{{ item.namespace }}</span>
      </div>
      <div class="col-span-4 text-sm text-theme-secondary" style="overflow-wrap: break-word;">
        {{ item.key }}
      </div>
      <div class="col-span-1 text-sm text-theme-secondary">{{ item.group }}</div>
      <div class="col-span-1 text-sm text-theme-secondary">{{ item.createdAt }}</div>
      <div class="col-span-2 text-sm text-theme-secondary min-w-[250px]">
        {{ item.expiresAt ? item.expiresAt + ' (TTL: ' + item.ttl + ')' : 'N/A' }}
      </div>
      <div class="col-span-1 text-sm text-theme-secondary">{{ item.size }} KB</div>
      <div class="col-span-1">
        <span
          :class="[
            'px-2 py-1 text-xs rounded-full',
            item.status === 'active' ? 'bg-green-100 text-green-800' :
            item.status === 'expired' ? 'bg-red-100 text-red-800' : ''
          ]"
        >
          {{ item.status }}
        </span>
      </div>
      <div class="col-span-1">
        <svg
          class="w-4 h-4 transform transition-transform"
          :class="{ 'rotate-180': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </div>
    </div>

    <!-- Expanded Details -->
    <div v-if="isExpanded" class="px-4 py-6 bg-theme-bg border border-theme">
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div class="flex flex-col gap-3">
          <div><strong>Namespace:</strong> {{ item.details?.namespace }}</div>
          <div><strong>Key:</strong> {{ item.details?.key }}</div>
          <div><strong>Group:</strong> {{ item.details?.group }}</div>
          <div><strong>Created At:</strong> {{ item.details?.createdAt }}</div>
          <div>
            <strong>Expires at:</strong>
            {{ item.details.expiresAt ? item.details.expiresAt + ' (TTL: ' + item.details.ttl + 's)' : 'N/A' }}
          </div>
          <div><strong>Size:</strong> {{ item.details?.size }} KB</div>
        </div>
        <div>
          <strong>Data:</strong>
          <pre class="whitespace-pre-wrap max-h-40 overflow-auto p-3 bg-theme-card border-theme border rounded-md shadow">{{ item.details?.data }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface CacheEntryDetails {
  namespace: string;
  key: string;
  createdAt: string;
  expiresAt: string;
  ttl: string | null;
  size: string;
  group: string;
  data: unknown;
}

interface CacheEntry {
  id: string;
  namespace: string;
  key: string;
  createdAt: string;
  expiresAt: string | null;
  ttl: string | null;
  size: string;
  status: 'active' | 'expired';
  group: string;
  details: CacheEntryDetails;
}

interface Props {
  item: CacheEntry;
  isExpanded: boolean;
}

defineProps<Props>();

defineEmits<{
  toggle: [];
}>();
</script>