/**
 * @file tests/unit/services/threat-intelligence/bloom-auto-reload.test.ts
 * @description Unit tests for ThreatIntelligenceService bloom freshness (pull-based, request-driven, in-HTTP-process).
 *
 * The live bloom filter the request middleware reads is frozen at boot because
 * neither scheduled job runs in the HTTP isolate. The fix is a request-driven,
 * throttled self-reload gated by a cheap change-detection signature. These tests
 * drive the real lifecycle through protected seams — getBloomSignature() is
 * overridden to avoid the DB, shouldRunBloomAutoReload() to run regardless of
 * NODE_ENV — with bloomFilterService.reload() stubbed and spied. No DB, no network.
 */
import { assertEquals } from "@std/assert";
import { ThreatIntelligenceService } from "@services/threat-intelligence/threat-intelligence.service.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Minimal bloom service stub with a counted, resettable reload(). */
function makeBloomStub() {
  let reloadCalls = 0;
  return {
    reloadCalls: () => reloadCalls,
    reset: () => {
      reloadCalls = 0;
    },
    service: {
      async reload() {
        reloadCalls++;
        return { ipCount: 0, cidrCount: 0, totalMemoryKB: 0 };
      },
    },
  };
}

class TestService extends ThreatIntelligenceService {
  /** Controllable signature so tests avoid the DB entirely. */
  signature = "sig-initial";

  /** Flip to force shouldRunBloomAutoReload() off. */
  disabled = false;

  constructor(bloomService: unknown) {
    // whitelistService is unused by the bloom-reload path; pass a no-op stub.
    super({ loadWhitelistData: async () => {} } as never, bloomService as never);
  }

  protected override async getBloomSignature(): Promise<string> {
    return this.signature;
  }

  protected override shouldRunBloomAutoReload(): boolean {
    return !this.disabled;
  }

  /** Public passthrough so tests can drive the reload directly. */
  override maybeReloadBloom(): Promise<void> {
    return super.maybeReloadBloom();
  }
}

/** Prime the signature baseline (lastBloomSignature starts null), then reset the counter. */
async function prime(svc: TestService, stub: ReturnType<typeof makeBloomStub>, signature: string): Promise<void> {
  svc.signature = signature;
  await svc.maybeReloadBloom(); // null -> signature (initial reload)
  stub.reset();
}

Deno.test("maybeReloadBloom: skips reload when the signature is unchanged", async () => {
  const stub = makeBloomStub();
  const svc = new TestService(stub.service);
  await prime(svc, stub, "v1");
  await svc.maybeReloadBloom(); // unchanged
  await svc.maybeReloadBloom(); // unchanged
  assertEquals(stub.reloadCalls(), 0);
});

Deno.test("maybeReloadBloom: reloads once when the signature changes", async () => {
  const stub = makeBloomStub();
  const svc = new TestService(stub.service);
  await prime(svc, stub, "v1");
  svc.signature = "v2";
  await svc.maybeReloadBloom(); // changed -> reload
  assertEquals(stub.reloadCalls(), 1);
});

Deno.test("maybeReloadBloom: does not re-reload on consecutive identical signatures", async () => {
  const stub = makeBloomStub();
  const svc = new TestService(stub.service);
  await prime(svc, stub, "v1");
  svc.signature = "v2";
  await svc.maybeReloadBloom(); // reload (=1)
  await svc.maybeReloadBloom(); // still v2 -> skip
  assertEquals(stub.reloadCalls(), 1);
});

Deno.test("ensureBloomFresh: triggers a reload on change, then throttles within the window", async () => {
  const stub = makeBloomStub();
  const svc = new TestService(stub.service);
  await prime(svc, stub, "v1"); // baseline signature "v1"; lastBloomCheckAtMs still 0

  // First request after a change: window is open (lastCheck=0) -> fire-and-forget reload.
  svc.signature = "v2";
  svc.ensureBloomFresh();
  await wait(10); // let the fire-and-forget reload settle
  assertEquals(stub.reloadCalls(), 1);

  // A further change within the (30-min) throttle window must NOT trigger another check.
  svc.signature = "v3";
  svc.ensureBloomFresh();
  await wait(10);
  assertEquals(stub.reloadCalls(), 1);
});

Deno.test("ensureBloomFresh: no-op when the bloom check is disabled", async () => {
  const stub = makeBloomStub();
  const svc = new TestService(stub.service);
  await prime(svc, stub, "v1");

  svc.disabled = true; // shouldRunBloomAutoReload() -> false
  svc.signature = "v2";
  svc.ensureBloomFresh();
  await wait(10);
  assertEquals(stub.reloadCalls(), 0);
});
