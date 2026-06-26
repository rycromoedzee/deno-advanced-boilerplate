/**
 * @file utils/instance-id.ts
 * @description Generates unique instance/process identifiers
 */
/**
 * Instance ID Generator - Centralized instance identification
 *
 * Generates a unique, stable identifier for each application instance.
 * This ID should be created once at application startup in main.ts
 * and passed to all services that need it.
 *
 * Resolution priority:
 * 1. Bunny.net Magic Containers: `<BUNNYNET_MC_APPID>-<BUNNYNET_MC_PODID>-<workerSuffix>`
 *    e.g. "UXVcr8Aw71Yq7Ej-cl6aeY8U6m8Kre-4f9xk2a"
 * 2. Hostname + random suffix: `hostname-randomsuffix`
 *    e.g. "pc-711a7mtlg"
 * 3. Universal fallback: `instance_timestamp_randomsuffix`
 *    e.g. "instance_1761435623752_711a7mtlg"
 *
 * The `WORKER_SUFFIX` is a random value evaluated once at module load time.
 * `deno serve --parallel` runs each worker as an isolate inside the same OS
 * process (same PID), so Deno.pid cannot differentiate them. Each isolate
 * evaluates this module independently, producing a unique suffix per worker.
 */
const WORKER_SUFFIX = Math.random().toString(36).substring(2, 9);

export let instanceId: string | null = null;

export function generateInstanceId(): string {
  // 1. Prefer Bunny.net Magic Containers metadata.
  const bunnyAppId = Deno.env.get("BUNNYNET_MC_APPID");
  const bunnyPodId = Deno.env.get("BUNNYNET_MC_PODID");
  if (bunnyAppId && bunnyPodId) {
    instanceId = `${bunnyAppId}-${bunnyPodId}-${WORKER_SUFFIX}`;
    return instanceId;
  }

  // 2. Hostname + random suffix.
  try {
    const randomSuffix = Math.random().toString(36).substring(2, 11);
    instanceId = `${Deno.hostname()}-${randomSuffix}`;
    return instanceId;
  } catch {
    // 3. Universal fallback when hostname is unavailable.
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 11);
    instanceId = `instance_${timestamp}_${randomSuffix}`;
    return instanceId;
  }
}

export const getInstanceId = () => {
  if (!instanceId) {
    return generateInstanceId();
  }

  return instanceId;
};
