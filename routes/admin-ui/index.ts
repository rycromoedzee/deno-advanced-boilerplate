/**
 * @file routes/admin-ui/index.ts
 * @description Barrel/Hono app wiring for admin ui routes
 */
/**
 * Admin UI Routes
 *
 * Centralized routes for admin UI visualizers and tools
 */

import { OpenAPIHono } from "@deps";
import { visualizerDataRoute, visualizerStatsRoute, visualizerUIHandler, visualizerUIRoute } from "./cache-visualizer.route.ts";
import { traceVisualizerDataRoute, traceVisualizerDetailRoute, traceVisualizerStatsRoute } from "./trace-visualizer.route.ts";
import {
  threatIntelAddCustomBlacklistCIDRRoute,
  threatIntelAddCustomBlacklistIPRoute,
  threatIntelAddWhitelistCIDRRoute,
  threatIntelAddWhitelistIPRoute,
  threatIntelCustomBlacklistEntriesRoute,
  threatIntelHealthRoute,
  threatIntelPerformanceRoute,
  threatIntelReloadRoute,
  threatIntelRemoveCustomBlacklistCIDRRoute,
  threatIntelRemoveCustomBlacklistIPRoute,
  threatIntelRemoveWhitelistCIDRRoute,
  threatIntelRemoveWhitelistIPRoute,
  threatIntelSourcesRoute,
  threatIntelStatusRoute,
  threatIntelTrendsRoute,
  threatIntelUpdateHistoryRoute,
  threatIntelWhitelistEntriesRoute,
} from "./threat-intelligence.route.ts";
import {
  cacheVisualizerHandler,
  cacheVisualizerStatsHandler,
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
  traceVisualizerDataHandler,
  traceVisualizerDetailHandler,
  traceVisualizerStatsHandler,
} from "@handlers/admin-ui/index.ts";

const adminUI = new OpenAPIHono();

// Cache Visualizer Routes
adminUI.openapi(visualizerUIRoute, visualizerUIHandler);
adminUI.openapi(visualizerDataRoute, cacheVisualizerHandler);
adminUI.openapi(visualizerStatsRoute, cacheVisualizerStatsHandler);

// Trace Visualizer Routes
adminUI.openapi(traceVisualizerDataRoute, traceVisualizerDataHandler);
adminUI.openapi(traceVisualizerStatsRoute, traceVisualizerStatsHandler);
adminUI.openapi(traceVisualizerDetailRoute, traceVisualizerDetailHandler);

// Threat Intelligence Routes
adminUI.openapi(threatIntelReloadRoute, threatIntelReloadHandler);
adminUI.openapi(threatIntelStatusRoute, threatIntelStatusHandler);
adminUI.openapi(threatIntelSourcesRoute, threatIntelSourcesHandler);
adminUI.openapi(threatIntelWhitelistEntriesRoute, threatIntelWhitelistEntriesHandler);
adminUI.openapi(threatIntelUpdateHistoryRoute, threatIntelUpdateHistoryHandler);
adminUI.openapi(threatIntelPerformanceRoute, threatIntelPerformanceHandler);
adminUI.openapi(threatIntelHealthRoute, threatIntelHealthHandler);
adminUI.openapi(threatIntelTrendsRoute, threatIntelTrendsHandler);
adminUI.openapi(threatIntelAddWhitelistIPRoute, threatIntelAddWhitelistIPHandler);
adminUI.openapi(threatIntelRemoveWhitelistIPRoute, threatIntelRemoveWhitelistIPHandler);
adminUI.openapi(threatIntelAddWhitelistCIDRRoute, threatIntelAddWhitelistCIDRHandler);
adminUI.openapi(threatIntelRemoveWhitelistCIDRRoute, threatIntelRemoveWhitelistCIDRHandler);
adminUI.openapi(threatIntelCustomBlacklistEntriesRoute, threatIntelCustomBlacklistEntriesHandler);
adminUI.openapi(threatIntelAddCustomBlacklistIPRoute, threatIntelAddCustomBlacklistIPHandler);
adminUI.openapi(threatIntelRemoveCustomBlacklistIPRoute, threatIntelRemoveCustomBlacklistIPHandler);
adminUI.openapi(threatIntelAddCustomBlacklistCIDRRoute, threatIntelAddCustomBlacklistCIDRHandler);
adminUI.openapi(threatIntelRemoveCustomBlacklistCIDRRoute, threatIntelRemoveCustomBlacklistCIDRHandler);

export default adminUI;
