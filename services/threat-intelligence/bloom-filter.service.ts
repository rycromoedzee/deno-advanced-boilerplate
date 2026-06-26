/**
 * @file services/threat-intelligence/bloom-filter.service.ts
 * @description Bloom Filter service (threat intelligence)
 */
/**
 * Simplified Bloom Filter Service
 *
 * Performance target: <1ms response time, <200KB memory usage
 * Refactored to remove singleton pattern and simplify bloom filter classes.
 * Phase 4: Consolidated metrics collection
 *
 * Refactored to follow project guidelines:
 * - Uses useLogger instead of console.log
 * - Uses traced() for observability
 * - Removed duplicate code
 * - Simplified control flow
 */

import { getCache } from "@services/cache/index.ts";
import { IPValidationUtils } from "@utils/network/index.ts";
import { loggerAppSections, LoggerLevels, useLogger, useLogSecurityEvent } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import type { ThreatBatch } from "./optimized-data-loader.ts";
import { THREAT_INTEL_CONFIG } from "./config.ts";
import { calculateCIDRRange, shouldExpandCIDR } from "./helper.ts";

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Minimal interface for the threat data loader dependency.
 * Scoped to exactly what BloomFilterService needs, enabling test substitution
 * without coupling to the concrete OptimizedDataLoader class shape.
 */
interface ThreatDataLoader {
  loadThreatDataBatches(
    processor: (batch: ThreatBatch, batchIndex: number, totalBatches: number) => Promise<void> | void,
  ): Promise<unknown>;
}

// Default false positive rate from config
const DEFAULT_FALSE_POSITIVE_RATE = THREAT_INTEL_CONFIG.bloom.falsePositiveRate;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Consolidated metrics interface for bloom filter service
 */
export interface BloomFilterMetrics {
  isInitialized: boolean;
  totalChecks: number;
  bloomHits: number;
  cidrHits: number;
  misses: number;
  averageResponseTimeMs: number;
  initializationTimeMs: number;
  memoryUsageKB: number;
  elementsCount: number;
  filterCount: number;
  utilization: number;
  falsePositiveRate: number;
  capacityRemaining: number;
  needsExpansion: boolean;
  capacityWarningThreshold: number;
}

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  status: "healthy" | "warning" | "error";
  checks: {
    initialization: { status: boolean; message: string };
    memoryUsage: { status: boolean; message: string };
    performance: { status: boolean; message: string };
    capacity: { status: boolean; message: string };
  };
  summary: string;
  recommendedActions: string[];
}

/**
 * Result of IP check operation
 */
interface CheckIPResult {
  isPotentialThreat: boolean;
  requiresDbVerification: boolean;
  source: string;
  responseTimeMs: number;
  cacheHit: boolean;
}

/**
 * Filter set containing all bloom filters
 */
interface FilterSet {
  ipFilter: ScalableBloomFilter | null;
  cidrFilter: ScalableBloomFilter | null;
  cidrChecker: FastCIDRChecker;
  isInitialized: boolean;
}

/**
 * CIDR processing result
 */
interface CIDRProcessingResult {
  expandedCidrCount: number;
  largeCidrCount: number;
}

/**
 * Initialization result
 */
export interface InitializationResult {
  success: boolean;
  initializationTimeMs: number;
  ipCount: number;
  cidrCount: number;
  totalMemoryKB: number;
}

// ============================================================================
// BLOOM FILTER IMPLEMENTATION
// ============================================================================

/**
 * Simplified, high-performance bloom filter implementation
 * Uses efficient hashing and bit manipulation without external dependencies
 */
class BloomFilter {
  private bitArray: Uint32Array;
  private size: number;
  private hashCount: number;
  private elementsAdded = 0;
  private capacity: number;

  constructor(expectedElements: number, falsePositiveRate: number = DEFAULT_FALSE_POSITIVE_RATE) {
    this.capacity = expectedElements;
    this.size = this.calculateOptimalSize(expectedElements, falsePositiveRate);
    this.hashCount = this.calculateOptimalHashCount(this.size, expectedElements);
    const arraySize = Math.ceil(this.size / 32);
    this.bitArray = new Uint32Array(arraySize);
  }

  add(item: string): void {
    const hashes = this.generateHashes(item);
    for (const hash of hashes) {
      this.setBit(hash % this.size);
    }
    this.elementsAdded++;
  }

