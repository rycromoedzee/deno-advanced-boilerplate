import { http } from "./http";
import type { CacheEntry, CacheStats } from "@/types/cache";

export const cacheService = {
  async getCacheData(): Promise<CacheEntry[]> {
    return http.get<CacheEntry[]>("/api/internal/__cache-insights/data");
  },

  async getCacheStats(): Promise<CacheStats> {
    return http.get<CacheStats>("/api/internal/__cache-insights/stats");
  },
};
