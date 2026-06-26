export function formatTTL(ttl: string | null): string {
  if (ttl === null || ttl === "Persistent") return "Persistent";
  return ttl;
}

export function formatExpires(timestamp: number | null): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function safePreview(value: unknown): string {
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.length > 100 ? str.slice(0, 97) + "..." : str;
  } catch {
    return "[circular]";
  }
}