  has(item: string): boolean {
    const hashes = this.generateHashes(item);
    return hashes.every((hash) => this.getBit(hash % this.size));
  }

  getStats() {
    return {
      size: this.size,
      hashCount: this.hashCount,
      elementsAdded: this.elementsAdded,
      capacity: this.capacity,
      memoryKB: Math.ceil((this.bitArray.length * 4) / 1024),
      estimatedFalsePositiveRate: this.calculateCurrentFalsePositiveRate(),
    };
  }

  clear(): void {
    this.bitArray.fill(0);
    this.elementsAdded = 0;
  }

  isFull(): boolean {
    return this.elementsAdded >= this.capacity * 0.8;
  }

  private setBit(index: number): void {
    const arrayIndex = Math.floor(index / 32);
    const bitIndex = index % 32;
    this.bitArray[arrayIndex] |= 1 << bitIndex;
  }

  private getBit(index: number): boolean {
    const arrayIndex = Math.floor(index / 32);
    const bitIndex = index % 32;
    return (this.bitArray[arrayIndex] & (1 << bitIndex)) !== 0;
  }

  // Keep MurmurHash3 for performance (10-100x faster than crypto hashes)
  private generateHashes(item: string): number[] {
    const hash1 = this.murmurHash3(item, 0);
    const hash2 = this.murmurHash3(item, 1) | 1;

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(hash1 + i * hash2);
    }

    return hashes;
  }

  private murmurHash3(key: string, seed: number = 0): number {
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const length = key.length;

    for (let i = 0; i < length; i++) {
      let k1 = key.charCodeAt(i);
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }

    h1 ^= length;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
  }

  private calculateOptimalSize(
    expectedElements: number,
    falsePositiveRate: number,
  ): number {
    const size = Math.ceil(
      -(expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2),
    );
    return Math.ceil(size / 32) * 32;
  }

  private calculateOptimalHashCount(
    size: number,
    expectedElements: number,
  ): number {
    const hashCount = Math.round((size / expectedElements) * Math.log(2));
    return Math.max(1, Math.min(10, hashCount));
  }

  private calculateCurrentFalsePositiveRate(): number {
    if (this.elementsAdded === 0) return 0;
    const fillRatio = this.elementsAdded / this.size;
    return Math.pow(1 - Math.exp(-this.hashCount * fillRatio), this.hashCount);
  }
}

// ============================================================================
// SCALABLE BLOOM FILTER
// ============================================================================

/**
 * Growth factor thresholds for bloom filter scaling
 */
const GROWTH_THRESHOLDS: Array<[number, number]> = [
  [1_000_000, 1.1],
  [100_000, 1.2],
  [10_000, 1.3],
  [1_000, 1.5],
  [0, 2.0],
];

/**
 * Scalable Bloom Filter - automatically grows without rebuilding
 * Uses multiple bloom filters of increasing sizes for unlimited growth
 */
class ScalableBloomFilter {
  private filters: BloomFilter[] = [];
  private falsePositiveRate: number;
  private initialCapacity: number;

  constructor(initialCapacity: number = 100, falsePositiveRate: number = DEFAULT_FALSE_POSITIVE_RATE) {
    this.initialCapacity = initialCapacity;
    this.falsePositiveRate = falsePositiveRate;
    this.filters.push(new BloomFilter(initialCapacity, falsePositiveRate));
  }

  private getGrowthFactor(capacity: number): number {
    return GROWTH_THRESHOLDS.find(([threshold]) => capacity >= threshold)?.[1] ?? 2.0;
  }

  add(item: string): void {
    const currentFilter = this.filters[this.filters.length - 1];

    if (currentFilter.isFull()) {
      const currentCapacity = currentFilter.getStats().capacity;
      const growthFactor = this.getGrowthFactor(currentCapacity);
      const newCapacity = Math.ceil(currentCapacity * growthFactor);
      const newFilter = new BloomFilter(newCapacity, this.falsePositiveRate);
      this.filters.push(newFilter);

      useLogger(
        LoggerLevels.info,
        {
          message: `Bloom filter scaled up`,
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_FILTER_SCALE_UP",
          details: {
            newCapacity,
            growthFactor,
            totalFilters: this.filters.length,
          },
        },
        false,
        true,
      );
    }

    this.filters[this.filters.length - 1].add(item);
  }

