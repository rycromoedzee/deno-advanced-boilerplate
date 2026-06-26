/**
 * @file constants/threat-intelligence.ts
 * @description Threat Intelligence source definitions and configurations
 *
 * Single source of truth for all threat intelligence sources.
 * Used by seed scripts, update scripts, and the update service.
 */

/**
 * Threat source configuration interface
 */
export interface ThreatSourceConfig {
  name: string;
  description: string;
  url: string | null;
  updateFrequency: number; // hours
  isActive: boolean;
  tier?: 1 | 2 | 3 | 4; // Threat tier (1=critical, 2=confirmed, 3=extended, 4=monitoring)
  riskScore: number; // 0-100
  category: "malicious" | "suspicious" | "spam" | "bruteforce" | "scanner" | "anonymizer" | "infrastructure";
}

/**
 * To get a fresh and ready-to-deploy auto-ban list of "bad IPs" that appear on at least 2:
 */
export const IPSUM_THREAT_LEVEL = 2;

/**
 * All threat intelligence sources
 * This is the single source of truth for threat intelligence configuration
 */
export const THREAT_SOURCES: readonly ThreatSourceConfig[] = [
  // ===== Tier 1: Critical Threats (Hard Block) =====
  {
    name: "Team Cymru Full Bogons",
    description:
      "Team Cymru Full Bogons - Unallocated/private/reserved (bogon) IPv4 space that should never originate legitimate public traffic",
    url: "https://www.team-cymru.org/Services/Bogons/fullbogons-ipv4.txt",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 1, // Anti-spoofing baseline; ~zero false positives for real public clients
    riskScore: 90,
    category: "infrastructure",
  },
  {
    name: "Spamhaus DROP",
    description: "Spamhaus DROP (Don't Route Or Peer) list",
    url: "https://www.spamhaus.org/drop/drop.txt",
    updateFrequency: 24, // Daily - relatively stable
    isActive: true,
    tier: 1,
    riskScore: 90,
    category: "malicious",
  },
  {
    name: "URLhaus IPs",
    description: "Abuse.ch URLhaus - Malicious URL hosting IPs",
    url: "https://urlhaus.abuse.ch/downloads/text_recent/",
    updateFrequency: 12, // Twice daily
    isActive: true,
    tier: 1,
    riskScore: 85,
    category: "malicious",
  },
  {
    name: "AbuseIPDB Score 100",
    description: "AbuseIPDB IPs with 100% confidence score - aggregated by borestad/blocklist-abuseipdb",
    url: "https://raw.githubusercontent.com/borestad/blocklist-abuseipdb/refs/heads/main/abuseipdb-s100-7d.ipv4",
    updateFrequency: 18,
    isActive: true,
    tier: 1, // 100% confidence score = highest confidence
    riskScore: 95, // Very high - only 100% confidence IPs
    category: "malicious",
  },
  {
    name: "Feodo Tracker",
    description: "Abuse.ch Feodo Tracker - Botnet C2 infrastructure (Emotet, Dridex, QakBot)",
    url: "https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
    updateFrequency: 12, // Twice daily - high-priority C2 intel
    isActive: true,
    tier: 1,
    riskScore: 90,
    category: "malicious",
  },

  // ===== Tier 2: Confirmed Threats =====
  {
    name: "DShield 7d",
    description: "DShield top attacking IPs (last 7 days)",
    url: "https://iplists.firehol.org/files/dshield_7d.netset",
    updateFrequency: 12, // Twice daily - actively attacking IPs
    isActive: true,
    tier: 2,
    riskScore: 70,
    category: "scanner",
  },
  {
    name: "ET Compromised",
    description: "Emerging Threats - Compromised host IPs",
    url: "https://iplists.firehol.org/files/et_compromised.ipset",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 2,
    riskScore: 85,
    category: "malicious",
  },
  // NOTE: "Blocklist.de Apache" and "Blocklist.de Bots" were intentionally
  // dropped. blocklist.de's all.txt is the union of every per-service list, so
  // those two were ~99% / ~79% subsets of "Blocklist.de All" (the rest is
  // snapshot-timing skew that converges each refresh) AND carried the same
  // riskScore (75 → "challenge"), so they produced identical enforcement.
  // The SSH / Bruteforce / StrongIPs slices are kept because their higher
  // riskScore (80/85) escalates those IPs from "challenge" to "block".
  {
    name: "Blocklist.de Bruteforce",
    description: "Blocklist.de - Brute force attack sources",
    url: "https://iplists.firehol.org/files/blocklist_de_bruteforce.ipset",
    updateFrequency: 12, // Twice daily
    isActive: true,
    tier: 2,
    riskScore: 80,
    category: "bruteforce",
  },
  {
    name: "Blocklist.de SSH",
    description: "Blocklist.de - IPs attacking SSH services",
    url: "https://iplists.firehol.org/files/blocklist_de_ssh.ipset",
    updateFrequency: 12,
    isActive: true,
    tier: 2,
    riskScore: 80,
    category: "bruteforce",
  },
  {
    name: "Blocklist.de StrongIPs",
    description: "Blocklist.de - Persistent repeat attackers (>5k attacks, older than 2 months)",
    url: "https://iplists.firehol.org/files/blocklist_de_strongips.ipset",
    updateFrequency: 24,
    isActive: true,
    tier: 2,
    riskScore: 85,
    category: "bruteforce",
  },
  {
    name: "Blocklist.de All",
    description: "Blocklist.de - All attack types aggregated (SSH, mail, web, bots, FTP, SIP)",
    url: "https://lists.blocklist.de/lists/all.txt",
    updateFrequency: 12,
    isActive: true,
    tier: 2,
    riskScore: 75,
    category: "malicious",
  },
  {
    name: "Ipsum.txt",
    description: "IPsum - Malicious IPs aggregated from multiple threat intelligence feeds",
    url: "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 2,
    riskScore: 75,
    category: "malicious",
  },
  {
    name: "CINS Bad Guys",
    description: "CINS Army List - IPs involved in malicious activities",
    url: "https://cinsscore.com/list/ci-badguys.txt",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 2,
    riskScore: 85,
    category: "malicious",
  },
  {
    name: "GreenSnow",
    description: "GreenSnow - Actively attacking IPs (frequently updated)",
    url: "https://blocklist.greensnow.co/greensnow.txt",
    updateFrequency: 4, // Hourly - frequently updated
    isActive: true,
    tier: 2,
    riskScore: 75,
    category: "scanner",
  },
  {
    name: "Binary Defense",
    description: "Binary Defense - Attack IPs from honeypots",
    url: "https://www.binarydefense.com/banlist.txt",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 2,
    riskScore: 80,
    category: "scanner",
  },
  {
    name: "BruteforceBlocker",
    description: "BruteforceBlocker - SSH brute force attack sources",
    url: "https://iplists.firehol.org/files/bruteforceblocker.ipset",
    updateFrequency: 12,
    isActive: true,
    tier: 2,
    riskScore: 80,
    category: "bruteforce",
  },
  {
    name: "DataPlane SSH",
    description: "DataPlane - SSH client connection attempts detected via network telescopes worldwide",
    url: "https://dataplane.org/sshpwauth.txt",
    updateFrequency: 1, // Hourly - very current
    isActive: true,
    tier: 2,
    riskScore: 70,
    category: "scanner",
  },
  {
    name: "DataPlane VNC",
    description: "DataPlane - VNC Remote Framebuffer probe attempts detected via network telescopes",
    url: "https://dataplane.org/vncrfb.txt",
    updateFrequency: 1, // Hourly
    isActive: true,
    tier: 2,
    riskScore: 65,
    category: "scanner",
  },
  {
    name: "CleanTalk 7d",
    description: "CleanTalk - HTTP form spammers, comment spammers, and registration bots (last 7 days)",
    url: "https://iplists.firehol.org/files/cleantalk_7d.ipset",
    updateFrequency: 1, // Hourly - fast updates from 500K+ protected sites
    isActive: true,
    tier: 2,
    riskScore: 70,
    category: "spam",
  },
  {
    name: "MalTrail Scanners",
    description: "MalTrail - Mass Internet scanners performing large-scale reconnaissance",
    url: "https://iplists.firehol.org/files/maltrail_scanners.ipset",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 2,
    riskScore: 65,
    category: "scanner",
  },
  {
    name: "CyberCure",
    description: "CyberCure - AI-based threat intelligence from real-time infection monitoring sensors",
    url: "https://iplists.firehol.org/files/cybercure.ipset",
    updateFrequency: 6, // Every 6 hours
    isActive: true,
    tier: 2,
    riskScore: 70,
    category: "malicious",
  },

  // ===== Tier 3: Extended Protection =====
  {
    name: "StopForumSpam 7d",
    description: "StopForumSpam - Auth form protection (last 7 days)",
    url: "https://iplists.firehol.org/files/stopforumspam_7d.ipset",
    updateFrequency: 24, // Daily
    isActive: true,
    tier: 3,
    riskScore: 70,
    category: "spam",
  },
  {
    name: "StopForumSpam Toxic",
    description: "StopForumSpam Toxic - Entire CIDR ranges with persistent spambot concentrations",
    url: "https://iplists.firehol.org/files/stopforumspam_toxic.netset",
    updateFrequency: 24, // Daily - stable network-level data
    isActive: true,
    tier: 3,
    riskScore: 65,
    category: "spam",
  },
  {
    name: "ProjectHoneypot Harvesters",
    description: "ProjectHoneypot - Email address harvesters detected by global honeypot network",
    url: "https://iplists.firehol.org/files/php_harvesters_7d.ipset",
    updateFrequency: 1, // Hourly
    isActive: true,
    tier: 3,
    riskScore: 60,
    category: "spam",
  },
  {
    name: "Tor Exit Nodes",
    description: "Tor Project - Known exit node IPs via FireHOL mirror",
    url: "https://iplists.firehol.org/files/tor_exits.ipset",
    updateFrequency: 6,
    isActive: true,
    tier: 3,
    riskScore: 40,
    category: "anonymizer",
  },
  // ===== Managed Sources =====
  {
    name: "Custom Blacklist",
    description: "Manually curated blacklist of IPs and CIDRs managed via Admin UI",
    url: null, // No external URL - managed internally
    updateFrequency: 0, // No automatic updates - manual only
    isActive: true,
    tier: 1, // Critical - custom entries should be highest priority
    riskScore: 100, // Maximum risk - admin explicitly blocked these
    category: "malicious",
  },
] as const;

/**
 * Get active threat sources only
 */
export function getActiveThreatSources(): readonly ThreatSourceConfig[] {
  return THREAT_SOURCES.filter((source) => source.isActive);
}

/**
 * Get threat sources by tier
 */
export function getThreatSourcesByTier(tier: 1 | 2 | 3 | 4): readonly ThreatSourceConfig[] {
  return THREAT_SOURCES.filter((source) => source.tier === tier && source.isActive);
}

/**
 * Get threat source by name
 */
export function getThreatSourceByName(name: string): ThreatSourceConfig | undefined {
  return THREAT_SOURCES.find((source) => source.name === name);
}
