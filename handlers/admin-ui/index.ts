/**
 * @file handlers/admin-ui/index.ts
 * @description Barrel for admin-UI handlers (mirrors routes/admin-ui/).
 *
 * Route ↔ handler mirror:
 *   cache-visualizer.handler.ts     ↔ cache-visualizer.route.ts
 *   trace-visualizer.handler.ts     ↔ trace-visualizer.route.ts
 *   threat-intelligence.handler.ts  ↔ threat-intelligence.route.ts
 */

export { cacheVisualizerHandler, cacheVisualizerStatsHandler } from "./cache-visualizer.handler.ts";
export { traceVisualizerDataHandler, traceVisualizerDetailHandler, traceVisualizerStatsHandler } from "./trace-visualizer.handler.ts";
export {
  threatIntelAddCustomBlacklistCIDRHandler,
  threatIntelAddCustomBlacklistIPHandler,
  threatIntelAddWhitelistCIDRHandler,
  threatIntelAddWhitelistIPHandler,
  threatIntelCustomBlacklistEntriesHandler,
  threatIntelHealthHandler,
  threatIntelPerformanceHandler,
  threatIntelReloadHandler,
  threatIntelRemoveCustomBlacklistCIDRHandler,
  threatIntelRemoveCustomBlacklistIPHandler,
  threatIntelRemoveWhitelistCIDRHandler,
  threatIntelRemoveWhitelistIPHandler,
  threatIntelSourcesHandler,
  threatIntelStatusHandler,
  threatIntelTrendsHandler,
  threatIntelUpdateHistoryHandler,
  threatIntelWhitelistEntriesHandler,
} from "./threat-intelligence.handler.ts";