  has(item: string): boolean {
    return this.filters.some((filter) => filter.has(item));
  }

  getStats() {
    const totalElements = this.filters.reduce((sum, f) => sum + f.getStats().elementsAdded, 0);
    const totalMemoryKB = this.filters.reduce((sum, f) => sum + f.getStats().memoryKB, 0);
    const totalCapacity = this.filters.reduce((sum, f) => sum + f.getStats().capacity, 0);

    return {
      filterCount: this.filters.length,
      elementsAdded: totalElements,
      totalCapacity,
      memoryKB: totalMemoryKB,
      capacity: totalCapacity,
      filters: this.filters.map((f) => f.getStats()),
    };
  }

  clear(): void {
    this.filters = [new BloomFilter(this.initialCapacity, this.falsePositiveRate)];
  }

  isFull(): boolean {
    return false; // Scalable filters never become "full"
  }
}

// ============================================================================
// FAST CIDR CHECKER
// ============================================================================

/**
 * Fast CIDR range checker without complex processing
 * Handles IP range checking efficiently
 */
class FastCIDRChecker {
  private ranges: Array<{ start: number; end: number; cidr: string }> = [];

  addCIDR(cidr: string): boolean {
    const range = calculateCIDRRange(cidr);
    if (!range) {
      return false;
    }

    this.ranges.push({
      start: range.start,
      end: range.end,
      cidr,
    });

    return true;
  }

  checkIP(ip: string): boolean {
    try {
      const ipNum = IPValidationUtils.ipToNumber(ip);
      return this.ranges.some((range) => ipNum >= range.start && ipNum <= range.end);
    } catch {
      return false;
    }
  }

  getStats() {
    return {
      rangeCount: this.ranges.length,
      memoryKB: Math.ceil(this.ranges.length * 24 / 1024),
    };
  }

  clear(): void {
    this.ranges = [];
  }

  optimize(): void {
    this.ranges.sort((a, b) => a.start - b.start);
  }
}

// ============================================================================
// BLOOM FILTER SERVICE
// ============================================================================

/**
 * Bloom Filter Service
 * High-performance threat intelligence using simplified bloom filter
 */
export class BloomFilterService {
  private filters: FilterSet = {
    ipFilter: null,
    cidrFilter: null,
    cidrChecker: new FastCIDRChecker(),
    isInitialized: false,
  };

  private cache: Awaited<ReturnType<typeof getCache>> | null = null;

  private metrics = {
    totalChecks: 0,
    bloomHits: 0,
    cidrHits: 0,
    misses: 0,
    averageResponseTimeMs: 0,
    initializationTimeMs: 0,
  };

  public constructor() {}

  /**
   * Initialize with threat intelligence data
   * Target: <100ms initialization time
   */
  async initialize(): Promise<InitializationResult> {
    return await traced("BloomFilterService.initialize", "service", async (span) => {
      if (this.filters.isInitialized) {
        const ipStats = this.filters.ipFilter?.getStats();
        const cidrStats = this.filters.cidrFilter?.getStats();
        return {
          success: true,
          initializationTimeMs: 0,
          ipCount: ipStats?.elementsAdded || 0,
          cidrCount: cidrStats?.elementsAdded || 0,
          totalMemoryKB: this.getMemoryUsageKB(),
        };
      }

      const startTime = performance.now();

      useLogger(
        LoggerLevels.info,
        {
          message: "Initializing threat intelligence bloom filters...",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_INIT_START",
        },
        false,
        true,
      );

      try {
        this.cache = await getCache();
        await this.loadThreatData();

        this.filters.isInitialized = true;
        const initTime = performance.now() - startTime;
        this.metrics.initializationTimeMs = initTime;

        const ipStats = this.filters.ipFilter?.getStats();
        const cidrStats = this.filters.cidrFilter?.getStats();
        const rangeCount = this.filters.cidrChecker.getStats().rangeCount;

        span.attributes["init_time_ms"] = initTime;
        span.attributes["ip_count"] = ipStats?.elementsAdded || 0;
        span.attributes["cidr_count"] = cidrStats?.elementsAdded || 0;
        span.attributes["memory_kb"] = this.getMemoryUsageKB();

        useLogger(
          LoggerLevels.info,
          {
            message: "Threat intelligence bloom filters initialized",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_INIT_COMPLETE",
            details: {
              initializationTimeMs: Math.round(initTime * 100) / 100,
              ipCount: ipStats?.elementsAdded || 0,
              cidrCount: cidrStats?.elementsAdded || 0,
              cidrRangeCount: rangeCount,
              memoryKB: this.getMemoryUsageKB(),
            },
          },
          false,
          true,
        );

        return {
          success: true,
          initializationTimeMs: initTime,
          ipCount: ipStats?.elementsAdded || 0,
          cidrCount: cidrStats?.elementsAdded || 0,
          totalMemoryKB: this.getMemoryUsageKB(),
        };
      } catch (error) {
        const initTime = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        useLogger(LoggerLevels.error, {
          message: "Failed to initialize bloom filters",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_INIT_FAILED",
          details: {
            error: errorMessage,
            initializationTimeMs: initTime,
          },
        });

        return {
          success: false,
          initializationTimeMs: initTime,
          ipCount: 0,
          cidrCount: 0,
          totalMemoryKB: 0,
        };
      }
    });
  }

