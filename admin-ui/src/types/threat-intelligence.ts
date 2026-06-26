/**
 * Threat-intelligence types for the admin UI.
 *
 * Backend-mirrored response shapes are aliased to the generated OpenAPI types
 * (`./api.generated.ts`) so the backend contract is the single source of truth
 * and contract drift fails at compile time. The previous hand-written copies and
 * the `../../../interfaces/threat-intelligence` backend import have been removed.
 *
 * Exported NAMES are preserved so services/components compile unchanged; they now
 * resolve to generated component schemas.
 */

import type { components } from "./api.generated";

/* ------------------------------------------------------------------ */
/* Re-exported entity/data shapes — aliased to generated schemas.       */
/* These keep the historical `I*` names used across the UI.             */
/* ------------------------------------------------------------------ */

export type IThreatSource = components["schemas"]["AdminThreatSource"];
export type IWhitelistEntry = components["schemas"]["AdminThreatIntelWhitelistEntry"];
export type IUpdateLogEntry = components["schemas"]["AdminThreatIntelUpdateLogEntry"];
export type ICustomBlacklistEntry = components["schemas"]["AdminCustomBlacklistEntry"];

/** `data` payload of the status response (the live threat-intel stats snapshot). */
export type ThreatIntelStats = components["schemas"]["AdminThreatIntelStatus"]["data"];

/** `data` payload of the performance response (bloom/whitelist/cache metrics). */
export type IPerformanceMetrics = components["schemas"]["AdminThreatIntelPerformance"]["data"];

/** `data` payload of the health response (overallStatus + per-check rollup). */
export type IHealthCheckResponse = components["schemas"]["AdminThreatIntelHealth"]["data"];

/** `data` payload of the trends response (time-series + summary). */
export type ITrendsAnalytics = components["schemas"]["AdminThreatIntelTrends"]["data"];

/** `data` payload of the update-history response (entries + pagination + summary). */
export type IUpdateHistoryResponse = components["schemas"]["AdminThreatIntelUpdateHistory"]["data"];

/** `data` payload of the whitelist-entries response (entries + pagination). */
export type IWhitelistEntriesResponse = components["schemas"]["AdminThreatIntelWhitelistEntries"]["data"];

/* ------------------------------------------------------------------ */
/* Full response wrappers (success + data) — aliased to generated.      */
/* ------------------------------------------------------------------ */

export type ThreatIntelStatusResponse = components["schemas"]["AdminThreatIntelStatus"];
export type ThreatIntelReloadResponse = components["schemas"]["AdminThreatIntelReload"];
export type ThreatIntelSourcesResponse = components["schemas"]["AdminThreatIntelSources"];
export type ThreatIntelWhitelistEntriesResponse = components["schemas"]["AdminThreatIntelWhitelistEntries"];
export type ThreatIntelUpdateHistoryResponse = components["schemas"]["AdminThreatIntelUpdateHistory"];
export type ThreatIntelPerformanceResponse = components["schemas"]["AdminThreatIntelPerformance"];
export type ThreatIntelHealthResponse = components["schemas"]["AdminThreatIntelHealth"];
export type ThreatIntelTrendsResponse = components["schemas"]["AdminThreatIntelTrends"];
export type ThreatIntelCustomBlacklistEntriesResponse = components["schemas"]["AdminThreatIntelCustomBlacklistEntries"];

/**
 * Response for an add-whitelist mutation. The whitelist mutation endpoints are
 * not yet registered in the OpenAPI spec, so this UI-facing envelope remains
 * hand-written.
 */
export interface WhitelistOperationResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    type: "ip" | "cidr";
    value: string;
    createdAt: string;
  };
}
