/**
 * @file handlers/admin-ui/cache-visualizer.handler.ts
 * @description Cache Visualizer request handler
 */
import type { HonoContext } from "@deps";
import { HTTPException, stream } from "@deps";
import { CACHE_LOG_REDACTED_KEYS, CACHE_NAMESPACES_DO_NOT_LOG, DetailedCacheStatistics, getCache } from "@services/cache/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";

function redactValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return "[redacted]";
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (CACHE_LOG_REDACTED_KEYS.has(k.toLowerCase())) {
      cleaned[k] = "[redacted]";
    } else if (typeof v === "object" && v !== null) {
      cleaned[k] = redactValue(v);
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

function calculatePrettyTtl(ttl: number): string {
  const days = Math.floor(ttl / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ttl % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ttl % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ttl % (1000 * 60)) / 1000);

  if (days > 0) {
    return `${days}d`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

const visualizerCacheProvider = await getCache();

/**
 * Handler for ${capitalize(name)} endpoint
 */
// deno-lint-ignore require-await
export const cacheVisualizerHandler = async (c: HonoContext) => {
  // Validate HTTP method
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  /*
  if (envConfig.cache.isRedisEnabled) {
    throw new HTTPException(400, {message: "Only local caching"})
  }
  */
  return stream(c, async (stream) => {
    const encoder = new TextEncoder();
    let isFirst = true;

    try {
      // Start JSON array
      await stream.write(encoder.encode("["));

      const namespaces = await visualizerCacheProvider.getAllNamespaces();
      const now = getTimeNow();

      for (const ns of namespaces) {
        if (CACHE_NAMESPACES_DO_NOT_LOG.has(ns)) continue;
        const cacheMap = await visualizerCacheProvider.getAllFromNamespace(ns);
        if (!cacheMap) continue;

        for (const [key, entry] of cacheMap.entries()) {
          // Skip entries that have been expired for more than 3 hours
          if (entry.expires && (entry.expires + (3 * 60 * 60 * 1000)) <= now) {
            continue;
          }

          const item = {
            namespace: ns,
            key,
            value: redactValue(entry.value),
            ttl: entry.expires ? calculatePrettyTtl(entry.expires - entry.createdAt) : null,
            expiresAt: entry.expires ? entry.expires : null,
            size: new TextEncoder().encode(JSON.stringify(entry.value)).length,
            createdAt: entry.createdAt,
          };

          const json = JSON.stringify(item);
          const chunk = (isFirst ? "" : ",") + json;
          isFirst = false;

          await stream.write(encoder.encode(chunk));
        }

        // Optional: yield control to avoid blocking
        await Promise.resolve();
      }

      // End JSON array
      await stream.write(encoder.encode("]"));
    } catch (err) {
      console.error("Stream error in /api/cache:", err);
      // Try to send a valid JSON response on error
      try {
        if (isFirst) {
          await stream.write(encoder.encode("[]"));
        } else {
          await stream.write(encoder.encode("]"));
        }
      } catch (writeErr) {
        console.error("Failed to write error response:", writeErr);
      }
    }
  });
};

export const cacheVisualizerStatsHandler = async (c: HonoContext) => {
  // Validate HTTP method
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  /*
  if (envConfig.cache.isRedisEnabled) {
    throw new HTTPException(400, {message: "Only local caching"})
  }
  */
  const allNamespaces = await visualizerCacheProvider.getAllNamespaces();

  const namespaceStats = await Promise.all(
    allNamespaces
      .filter((ns) => !CACHE_NAMESPACES_DO_NOT_LOG.has(ns))
      .map((ns) => visualizerCacheProvider.getDetailedStats(ns)),
  );

  const allStats = aggregateNamespaceStats(namespaceStats);

  return c.json({
    global: allStats,
    namespaces: Object.fromEntries(
      namespaceStats.map((s) => [s.namespace!, s]),
    ),
    namespacesList: allNamespaces.filter((ns) => !CACHE_NAMESPACES_DO_NOT_LOG.has(ns)),
  });
};

function aggregateNamespaceStats(
  namespaceStats: DetailedCacheStatistics[],
): DetailedCacheStatistics {
  if (namespaceStats.length === 0) {
    return {
      hits: 0,
      misses: 0,
      hitRate: 0,
      entryCount: 0,
      totalSize: 0,
      averageEntrySize: 0,
      largestEntrySize: 0,
      smallestEntrySize: 0,
      namespace: undefined,
      lastResetTime: new Date(),
      createdTime: new Date(),
    };
  }

  // Initialize accumulators
  let totalHits = 0;
  let totalMisses = 0;
  let totalEntryCount = 0;
  let totalSizeSum = 0;
  let globalLargestEntry = 0;
  let globalSmallestEntry = Infinity;
  let earliestCreatedTime = new Date();
  let latestResetTime = new Date(0); // Start with epoch

  // Aggregate all values
  namespaceStats.forEach((stats) => {
    totalHits += stats.hits;
    totalMisses += stats.misses;
    totalEntryCount += stats.entryCount;
    totalSizeSum += stats.totalSize;

    // Find global largest and smallest entries
    globalLargestEntry = Math.max(globalLargestEntry, stats.largestEntrySize);
    if (stats.smallestEntrySize > 0) { // Only consider non-zero values
      globalSmallestEntry = Math.min(
        globalSmallestEntry,
        stats.smallestEntrySize,
      );
    }

    // Find earliest created time and latest reset time
    if (stats.createdTime < earliestCreatedTime) {
      earliestCreatedTime = stats.createdTime;
    }
    if (stats.lastResetTime > latestResetTime) {
      latestResetTime = stats.lastResetTime;
    }
  });

  // Calculate derived values
  const hitRate = totalHits + totalMisses > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0;
  const averageEntrySize = totalEntryCount > 0 ? totalSizeSum / totalEntryCount : 0;

  return {
    hits: totalHits,
    misses: totalMisses,
    hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    entryCount: totalEntryCount,
    totalSize: totalSizeSum,
    averageEntrySize: Math.round(averageEntrySize * 100) / 100, // Round to 2 decimal places
    largestEntrySize: globalLargestEntry,
    smallestEntrySize: globalSmallestEntry === Infinity ? 0 : globalSmallestEntry,
    namespace: undefined, // Global stats have no specific namespace
    lastResetTime: latestResetTime,
    createdTime: earliestCreatedTime,
  };
}