  /**
   * Fast IP threat check
   * Target: <1ms response time
   */
  async checkIP(ip: string): Promise<CheckIPResult> {
    return await traced("BloomFilterService.checkIP", "service", async (_span) => {
      const startTime = performance.now();

      if (!this.filters.isInitialized) {
        await this.initialize();
      }

      this.metrics.totalChecks++;

      try {
        // Check IP bloom filter first (fastest)
        if (this.filters.ipFilter?.has(ip)) {
          return this.createThreatResponse("ip_bloom_filter", startTime);
        }

        // Check CIDR bloom filter for expanded ranges
        if (this.filters.cidrFilter?.has(ip)) {
          return this.createThreatResponse("cidr_bloom_filter", startTime);
        }

        // Check CIDR ranges directly (for large ranges)
        if (this.filters.cidrChecker.checkIP(ip)) {
          this.metrics.cidrHits++;
          return this.createThreatResponse("cidr_range", startTime);
        }

        // No threat found
        return this.createSafeResponse(startTime);
      } catch (error) {
        const responseTime = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        await useLogSecurityEvent(
          LoggerLevels.error,
          "Bloom filter check failed",
          "medium",
          loggerAppSections.THREAT_INTELLIGENCE,
          "BLOOM_CHECK_ERROR",
          { ip, error: errorMessage, responseTimeMs: responseTime },
        );

        return {
          isPotentialThreat: false,
          requiresDbVerification: false,
          source: "error",
          responseTimeMs: responseTime,
          cacheHit: false,
        };
      }
    });
  }

  /**
   * Get consolidated metrics
   */
  getMetrics(): BloomFilterMetrics {
    const ipStats = this.filters.ipFilter?.getStats();
    const memoryUsageKB = this.getMemoryUsageKB();

    const capacity = ipStats?.capacity || 0;
    const elementsAdded = ipStats?.elementsAdded || 0;
    const capacityRemaining = capacity - elementsAdded;
    const utilization = ipStats ? (elementsAdded / capacity) : 0;
    const needsExpansion = utilization >= 0.8;

    return {
      isInitialized: this.filters.isInitialized,
      totalChecks: this.metrics.totalChecks,
      bloomHits: this.metrics.bloomHits,
      cidrHits: this.metrics.cidrHits,
      misses: this.metrics.misses,
      averageResponseTimeMs: this.metrics.averageResponseTimeMs,
      initializationTimeMs: this.metrics.initializationTimeMs,
      memoryUsageKB,
      elementsCount: elementsAdded,
      filterCount: 1,
      utilization,
      falsePositiveRate: DEFAULT_FALSE_POSITIVE_RATE,
      capacityRemaining,
      needsExpansion,
      capacityWarningThreshold: 0.8,
    };
  }

