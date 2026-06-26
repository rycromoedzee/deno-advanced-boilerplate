<template>
  <div class="flex flex-col gap-6 p-6 h-full overflow-auto min-w-full">
    <!-- Error State -->
    <ErrorAlert
      v-if="error"
      :message="error"
      @retry="loadAllData"
    />

    <!-- Header & Global Stats -->
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-bold text-theme-primary">Threat Intelligence</h1>
      <div class="flex gap-2">
        <button
          @click="reloadService"
          :disabled="reloading"
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {{ reloading ? 'Reloading...' : 'Reload Service' }}
        </button>
        <button
          @click="loadAllData"
          class="px-4 py-2 bg-theme-card text-theme-primary border border-theme rounded hover:bg-theme-hover transition"
        >
          Refresh Data
        </button>
      </div>
    </div>

    <!-- Stats Grid -->
    <StatisticsGrid
      :stats="topStats"
      :loading="loading"
    />

    <!-- Tabs -->
    <div class="border-b border-theme">
      <nav class="-mb-px flex space-x-8">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            activeTab === tab.id
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-theme-secondary hover:text-theme-primary hover:border-theme',
            'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition'
          ]"
        >
          {{ tab.name }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="flex-1 min-h-0">
      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-theme-card p-6 rounded-lg shadow-sm border border-theme">
          <h3 class="text-lg font-medium text-theme-primary mb-4">Bloom Filter Performance</h3>
          <div v-if="performance?.bloomFilter" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Hit Rate</p>
                <p class="text-xl font-semibold text-theme-primary">{{ (performance.bloomFilter.hitRate * 100).toFixed(2) }}%</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Avg Response</p>
                <p class="text-xl font-semibold text-theme-primary">{{ performance.bloomFilter.averageResponseTimeMs.toFixed(2) }}ms</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Utilization</p>
                <p class="text-xl font-semibold text-theme-primary">{{ (performance.bloomFilter.utilization * 100).toFixed(2) }}%</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">False Positive Rate</p>
                <p class="text-xl font-semibold text-theme-primary">{{ (performance.bloomFilter.falsePositiveRate * 100).toFixed(4) }}%</p>
              </div>
            </div>
            <div class="pt-4 border-t border-theme">
              <div class="flex justify-between text-sm mb-1">
                <span class="text-theme-secondary">Elements:</span>
                <span class="text-theme-primary font-medium">{{ performance.bloomFilter.totalElements.toLocaleString() }} / {{ performance.bloomFilter.totalCapacity.toLocaleString() }}</span>
              </div>
              <div class="w-full bg-theme-bg rounded-full h-2">
                <div class="bg-blue-500 h-2 rounded-full" :style="{ width: `${performance.bloomFilter.utilization * 100}%` }"></div>
              </div>
            </div>
          </div>
          <div v-else class="animate-pulse space-y-4">
            <div class="h-20 bg-theme-bg rounded"></div>
            <div class="h-20 bg-theme-bg rounded"></div>
          </div>
        </div>

        <div class="bg-theme-card p-6 rounded-lg shadow-sm border border-theme">
          <h3 class="text-lg font-medium text-theme-primary mb-4">Whitelist Performance</h3>
          <div v-if="performance?.whitelist" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Cache Hit Rate</p>
                <p class="text-xl font-semibold text-theme-primary">{{ (performance.whitelist.hitRate * 100).toFixed(2) }}%</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Avg Load Time</p>
                <p class="text-xl font-semibold text-theme-primary">{{ performance.whitelist.averageLoadTime.toFixed(2) }}ms</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Total Lookups</p>
                <p class="text-xl font-semibold text-theme-primary">{{ performance.whitelist.totalLookups.toLocaleString() }}</p>
              </div>
              <div class="p-3 bg-theme-bg rounded">
                <p class="text-xs text-theme-secondary uppercase">Memory Efficiency</p>
                <p class="text-xl font-semibold text-theme-primary">{{ performance.whitelist.memoryEfficiency.toFixed(2) }} entries/KB</p>
              </div>
            </div>
          </div>
          <div v-else class="animate-pulse space-y-4">
            <div class="h-20 bg-theme-bg rounded"></div>
            <div class="h-20 bg-theme-bg rounded"></div>
          </div>
        </div>

        <div class="bg-theme-card p-6 rounded-lg shadow-sm border border-theme md:col-span-2">
          <h3 class="text-lg font-medium text-theme-primary mb-4">System Health</h3>
          <div v-if="health" class="space-y-4">
            <div class="flex items-center gap-3 mb-4">
              <div :class="[
                health.overallStatus === 'healthy' ? 'bg-green-500' : health.overallStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500',
                'w-4 h-4 rounded-full'
              ]"></div>
              <span class="text-lg font-semibold capitalize text-theme-primary">{{ health.overallStatus }}</span>
              <span class="text-theme-secondary">- {{ health.summary }}</span>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div v-for="(check, name) in health.checks" :key="name" class="p-4 border border-theme rounded-lg bg-theme-bg">
                <div class="flex justify-between items-start mb-2">
                  <span class="text-sm font-medium capitalize text-theme-primary">{{ name }}</span>
                  <span :class="check.status ? 'text-green-500' : 'text-red-500'">
                    <svg v-if="check.status" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                    <svg v-else class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>
                  </span>
                </div>
                <p class="text-xs text-theme-secondary">{{ check.message }}</p>
              </div>
            </div>

            <div v-if="health.recommendedActions.length > 0" class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 class="text-sm font-bold text-blue-800 mb-2">Recommended Actions:</h4>
              <ul class="list-disc list-inside text-sm text-blue-700">
                <li v-for="action in health.recommendedActions" :key="action">{{ action }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Sources Tab -->
      <div v-if="activeTab === 'sources'" class="bg-theme-card rounded-lg shadow-sm border border-theme flex flex-col h-full overflow-hidden">
        <div class="grid grid-cols-5 gap-4 p-4 bg-theme-bg border-b border-theme text-xs font-medium text-theme-secondary uppercase tracking-wider flex-shrink-0">
          <div>Name</div>
          <div>Status</div>
          <div>Entries</div>
          <div>Frequency</div>
          <div>Last Updated</div>
        </div>
        <div class="flex-1 overflow-auto scroll-container">
          <div v-for="source in sources" :key="source.id" class="grid grid-cols-5 gap-4 p-4 border-b border-theme hover:bg-theme-hover transition items-center">
            <div class="overflow-hidden">
              <div class="text-sm font-medium text-theme-primary truncate">{{ source.name }}</div>
              <div class="text-xs text-theme-secondary truncate">{{ source.url }}</div>
            </div>
            <div>
              <span :class="[
                source.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800',
                'px-2 inline-flex text-xs leading-5 font-semibold rounded-full'
              ]">
                {{ source.isActive ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <div class="text-sm text-theme-primary">
              {{ source.totalEntries.toLocaleString() }}
              <span class="text-xs text-theme-secondary block">IPs: {{ source.stats.threatIPsCount }}, CIDRs: {{ source.stats.threatCIDRsCount }}</span>
            </div>
            <div class="text-sm text-theme-primary">
              Every {{ source.updateFrequency }}h
            </div>
            <div class="text-sm text-theme-secondary">
              {{ formatDate(source.updatedAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Whitelist Tab -->
      <div v-if="activeTab === 'whitelist'" class="bg-theme-card rounded-lg shadow-sm border border-theme flex flex-col h-full overflow-hidden">
        <div class="flex justify-end p-4 pb-0">
          <button
            @click="showAddWhitelistModal = true"
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-medium mb-2"
          >
            + Add to Whitelist
          </button>
        </div>
        <div class="grid grid-cols-6 gap-4 p-4 bg-theme-bg border-b border-theme text-xs font-medium text-theme-secondary uppercase tracking-wider flex-shrink-0 items-center">
          <div>Value</div>
          <div>Type</div>
          <div>Reason</div>
          <div>Added By</div>
          <div>Created At</div>
          <div>Actions</div>
        </div>
        <div ref="whitelistScrollContainer" class="flex-1 overflow-auto scroll-container">
          <div v-for="entry in whitelistEntries" :key="entry.id" class="grid grid-cols-6 gap-4 p-4 border-b border-theme hover:bg-theme-hover transition items-center">
            <div class="text-sm font-medium text-theme-primary truncate">{{ entry.value }}</div>
            <div class="text-sm text-theme-secondary uppercase">{{ entry.type }}</div>
            <div class="text-sm text-theme-primary truncate">{{ entry.reason || '-' }}</div>
            <div class="text-sm text-theme-primary truncate">{{ entry.addedBy || 'System' }}</div>
            <div class="text-sm text-theme-secondary">{{ formatDate(entry.createdAt) }}</div>
            <div class="flex justify-end">
              <button
                @click="confirmRemoveWhitelistEntry(entry)"
                class="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
                title="Remove from whitelist"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          
          <div v-if="loadingWhitelist" class="p-4 flex justify-center">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
          <div v-else-if="!hasMoreWhitelist && whitelistEntries.length > 0" class="p-4 text-center text-sm text-theme-secondary">
            End of results
          </div>
        </div>
      </div>

      <!-- Custom Blacklist Tab -->
      <div v-if="activeTab === 'custom-blacklist'" class="bg-theme-card rounded-lg shadow-sm border border-theme flex flex-col h-full overflow-hidden">
        <div class="flex justify-end p-4 pb-0">
          <button
            @click="showAddCustomBlacklistModal = true"
            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm font-medium mb-2"
          >
            + Add to Blacklist
          </button>
        </div>
        <div class="grid grid-cols-6 gap-4 p-4 bg-theme-bg border-b border-theme text-xs font-medium text-theme-secondary uppercase tracking-wider flex-shrink-0 items-center">
          <div>Value</div>
          <div>Type</div>
          <div>Reason</div>
          <div>Risk Score</div>
          <div>Category</div>
          <div>Actions</div>
        </div>
        <div ref="customBlacklistScrollContainer" class="flex-1 overflow-auto scroll-container">
          <div v-for="entry in customBlacklistEntries" :key="entry.id" class="grid grid-cols-6 gap-4 p-4 border-b border-theme hover:bg-theme-hover transition items-center">
            <div class="text-sm font-medium text-theme-primary truncate">{{ entry.value }}</div>
            <div class="text-sm text-theme-secondary uppercase">{{ entry.type }}</div>
            <div class="text-sm text-theme-primary truncate">{{ entry.reason || '-' }}</div>
            <div class="text-sm text-red-600 font-medium">{{ entry.riskScore }}</div>
            <div class="text-sm text-theme-secondary capitalize">{{ entry.category }}</div>
            <div class="flex justify-end">
              <button
                @click="confirmRemoveCustomBlacklistEntry(entry)"
                class="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
                title="Remove from blacklist"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          
          <div v-if="loadingCustomBlacklist" class="p-4 flex justify-center">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-red-500"></div>
          </div>
          <div v-else-if="!hasMoreCustomBlacklist && customBlacklistEntries.length > 0" class="p-4 text-center text-sm text-theme-secondary">
            End of results
          </div>
        </div>
      </div>

      <!-- Add Whitelist Modal -->
      <div v-if="showAddWhitelistModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-theme-card rounded-lg shadow-xl border border-theme max-w-md w-full mx-4">
          <div class="flex justify-between items-center p-6 border-b border-theme">
            <h3 class="text-lg font-semibold text-theme-primary">Add to Whitelist</h3>
            <button
              @click="showAddWhitelistModal = false"
              class="text-theme-secondary hover:text-theme-primary transition"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form @submit.prevent="submitWhitelistEntry" class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">Type</label>
              <select
                v-model="whitelistForm.type"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ip">IP Address</option>
                <option value="cidr">CIDR Block</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">
                {{ whitelistForm.type === 'ip' ? 'IP Address' : 'CIDR Block' }}
              </label>
              <input
                v-model="whitelistForm.value"
                :placeholder="whitelistForm.type === 'ip' ? 'e.g., 192.168.1.100' : 'e.g., 192.168.1.0/24'"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                :class="{ 'border-red-500': whitelistFormError }"
              />
              <p v-if="whitelistFormError" class="mt-1 text-sm text-red-500">{{ whitelistFormError }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">Reason (Optional)</label>
              <textarea
                v-model="whitelistForm.reason"
                rows="3"
                placeholder="Why is this being whitelisted?"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div class="flex justify-end gap-3 pt-4">
              <button
                type="button"
                @click="showAddWhitelistModal = false"
                class="px-4 py-2 bg-theme-card text-theme-primary border border-theme rounded hover:bg-theme-hover transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                :disabled="submittingWhitelist"
                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {{ submittingWhitelist ? 'Adding...' : 'Add to Whitelist' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Remove Confirmation Modal -->
      <div v-if="showRemoveModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-theme-card rounded-lg shadow-xl border border-theme max-w-sm w-full mx-4">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-theme-primary mb-2">Remove from Whitelist</h3>
            <p class="text-sm text-theme-secondary mb-6">
              Are you sure you want to remove <span class="font-medium text-theme-primary">{{ removeTarget?.value }}</span> from the whitelist?
            </p>
            <div class="flex justify-end gap-3">
              <button
                @click="showRemoveModal = false"
                class="px-4 py-2 bg-theme-card text-theme-primary border border-theme rounded hover:bg-theme-hover transition"
              >
                Cancel
              </button>
              <button
                @click="confirmRemove"
                :disabled="removingWhitelist"
                class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition"
              >
                {{ removingWhitelist ? 'Removing...' : 'Remove' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Custom Blacklist Modal -->
      <div v-if="showAddCustomBlacklistModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-theme-card rounded-lg shadow-xl border border-theme max-w-md w-full mx-4">
          <div class="flex justify-between items-center p-6 border-b border-theme">
            <h3 class="text-lg font-semibold text-theme-primary">Add to Blacklist</h3>
            <button
              @click="showAddCustomBlacklistModal = false"
              class="text-theme-secondary hover:text-theme-primary transition"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form @submit.prevent="submitCustomBlacklistEntry" class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">Type</label>
              <select
                v-model="customBlacklistForm.type"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="ip">IP Address</option>
                <option value="cidr">CIDR Block</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">
                {{ customBlacklistForm.type === 'ip' ? 'IP Address' : 'CIDR Block' }}
              </label>
              <input
                v-model="customBlacklistForm.value"
                :placeholder="customBlacklistForm.type === 'ip' ? 'e.g., 192.168.1.100' : 'e.g., 192.168.1.0/24'"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                :class="{ 'border-red-500': customBlacklistFormError }"
              />
              <p v-if="customBlacklistFormError" class="mt-1 text-sm text-red-500">{{ customBlacklistFormError }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-theme-primary mb-2">Reason (Optional)</label>
              <textarea
                v-model="customBlacklistForm.reason"
                rows="3"
                placeholder="Why is this being blacklisted?"
                class="w-full px-3 py-2 bg-theme-bg border border-theme rounded-md text-theme-primary focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>
            <div class="flex justify-end gap-3 pt-4">
              <button
                type="button"
                @click="showAddCustomBlacklistModal = false"
                class="px-4 py-2 bg-theme-card text-theme-primary border border-theme rounded hover:bg-theme-hover transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                :disabled="submittingCustomBlacklist"
                class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition"
              >
                {{ submittingCustomBlacklist ? 'Adding...' : 'Add to Blacklist' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Remove Custom Blacklist Confirmation Modal -->
      <div v-if="showRemoveCustomBlacklistModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-theme-card rounded-lg shadow-xl border border-theme max-w-sm w-full mx-4">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-theme-primary mb-2">Remove from Blacklist</h3>
            <p class="text-sm text-theme-secondary mb-6">
              Are you sure you want to remove <span class="font-medium text-theme-primary">{{ removeCustomBlacklistTarget?.value }}</span> from the blacklist?
            </p>
            <div class="flex justify-end gap-3">
              <button
                @click="showRemoveCustomBlacklistModal = false"
                class="px-4 py-2 bg-theme-card text-theme-primary border border-theme rounded hover:bg-theme-hover transition"
              >
                Cancel
              </button>
              <button
                @click="confirmRemoveCustomBlacklist"
                :disabled="removingCustomBlacklist"
                class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition"
              >
                {{ removingCustomBlacklist ? 'Removing...' : 'Remove' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Update History Tab -->
      <div v-if="activeTab === 'history'" class="bg-theme-card rounded-lg shadow-sm border border-theme flex flex-col h-full overflow-hidden">
        <div class="grid grid-cols-6 gap-4 p-4 bg-theme-bg border-b border-theme text-xs font-medium text-theme-secondary uppercase tracking-wider flex-shrink-0">
          <div>Source</div>
          <div>Type</div>
          <div>Status</div>
          <div>Changes</div>
          <div>Duration</div>
          <div>Timestamp</div>
        </div>
        <div ref="historyScrollContainer" class="flex-1 overflow-auto scroll-container">
          <div v-for="update in historyEntries" :key="update.id" class="grid grid-cols-6 gap-4 p-4 border-b border-theme hover:bg-theme-hover transition items-center">
            <div class="text-sm font-medium text-theme-primary truncate">{{ update.sourceName }}</div>
            <div class="text-sm text-theme-secondary capitalize">{{ update.updateType }}</div>
            <div>
              <span :class="[
                update.status === 'success' ? 'bg-green-100 text-green-800' : update.status === 'pending' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800',
                'px-2 inline-flex text-xs leading-5 font-semibold rounded-full'
              ]">
                {{ update.status }}
              </span>
            </div>
            <div class="text-sm text-theme-primary">
              <span class="text-green-600">+{{ update.entriesAdded }}</span>
              <span class="text-blue-600 ml-2">~{{ update.entriesUpdated }}</span>
              <span class="text-red-600 ml-2">-{{ update.entriesRemoved }}</span>
            </div>
            <div class="text-sm text-theme-secondary">{{ update.duration }}ms</div>
            <div class="text-sm text-theme-secondary">{{ formatDate(update.createdAt) }}</div>
          </div>

          <div v-if="loadingHistory" class="p-4 flex justify-center">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
          <div v-else-if="!hasMoreHistory && historyEntries.length > 0" class="p-4 text-center text-sm text-theme-secondary">
            End of results
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { threatIntelligenceService } from '@/services/threat-intelligence.service';
import type {
  ThreatIntelStats,
  IPerformanceMetrics,
  IHealthCheckResponse,
  IWhitelistEntry,
  IUpdateLogEntry,
  ICustomBlacklistEntry,
} from '@/types/threat-intelligence';
import ErrorAlert from '@/components/common/ErrorAlert.vue';
import StatisticsGrid from '@/components/common/StatisticsGrid.vue';
import { useInfiniteScroll } from '@vueuse/core';

// State
const loading = ref(false);
const reloading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref('overview');

const status = ref<ThreatIntelStats | null>(null);
const sources = ref<any[]>([]);
const performance = ref<IPerformanceMetrics | null>(null);
const health = ref<IHealthCheckResponse | null>(null);

// Whitelist Infinite Scroll State
const whitelistEntries = ref<IWhitelistEntry[]>([]);
const loadingWhitelist = ref(false);
const whitelistPage = ref(1);
const whitelistTotal = ref(0);
const whitelistScrollContainer = ref<HTMLElement | null>(null);
const hasMoreWhitelist = computed(() => whitelistEntries.value.length < whitelistTotal.value);

// History Infinite Scroll State
const historyEntries = ref<IUpdateLogEntry[]>([]);
const loadingHistory = ref(false);
const historyPage = ref(1);
const historyTotal = ref(0);
const historyScrollContainer = ref<HTMLElement | null>(null);
const hasMoreHistory = computed(() => historyEntries.value.length < historyTotal.value);

// Whitelist Management State
const showAddWhitelistModal = ref(false);
const showRemoveModal = ref(false);
const removeTarget = ref<IWhitelistEntry | null>(null);
const submittingWhitelist = ref(false);
const removingWhitelist = ref(false);
const whitelistForm = ref({
  type: 'ip' as 'ip' | 'cidr',
  value: '',
  reason: '',
});
const whitelistFormError = ref<string | null>(null);

// Custom Blacklist Infinite Scroll State
const customBlacklistEntries = ref<ICustomBlacklistEntry[]>([]);
const loadingCustomBlacklist = ref(false);
const customBlacklistPage = ref(1);
const customBlacklistTotal = ref(0);
const customBlacklistScrollContainer = ref<HTMLElement | null>(null);
const hasMoreCustomBlacklist = computed(() => customBlacklistEntries.value.length < customBlacklistTotal.value);

// Custom Blacklist Management State
const showAddCustomBlacklistModal = ref(false);
const showRemoveCustomBlacklistModal = ref(false);
const removeCustomBlacklistTarget = ref<ICustomBlacklistEntry | null>(null);
const submittingCustomBlacklist = ref(false);
const removingCustomBlacklist = ref(false);
const customBlacklistForm = ref({
  type: 'ip' as 'ip' | 'cidr',
  value: '',
  reason: '',
});
const customBlacklistFormError = ref<string | null>(null);

const tabs = [
  { id: 'overview', name: 'Overview' },
  { id: 'sources', name: 'Threat Sources' },
  { id: 'whitelist', name: 'Whitelist' },
  { id: 'custom-blacklist', name: 'Custom Blacklist' },
  { id: 'history', name: 'Update History' },
];

// Computed
const topStats = computed(() => {
  if (!status.value) return [];

  return [
    {
      id: 'service-status',
      name: 'Service Status',
      stat: [
        { name: 'Ready', val: status.value.isReady ? 'Yes' : 'No' },
        { name: 'Initialized', val: status.value.isInitialized ? 'Yes' : 'No' },
        { name: 'Bloom Filter', val: status.value.useBloomFilter ? 'Enabled' : 'Disabled' },
      ],
    },
    {
      id: 'db-stats',
      name: 'Database Stats',
      stat: [
        { name: 'Threat IPs', val: status.value.dbStats.totalThreatIPs.toLocaleString() },
        { name: 'Threat CIDRs', val: status.value.dbStats.totalThreatCIDRs.toLocaleString() },
        { name: 'Active Sources', val: status.value.dbStats.activeSources.toString() },
      ],
    },
    {
      id: 'whitelist-stats',
      name: 'Whitelist Stats',
      stat: [
        { name: 'Total IPs', val: status.value.whitelistStats.totalIPs.toLocaleString() },
        { name: 'Total CIDRs', val: status.value.whitelistStats.totalCIDRs.toLocaleString() },
        { name: 'Hit Rate', val: `${(status.value.whitelistStats.cacheHitRate * 100).toFixed(1)}%` },
      ],
    },
  ];
});

// Methods
const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString();
};

const loadAllData = async () => {
  loading.value = true;
  error.value = null;
  try {
    const [
      statusRes,
      sourcesRes,
      perfRes,
      healthRes
    ] = await Promise.all([
      threatIntelligenceService.getStatus(),
      threatIntelligenceService.getSources(),
      threatIntelligenceService.getPerformance(),
      threatIntelligenceService.getHealth(),
    ]);

    status.value = statusRes.data;
    sources.value = sourcesRes.data.sources;
    performance.value = perfRes.data;
    health.value = healthRes.data;

    // Initial load for paginated data
    await Promise.all([
      loadWhitelist(true),
      loadHistory(true),
      loadCustomBlacklist(true)
    ]);
  } catch (err: any) {
    console.error('Error loading threat intel data:', err);
    error.value = 'Failed to load threat intelligence data. Please try again.';
  } finally {
    loading.value = false;
  }
};

const loadWhitelist = async (reset = false) => {
  if (loadingWhitelist.value) return;
  if (!reset && !hasMoreWhitelist.value) return;

  loadingWhitelist.value = true;
  try {
    const page = reset ? 1 : whitelistPage.value + 1;
    const res = await threatIntelligenceService.getWhitelistEntries({ page, limit: 50 });
    
    if (reset) {
      whitelistEntries.value = res.data.entries;
    } else {
      whitelistEntries.value = [...whitelistEntries.value, ...res.data.entries];
    }
    
    whitelistPage.value = page;
    whitelistTotal.value = res.data.pagination.total;
  } catch (err) {
    console.error('Error loading whitelist:', err);
  } finally {
    loadingWhitelist.value = false;
  }
};

const loadHistory = async (reset = false) => {
  if (loadingHistory.value) return;
  if (!reset && !hasMoreHistory.value) return;

  loadingHistory.value = true;
  try {
    const page = reset ? 1 : historyPage.value + 1;
    const res = await threatIntelligenceService.getUpdateHistory({ page, limit: 50 });
    
    if (reset) {
      historyEntries.value = res.data.updates;
    } else {
      historyEntries.value = [...historyEntries.value, ...res.data.updates];
    }
    
    historyPage.value = page;
    historyTotal.value = res.data.pagination.total;
  } catch (err) {
    console.error('Error loading history:', err);
  } finally {
    loadingHistory.value = false;
  }
};

const loadCustomBlacklist = async (reset = false) => {
  if (loadingCustomBlacklist.value) return;
  if (!reset && !hasMoreCustomBlacklist.value) return;

  loadingCustomBlacklist.value = true;
  try {
    const page = reset ? 1 : customBlacklistPage.value + 1;
    const res = await threatIntelligenceService.getCustomBlacklistEntries({ page, limit: 50 });
    
    if (reset) {
      customBlacklistEntries.value = res.data.entries;
    } else {
      customBlacklistEntries.value = [...customBlacklistEntries.value, ...res.data.entries];
    }
    
    customBlacklistPage.value = page;
    customBlacklistTotal.value = res.data.pagination.total;
  } catch (err) {
    console.error('Error loading custom blacklist:', err);
  } finally {
    loadingCustomBlacklist.value = false;
  }
};

const reloadService = async () => {
  if (!confirm('Are you sure you want to reload the threat intelligence service? This will rebuild the bloom filter.')) return;
  
  reloading.value = true;
  try {
    await threatIntelligenceService.reload();
    await loadAllData();
  } catch (err: any) {
    console.error('Error reloading service:', err);
    error.value = 'Failed to reload service.';
  } finally {
    reloading.value = false;
  }
};

// Whitelist Management Methods
const validateIP = (ip: string): boolean => {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

const validateCIDR = (cidr: string): boolean => {
  const cidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/([0-9]|[1-2][0-9]|3[0-2]))?$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\/([0-9]|[1-9][0-9]|1[0-2][0-8]))?$/;
  return cidrRegex.test(cidr);
};

const confirmRemoveWhitelistEntry = (entry: IWhitelistEntry) => {
  removeTarget.value = entry;
  showRemoveModal.value = true;
};

const confirmRemove = async () => {
  if (!removeTarget.value) return;
  
  removingWhitelist.value = true;
  try {
    if (removeTarget.value.type === 'ip') {
      await threatIntelligenceService.removeWhitelistIP(removeTarget.value.value);
    } else {
      await threatIntelligenceService.removeWhitelistCIDR(removeTarget.value.value);
    }
    
    // Refresh whitelist
    await loadWhitelist(true);
    
    // Close modal
    showRemoveModal.value = false;
    removeTarget.value = null;
  } catch (err: any) {
    console.error('Error removing whitelist entry:', err);
    error.value = 'Failed to remove entry from whitelist. Please try again.';
  } finally {
    removingWhitelist.value = false;
  }
};

const submitWhitelistEntry = async () => {
  // Clear previous errors
  whitelistFormError.value = null;
  
  // Validate input
  if (!whitelistForm.value.value.trim()) {
    whitelistFormError.value = 'Value is required';
    return;
  }
  
  if (whitelistForm.value.type === 'ip' && !validateIP(whitelistForm.value.value)) {
    whitelistFormError.value = 'Invalid IP address format';
    return;
  }
  
  if (whitelistForm.value.type === 'cidr' && !validateCIDR(whitelistForm.value.value)) {
    whitelistFormError.value = 'Invalid CIDR block format';
    return;
  }
  
  submittingWhitelist.value = true;
  try {
    if (whitelistForm.value.type === 'ip') {
      await threatIntelligenceService.addWhitelistIP({
        ipAddress: whitelistForm.value.value,
        reason: whitelistForm.value.reason || undefined,
      });
    } else {
      await threatIntelligenceService.addWhitelistCIDR({
        cidrBlock: whitelistForm.value.value,
        reason: whitelistForm.value.reason || undefined,
      });
    }
    
    // Refresh whitelist
    await loadWhitelist(true);
    
    // Close modal and reset form
    showAddWhitelistModal.value = false;
    whitelistForm.value = {
      type: 'ip',
      value: '',
      reason: '',
    };
  } catch (err: any) {
    console.error('Error adding whitelist entry:', err);
    if (err?.data?.message) {
      whitelistFormError.value = err.data.message;
    } else {
      whitelistFormError.value = 'Failed to add entry to whitelist. Please try again.';
    }
  } finally {
    submittingWhitelist.value = false;
  }
};

// Custom Blacklist Management Methods
const submitCustomBlacklistEntry = async () => {
  // Clear previous errors
  customBlacklistFormError.value = null;
  
  // Validate input
  if (!customBlacklistForm.value.value.trim()) {
    customBlacklistFormError.value = 'Value is required';
    return;
  }
  
  if (customBlacklistForm.value.type === 'ip' && !validateIP(customBlacklistForm.value.value)) {
    customBlacklistFormError.value = 'Invalid IP address format';
    return;
  }
  
  if (customBlacklistForm.value.type === 'cidr' && !validateCIDR(customBlacklistForm.value.value)) {
    customBlacklistFormError.value = 'Invalid CIDR block format';
    return;
  }
  
  submittingCustomBlacklist.value = true;
  try {
    if (customBlacklistForm.value.type === 'ip') {
      await threatIntelligenceService.addCustomBlacklistIP({
        ipAddress: customBlacklistForm.value.value,
        reason: customBlacklistForm.value.reason || undefined,
      });
    } else {
      await threatIntelligenceService.addCustomBlacklistCIDR({
        cidrBlock: customBlacklistForm.value.value,
        reason: customBlacklistForm.value.reason || undefined,
      });
    }
    
    // Refresh custom blacklist
    await loadCustomBlacklist(true);
    
    // Close modal and reset form
    showAddCustomBlacklistModal.value = false;
    customBlacklistForm.value = {
      type: 'ip',
      value: '',
      reason: '',
    };
  } catch (err: any) {
    console.error('Error adding custom blacklist entry:', err);
    if (err?.data?.message) {
      customBlacklistFormError.value = err.data.message;
    } else {
      customBlacklistFormError.value = 'Failed to add entry to custom blacklist. Please try again.';
    }
  } finally {
    submittingCustomBlacklist.value = false;
  }
};

const confirmRemoveCustomBlacklistEntry = (entry: ICustomBlacklistEntry) => {
  removeCustomBlacklistTarget.value = entry;
  showRemoveCustomBlacklistModal.value = true;
};

const confirmRemoveCustomBlacklist = async () => {
  if (!removeCustomBlacklistTarget.value) return;
  
  removingCustomBlacklist.value = true;
  try {
    if (removeCustomBlacklistTarget.value.type === 'ip') {
      await threatIntelligenceService.removeCustomBlacklistIP(removeCustomBlacklistTarget.value.value);
    } else {
      await threatIntelligenceService.removeCustomBlacklistCIDR(removeCustomBlacklistTarget.value.value);
    }
    
    // Refresh custom blacklist
    await loadCustomBlacklist(true);
    
    // Close modal
    showRemoveCustomBlacklistModal.value = false;
    removeCustomBlacklistTarget.value = null;
  } catch (err: any) {
    console.error('Error removing custom blacklist entry:', err);
    error.value = 'Failed to remove entry from custom blacklist. Please try again.';
  } finally {
    removingCustomBlacklist.value = false;
  }
};

onMounted(() => {
  loadAllData();

  useInfiniteScroll(
    whitelistScrollContainer,
    async () => {
      if (hasMoreWhitelist.value && !loadingWhitelist.value) {
        await loadWhitelist();
      }
    },
    { distance: 200 }
  );

  useInfiniteScroll(
    historyScrollContainer,
    async () => {
      if (hasMoreHistory.value && !loadingHistory.value) {
        await loadHistory();
      }
    },
    { distance: 200 }
  );

  useInfiniteScroll(
    customBlacklistScrollContainer,
    async () => {
      if (hasMoreCustomBlacklist.value && !loadingCustomBlacklist.value) {
        await loadCustomBlacklist();
      }
    },
    { distance: 200 }
  );
});
</script>

<style scoped>
.scroll-container::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.scroll-container::-webkit-scrollbar-track {
  background: transparent;
}

.scroll-container::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

.scroll-container::-webkit-scrollbar-thumb:hover {
  background: rgba(156, 163, 175, 0.7);
}
</style>
