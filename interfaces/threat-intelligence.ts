/**
 * @file interfaces/threat-intelligence.ts
 * @description Threat intelligence service interfaces
 * These interfaces define the structure for threat intelligence operations and data
 */

/**
 * Cached threat intelligence result
 */
export interface IThreatCachedResult {
  isThreat: boolean;
  isWhitelisted: boolean;
  riskScore: number;
  sources: string[];
  category: string;
  sourceCategories: string[];
  cachedAt: number;
}

/**
 * Bulk import data structure for threat intelligence
 */
export interface IThreatBulkImportData {
  sources: Array<{
    name: string;
    description?: string;
    url: string;
    ips: Array<{
      ip: string;
      riskScore: number;
      category: string;
    }>;
    cidrs: Array<{
      cidr: string;
      riskScore: number;
      category: string;
    }>;
  }>;
}

/**
 * Result of bulk import operation
 */
export interface IThreatBulkImportResult {
  sourcesCreated: number;
  ipsImported: number;
  cidrsImported: number;
  errors: string[];
}

/**
 * Database statistics for threat intelligence
 */
export interface IThreatDatabaseStats {
  totalThreatIPs: number;
  totalThreatCIDRs: number;
  totalWhitelistedIPs: number;
  totalWhitelistedCIDRs: number;
  activeSources: number;
}

/**
 * Threat source information
 */
export interface IThreatSource {
  id: string;
  name: string;
  description?: string;
  url?: string;
  isActive: boolean;
  updateFrequency: number;
  totalEntries: number;
  createdAt: string;
  updatedAt: string;
  stats: {
    threatIPsCount: number;
    threatCIDRsCount: number;
  };
}

/**
 * Risk distribution analytics
 */
export interface IRiskDistribution {
  distribution: {
    low: { count: number; percentage: number }; // 0-49
    medium: { count: number; percentage: number }; // 50-79
    high: { count: number; percentage: number }; // 80-100
  };
  averageRiskScore: number;
  histogram: Array<{ range: string; count: number }>;
}

/**
 * Category analytics
 */
export interface ICategoryAnalytics {
  categories: Array<{
    category: string;
    count: number;
    percentage: number;
    avgRiskScore: number;
  }>;
}

/**
 * Country analytics
 */
export interface ICountryAnalytics {
  countries: Array<{
    countryCode: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * ASN analytics
 */
export interface IASNAnalytics {
  asns: Array<{
    asn: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * Whitelist entry
 */
export interface IWhitelistEntry {
  id: string;
  type: "ip" | "cidr";
  value: string;
  reason?: string;
  addedBy?: string;
  metadata?: {
    organization?: string;
    contact?: string;
    tags?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Whitelist entries response with pagination
 */
export interface IWhitelistEntriesResponse {
  entries: IWhitelistEntry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Update log entry
 */
export interface IUpdateLogEntry {
  id: string;
  sourceId: string | null;
  sourceName: string;
  updateType: "full" | "incremental" | "manual";
  status: "pending" | "success" | "failed";
  entriesAdded: number;
  entriesUpdated: number;
  entriesRemoved: number;
  duration: number;
  errorMessage?: string;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    triggeredBy?: string;
  };
  createdAt: string;
}

/**
 * Update history response with pagination
 */
export interface IUpdateHistoryResponse {
  updates: IUpdateLogEntry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  summary: {
    totalUpdates: number;
    successRate: number;
    averageDuration: number;
  };
}

/**
 * Performance metrics
 */
export interface IPerformanceMetrics {
  bloomFilter: {
    totalChecks: number;
    bloomHits: number;
    cidrHits: number;
    misses: number;
    hitRate: number;
    averageResponseTimeMs: number;
    initializationTimeMs: number;
    filterCount: number;
    totalElements: number;
    totalCapacity: number;
    utilization: number;
    falsePositiveRate: number;
  };
  whitelist: {
    totalLookups: number;
    cacheHits: number;
    hitRate: number;
    averageLoadTime: number;
    loadCount: number;
    memoryEfficiency: number;
  };
  cache: {
    hitRate: number;
    missRate: number;
    size: number;
    ttl: number;
  };
}

/**
 * Health check response
 */
export interface IHealthCheckResponse {
  overallStatus: "healthy" | "warning" | "critical";
  checks: {
    initialization: {
      status: boolean;
      message: string;
    };
    bloomFilter: {
      status: boolean;
      message: string;
      metrics: object;
    };
    whitelist: {
      status: boolean;
      message: string;
      integrity: {
        isValid: boolean;
        issues: string[];
        recommendations: string[];
      };
    };
    database: {
      status: boolean;
      message: string;
      connectionTime: number;
    };
    cache: {
      status: boolean;
      message: string;
    };
  };
  summary: string;
  recommendedActions: string[];
}

/**
 * Trends analytics
 */
export interface ITrendsAnalytics {
  period: string;
  metric: string;
  data: Array<{
    timestamp: string;
    value: number;
  }>;
  summary: {
    total: number;
    average: number;
    min: number;
    max: number;
    trend: "increasing" | "decreasing" | "stable";
  };
}

/**
 * Request to add IP to whitelist
 */
export interface IAddWhitelistIPRequest {
  ipAddress: string;
  reason?: string;
  metadata?: {
    organization?: string;
    contact?: string;
    tags?: string[];
  };
}

/**
 * Request to add CIDR to whitelist
 */
export interface IAddWhitelistCIDRRequest {
  cidrBlock: string;
  reason?: string;
  metadata?: {
    organization?: string;
    contact?: string;
    estimatedHosts?: number;
    tags?: string[];
  };
}