  /**
   * Export metrics in external monitoring format
   */
  getMetricsForExport(): Record<string, number> {
    const metrics = this.getMetrics();

    return {
      bloom_filter_is_initialized: metrics.isInitialized ? 1 : 0,
      bloom_filter_total_lookups: metrics.totalChecks,
      bloom_filter_hits: metrics.bloomHits + metrics.cidrHits,
      bloom_filter_misses: metrics.misses,
      bloom_filter_avg_response_time_ms: metrics.averageResponseTimeMs,
      bloom_filter_memory_usage_kb: metrics.memoryUsageKB,
      bloom_filter_memory_usage_mb: metrics.memoryUsageKB / 1024,
      bloom_filter_elements_count: metrics.elementsCount,
      bloom_filter_utilization_percent: Math.round(metrics.utilization * 100),
      bloom_filter_false_positive_rate: metrics.falsePositiveRate,
    };
  }

  /**
   * Perform health check
   */
  performHealthCheck(): HealthCheckResult {
    const metrics = this.getMetrics();

    const capacityCheck = {
      status: !metrics.needsExpansion,
      message: metrics.needsExpansion
        ? `Capacity at ${Math.round(metrics.utilization * 100)}% - expansion needed`
        : `Capacity: ${Math.round(metrics.utilization * 100)}% (${metrics.capacityRemaining} slots remaining)`,
    };

    return {
      status: metrics.isInitialized && !metrics.needsExpansion ? "healthy" : "warning",
      checks: {
        initialization: {
          status: metrics.isInitialized,
          message: metrics.isInitialized ? "Service initialized" : "Service not initialized",
        },
        memoryUsage: {
          status: metrics.memoryUsageKB < 2000,
          message: `Memory usage: ${metrics.memoryUsageKB}KB`,
        },
        performance: {
          status: metrics.averageResponseTimeMs < 1,
          message: `Average response time: ${metrics.averageResponseTimeMs.toFixed(3)}ms`,
        },
        capacity: capacityCheck,
      },
      summary: metrics.isInitialized ? "Service operational" : "Service needs initialization",
      recommendedActions: [
        ...(!metrics.isInitialized ? ["Initialize service"] : []),
        ...(metrics.needsExpansion ? ["Rebuild filters with larger capacity"] : []),
      ],
    };
  }

  /**
   * Reload bloom filters from database using zero-downtime pattern
   */
  async reload(): Promise<InitializationResult> {
    return await traced("BloomFilterService.reload", "service", async (span) => {
      const startTime = performance.now();

      useLogger(
        LoggerLevels.info,
        {
          message: "Starting zero-downtime bloom filter reload...",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_RELOAD_START",
        },
        false,
        true,
      );

      try {
        const { optimizedDataLoader } = await import("./optimized-data-loader.ts");
        const { ipCount, cidrCount } = await optimizedDataLoader.getThreatCounts();

        // Create NEW temporary filters
        const newFilters = this.createFilters(ipCount, cidrCount);

        useLogger(
          LoggerLevels.info,
          {
            message: "Building new bloom filters",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_RELOAD_BUILDING",
            details: { ipCount, cidrCount },
          },
          false,
          true,
        );

        // Load data into NEW filters
        const processingResult = await this.loadThreatDataIntoFilters(
          optimizedDataLoader,
          newFilters.ipFilter,
          newFilters.cidrFilter,
          newFilters.cidrChecker,
        );

        newFilters.cidrChecker.optimize();

        // Atomic swap
        const initTime = performance.now() - startTime;
        this.filters = { ...newFilters, isInitialized: true };

        // Reset metrics
        this.metrics = {
          totalChecks: 0,
          bloomHits: 0,
          cidrHits: 0,
          misses: 0,
          averageResponseTimeMs: 0,
          initializationTimeMs: initTime,
        };

        const ipStats = this.filters.ipFilter!.getStats();
        const cidrStats = this.filters.cidrFilter!.getStats();
        const rangeCount = this.filters.cidrChecker.getStats().rangeCount;

        span.attributes["init_time_ms"] = initTime;
        span.attributes["ip_count"] = ipStats.elementsAdded;
        span.attributes["cidr_count"] = cidrStats.elementsAdded;

        useLogger(
          LoggerLevels.info,
          {
            message: "Zero-downtime bloom filter reload completed",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_RELOAD_COMPLETE",
            details: {
              initializationTimeMs: Math.round(initTime * 100) / 100,
              ipCount: ipStats.elementsAdded,
              cidrCount: cidrStats.elementsAdded,
              cidrRangeCount: rangeCount,
              memoryKB: this.getMemoryUsageKB(),
              expandedCidrs: processingResult.expandedCidrCount,
              largeCidrs: processingResult.largeCidrCount,
            },
          },
          false,
          true,
        );

        return {
          success: true,
          initializationTimeMs: initTime,
          ipCount: ipStats.elementsAdded,
          cidrCount: cidrStats.elementsAdded,
          totalMemoryKB: this.getMemoryUsageKB(),
        };
      } catch (error) {
        const initTime = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        useLogger(LoggerLevels.error, {
          message: "Failed to reload bloom filters",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_RELOAD_FAILED",
          details: { error: errorMessage, initializationTimeMs: initTime },
        });

        // Keep old filters running
        return {
          success: false,
          initializationTimeMs: initTime,
          ipCount: this.filters.ipFilter?.getStats().elementsAdded || 0,
          cidrCount: this.filters.cidrFilter?.getStats().elementsAdded || 0,
          totalMemoryKB: this.getMemoryUsageKB(),
        };
      }
    });
  }

