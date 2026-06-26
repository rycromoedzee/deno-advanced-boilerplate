import { http } from "./http";
import type {
  ThreatIntelCustomBlacklistEntriesResponse,
  ThreatIntelHealthResponse,
  ThreatIntelPerformanceResponse,
  ThreatIntelReloadResponse,
  ThreatIntelSourcesResponse,
  ThreatIntelStatusResponse,
  ThreatIntelTrendsResponse,
  ThreatIntelUpdateHistoryResponse,
  ThreatIntelWhitelistEntriesResponse,
  WhitelistOperationResponse,
} from "@/types/threat-intelligence";

export const threatIntelligenceService = {
  async getStatus(): Promise<ThreatIntelStatusResponse> {
    return http.get<ThreatIntelStatusResponse>("/api/internal/__threat-intel/status");
  },

  async reload(): Promise<ThreatIntelReloadResponse> {
    return http.post<ThreatIntelReloadResponse>("/api/internal/__threat-intel/reload");
  },

  async getSources(): Promise<ThreatIntelSourcesResponse> {
    return http.get<ThreatIntelSourcesResponse>("/api/internal/__threat-intel/sources");
  },

  async getWhitelistEntries(
    params: { type?: string; page?: number; limit?: number } = {},
  ): Promise<ThreatIntelWhitelistEntriesResponse> {
    return http.get<ThreatIntelWhitelistEntriesResponse>(
      "/api/internal/__threat-intel/whitelist/entries",
      { params },
    );
  },

  async getUpdateHistory(
    params: { sourceId?: string; status?: string; page?: number; limit?: number } = {},
  ): Promise<ThreatIntelUpdateHistoryResponse> {
    return http.get<ThreatIntelUpdateHistoryResponse>(
      "/api/internal/__threat-intel/update-history",
      { params },
    );
  },

  async getPerformance(): Promise<ThreatIntelPerformanceResponse> {
    return http.get<ThreatIntelPerformanceResponse>("/api/internal/__threat-intel/performance");
  },

  async getHealth(): Promise<ThreatIntelHealthResponse> {
    return http.get<ThreatIntelHealthResponse>("/api/internal/__threat-intel/health");
  },

  async getTrends(params: { period: string; metric: string }): Promise<ThreatIntelTrendsResponse> {
    return http.get<ThreatIntelTrendsResponse>(
      "/api/internal/__threat-intel/analytics/trends",
      { params },
    );
  },

  async addWhitelistIP(data: { ipAddress: string; reason?: string }): Promise<WhitelistOperationResponse> {
    return http.post<WhitelistOperationResponse>("/api/internal/__threat-intel/whitelist/ip", data);
  },

  async removeWhitelistIP(ip: string): Promise<void> {
    await http.delete<void>(`/api/internal/__threat-intel/whitelist/ip/${encodeURIComponent(ip)}`);
  },

  async addWhitelistCIDR(data: { cidrBlock: string; reason?: string }): Promise<WhitelistOperationResponse> {
    return http.post<WhitelistOperationResponse>(
      "/api/internal/__threat-intel/whitelist/cidr",
      data,
    );
  },

  async removeWhitelistCIDR(cidr: string): Promise<void> {
    await http.delete<void>(`/api/internal/__threat-intel/whitelist/cidr/${encodeURIComponent(cidr)}`);
  },

  async getCustomBlacklistEntries(
    params: { type?: string; page?: number; limit?: number } = {},
  ): Promise<ThreatIntelCustomBlacklistEntriesResponse> {
    return http.get<ThreatIntelCustomBlacklistEntriesResponse>(
      "/api/internal/__threat-intel/custom-blacklist/entries",
      { params },
    );
  },

  async addCustomBlacklistIP(data: { ipAddress: string; reason?: string }): Promise<void> {
    await http.post<void>("/api/internal/__threat-intel/custom-blacklist/ip", data);
  },

  async removeCustomBlacklistIP(ip: string): Promise<void> {
    await http.delete<void>(
      `/api/internal/__threat-intel/custom-blacklist/ip/${encodeURIComponent(ip)}`,
    );
  },

  async addCustomBlacklistCIDR(data: { cidrBlock: string; reason?: string }): Promise<void> {
    await http.post<void>("/api/internal/__threat-intel/custom-blacklist/cidr", data);
  },

  async removeCustomBlacklistCIDR(cidr: string): Promise<void> {
    await http.delete<void>(
      `/api/internal/__threat-intel/custom-blacklist/cidr/${encodeURIComponent(cidr)}`,
    );
  },
};