  /**
   * Get unified status (consolidated from legacy methods)
   */
  getStatus(): {
    isInitialized: boolean;
    metrics: BloomFilterMetrics;
    memoryUsageKB: number;
    memoryUsageMB: number;
    filters: {
      ip: ReturnType<ScalableBloomFilter["getStats"]> | null;
      cidr: ReturnType<ScalableBloomFilter["getStats"]> | null;
      cidrChecker: ReturnType<FastCIDRChecker["getStats"]>;
    };
  } {
    const metrics = this.getMetrics();
    return {
      isInitialized: this.filters.isInitialized,
      metrics,
      memoryUsageKB: metrics.memoryUsageKB,
      memoryUsageMB: metrics.memoryUsageKB / 1024,
      filters: {
        ip: this.filters.ipFilter?.getStats() || null,
        cidr: this.filters.cidrFilter?.getStats() || null,
        cidrChecker: this.filters.cidrChecker.getStats(),
      },
    };
  }

  /**
   * @deprecated since 1.5.0, will be removed in 2.0.0. Use getStatus() instead.
   * This method provides a legacy response shape for backwards compatibility.
   */
  getServiceStatus() {
    const status = this.getStatus();
    return {
      isInitialized: status.isInitialized,
      stats: {
        currentFalsePositiveRate: DEFAULT_FALSE_POSITIVE_RATE,
        estimatedMemoryKB: status.memoryUsageKB,
        elementsAdded: status.metrics.elementsCount,
        utilization: status.metrics.utilization,
        lastRebuildTimestamp: Date.now(),
        filterCount: 1,
      },
      metrics: {
        totalChecks: status.metrics.totalChecks,
        bloomHits: status.metrics.bloomHits,
        cidrHits: status.metrics.cidrHits,
        misses: status.metrics.misses,
        averageResponseTimeMs: status.metrics.averageResponseTimeMs,
        initializationTimeMs: status.metrics.initializationTimeMs,
      },
      shouldRebuild: false,
      lastRebuildAge: "0h 0m",
      memoryUsageMB: status.memoryUsageMB,
    };
  }

  /**
   * @deprecated since 1.5.0, will be removed in 2.0.0. Use getStatus() instead.
   * This method provides a legacy response shape for backwards compatibility.
   */
  getFilterStats() {
    const status = this.getStatus();
    return {
      currentFalsePositiveRate: DEFAULT_FALSE_POSITIVE_RATE,
      estimatedMemoryKB: status.memoryUsageKB,
      elementsAdded: status.metrics.elementsCount,
      utilization: status.metrics.utilization,
      lastRebuildTimestamp: Date.now(),
      filterCount: 1,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Create threat response with metrics update
   */
  private createThreatResponse(source: string, startTime: number): CheckIPResult {
    this.metrics.bloomHits++;
    const responseTime = performance.now() - startTime;
    this.updateAverageResponseTime(responseTime);

    return {
      isPotentialThreat: true,
      requiresDbVerification: true,
      source,
      responseTimeMs: responseTime,
      cacheHit: true,
    };
  }

  /**
   * Create safe response with metrics update
   */
  private createSafeResponse(startTime: number): CheckIPResult {
    this.metrics.misses++;
    const responseTime = performance.now() - startTime;
    this.updateAverageResponseTime(responseTime);

    return {
      isPotentialThreat: false,
      requiresDbVerification: false,
      source: "not_found",
      responseTimeMs: responseTime,
      cacheHit: true,
    };
  }

  /**
   * Create new filter set with proper sizing
   * Returns non-null filters for use in initialization and reload
   */
  private createFilters(ipCount: number, cidrCount: number): {
    ipFilter: ScalableBloomFilter;
    cidrFilter: ScalableBloomFilter;
    cidrChecker: FastCIDRChecker;
  } {
    const MIN_INITIAL_SIZE = 100;
    return {
      ipFilter: new ScalableBloomFilter(
        Math.max(MIN_INITIAL_SIZE, ipCount),
        DEFAULT_FALSE_POSITIVE_RATE,
      ),
      cidrFilter: new ScalableBloomFilter(
        Math.max(MIN_INITIAL_SIZE, cidrCount),
        DEFAULT_FALSE_POSITIVE_RATE,
      ),
      cidrChecker: new FastCIDRChecker(),
    };
  }

  /**
   * Process CIDRs into appropriate filters
   */
  private processCIDRsIntoFilters(
    cidrs: Array<{ cidrBlock: string }>,
    cidrFilter: ScalableBloomFilter,
    cidrChecker: FastCIDRChecker,
  ): CIDRProcessingResult {
    let expandedCidrCount = 0;
    let largeCidrCount = 0;

    for (const threat of cidrs) {
      if (shouldExpandCIDR(threat.cidrBlock)) {
        try {
          const expandedIPs = IPValidationUtils.expandSmallCIDR(threat.cidrBlock, 1000);
          expandedIPs.forEach((ip) => cidrFilter.add(ip));
          expandedCidrCount++;
        } catch {
          // Silently skip invalid CIDRs during batch processing
        }
      } else {
        cidrChecker.addCIDR(threat.cidrBlock);
        largeCidrCount++;
      }
    }

    return { expandedCidrCount, largeCidrCount };
  }

  /**
   * Load threat data into provided filters
   */
  private async loadThreatDataIntoFilters(
    loader: ThreatDataLoader,
    ipFilter: ScalableBloomFilter,
    cidrFilter: ScalableBloomFilter,
    cidrChecker: FastCIDRChecker,
  ): Promise<CIDRProcessingResult> {
    const result: CIDRProcessingResult = { expandedCidrCount: 0, largeCidrCount: 0 };

    await loader.loadThreatDataBatches((batch: ThreatBatch) => {
      // Process IP threats
      if (batch.ips?.length > 0) {
        for (const threat of batch.ips) {
          ipFilter.add(threat.ipAddress);
        }
      }

      // Process CIDR threats
      if (batch.cidrs?.length > 0) {
        const batchResult = this.processCIDRsIntoFilters(batch.cidrs, cidrFilter, cidrChecker);
        result.expandedCidrCount += batchResult.expandedCidrCount;
        result.largeCidrCount += batchResult.largeCidrCount;
      }
    });

    return result;
  }

  /**
   * Load threat data (initialization helper)
   */
  private async loadThreatData(): Promise<void> {
    const { optimizedDataLoader } = await import("./optimized-data-loader.ts");

    const { ipCount, cidrCount } = await optimizedDataLoader.getThreatCounts();

    const newFilters = this.createFilters(ipCount, cidrCount);

    newFilters.cidrChecker.optimize();

    this.filters = { ...newFilters, isInitialized: false };
  }

  /**
   * Get total memory usage in KB
   */
  private getMemoryUsageKB(): number {
    let totalKB = 0;

    if (this.filters.ipFilter) {
      totalKB += this.filters.ipFilter.getStats().memoryKB;
    }

    if (this.filters.cidrFilter) {
      totalKB += this.filters.cidrFilter.getStats().memoryKB;
    }

    totalKB += this.filters.cidrChecker.getStats().memoryKB;

    return totalKB;
  }

  /**
   * Update rolling average response time
   */
  private updateAverageResponseTime(responseTime: number): void {
    const alpha = 0.1;
    if (this.metrics.averageResponseTimeMs === 0) {
      this.metrics.averageResponseTimeMs = responseTime;
    } else {
      this.metrics.averageResponseTimeMs = alpha * responseTime +
        (1 - alpha) * this.metrics.averageResponseTimeMs;
    }
  }
}
