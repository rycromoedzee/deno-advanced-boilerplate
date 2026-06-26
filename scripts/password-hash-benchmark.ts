/**
 * Password Hashing Benchmark: SCrypt vs Argon2id
 *
 * This script compares the performance of the current SCrypt implementation
 * against Argon2id with various recommended configurations.
 *
 * We test two Argon2 implementations:
 * 1. @noble/hashes/argon2 - Pure JS implementation
 * 2. @felix/argon2 - Native bindings (typically faster)
 *
 * Configurations tested:
 *
 * RFC 9106 recommended (Argon2 specification):
 * - m=65536 (64 MiB), t=3, p=4  (RFC 9106 fallback recommendation)
 * - m=65536 (64 MiB), t=3, p=1  (single-threaded variant)
 *
 * OWASP tiered recommendations (all provide equal security):
 * - m=47104 (46 MiB), t=1, p=1  (1st choice - maximize memory)
 * - m=19456 (19 MiB), t=2, p=1  (2nd choice)
 * - m=12288 (12 MiB), t=3, p=1  (3rd choice)
 *
 * Current SCrypt config (OWASP-compliant minimum):
 * - N=2^17 (131072), r=8, p=1, dkLen=64  (~128 MiB RAM)
 *
 * Standards applied:
 * - Salt: 16 bytes (128-bit) per RFC 9106 / OWASP
 * - Output hash: 32 bytes (256-bit) standard for password storage
 * - Variant: Argon2id (hybrid side-channel + GPU resistance)
 *
 * Note: Production uses blake3 pre-hash with pepper before scrypt.
 * This benchmark tests raw algorithm performance without pepper.
 *
 * Run with: deno run --allow-net --allow-read --allow-run scripts/password-hash-benchmark.ts
 */

import { scryptAsync } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { Buffer } from "node:buffer";

// ========================================
// CONFIGURATION
// ========================================

const TEST_PASSWORD = "MySecureP@ssword123!";
const TEST_SALT = randomBytes(16); // 16 bytes (128-bit) per RFC 9106 / OWASP recommendation
const ITERATIONS = 3; // Number of iterations per config for averaging (reduced to prevent OOM)
const WARMUP_ITERATIONS = 1; // Warmup runs to allow JIT optimization

// Current SCrypt config from the codebase
const SCRYPT_CONFIG = {
  N: 2 ** 17, // 131072
  r: 8,
  p: 1,
  dkLen: 64,
};

// RFC 9106 + OWASP recommended Argon2id configurations
// Output: 32 bytes (256-bit) — standard for password storage
const ARGON2_CONFIGS = [
  // RFC 9106 "first recommendation" fallback (when 2 GiB is too much)
  { name: "RFC9106 (64 MiB, t=3, p=4)", m: 65536, t: 3, p: 4, dkLen: 32 },
  { name: "RFC9106 (64 MiB, t=3, p=1)", m: 65536, t: 3, p: 1, dkLen: 32 },
  // OWASP tiered recommendations
  { name: "OWASP-1 (46 MiB, t=1, p=1)", m: 47104, t: 1, p: 1, dkLen: 32 },
  { name: "OWASP-2 (19 MiB, t=2, p=1)", m: 19456, t: 2, p: 1, dkLen: 32 },
  { name: "OWASP-3 (12 MiB, t=3, p=1)", m: 12288, t: 3, p: 1, dkLen: 32 },
];

// Higher t-value configs to test scaling and find if FFI overhead dominates
const ARGON2_SCALING_CONFIGS = [
  { name: "Scaling (8 MiB, t=1, p=1)", m: 8192, t: 1, p: 1, dkLen: 32 },
  { name: "Scaling (64 MiB, t=3, p=1)", m: 65536, t: 3, p: 1, dkLen: 32 },
  { name: "Scaling (64 MiB, t=10, p=1)", m: 65536, t: 10, p: 1, dkLen: 32 },
  { name: "Scaling (64 MiB, t=20, p=1)", m: 65536, t: 20, p: 1, dkLen: 32 },
  { name: "Scaling (128 MiB, t=3, p=1)", m: 131072, t: 3, p: 1, dkLen: 32 },
  { name: "Scaling (256 MiB, t=3, p=1)", m: 262144, t: 3, p: 1, dkLen: 32 },
];

// ========================================
// ARGON2 IMPLEMENTATIONS
// ========================================

// Dynamic imports for Argon2 implementations
let nobleArgon2id:
  | ((password: Uint8Array, salt: Uint8Array, opts: { t: number; m: number; p: number; dkLen: number }) => Uint8Array)
  | null = null;
// @felix/argon2 returns a PHC-formatted string, not a Uint8Array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let felixArgon2: any = null;

async function loadArgon2Implementations(): Promise<{ noble: boolean; felix: boolean }> {
  const result = { noble: false, felix: false };

  // Try to load @noble/hashes/argon2
  try {
    const nobleModule = await import("@noble/hashes/argon2.js");
    nobleArgon2id = nobleModule.argon2id;
    result.noble = true;
    console.log("✅ @noble/hashes/argon2 loaded successfully");
  } catch (error) {
    console.log("⚠️ @noble/hashes/argon2 not available:", (error as Error).message);
  }

  // Try to load @felix/argon2
  try {
    const felixModule = await import("jsr:@felix/argon2");
    felixArgon2 = felixModule;
    result.felix = true;
    console.log("✅ @felix/argon2 loaded successfully");
  } catch (error) {
    console.log("⚠️ @felix/argon2 not available:", (error as Error).message);
  }

  return result;
}

// ========================================
// BENCHMARK UTILITIES
// ========================================

interface BenchmarkResult {
  name: string;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  stdDevMs: number;
  memoryEstimateMB: number;
  totalOperations: number;
  operationsPerSecond: number;
  implementation: string;
}

function calculateStdDev(values: number[], mean: number): number {
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(
    squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length,
  );
}

// ========================================
// HASHING FUNCTIONS
// ========================================

async function hashWithScrypt(
  password: string,
  salt: Uint8Array,
  config: typeof SCRYPT_CONFIG,
): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  return scryptAsync(passwordBytes, salt, {
    N: config.N,
    r: config.r,
    p: config.p,
    dkLen: config.dkLen,
    maxmem: 128 * config.r * (config.N + config.p),
  });
}

async function hashWithNobleArgon2id(
  password: string,
  salt: Uint8Array,
  config: { m: number; t: number; p: number; dkLen: number },
): Promise<Uint8Array> {
  if (!nobleArgon2id) {
    throw new Error("@noble/hashes/argon2 not loaded");
  }
  const passwordBytes = new TextEncoder().encode(password);
  return nobleArgon2id(passwordBytes, salt, {
    t: config.t,
    m: config.m,
    p: config.p,
    dkLen: config.dkLen,
  });
}

async function hashWithFelixArgon2id(
  password: string,
  salt: Uint8Array,
  config: { m: number; t: number; p: number; dkLen: number },
): Promise<Uint8Array> {
  if (!felixArgon2) {
    throw new Error("@felix/argon2 not loaded");
  }
  // @felix/argon2 returns a PHC-formatted string, so we convert it to Uint8Array
  // for consistent comparison with other implementations
  const phcString = await felixArgon2.hash(password, salt, {
    memoryCost: config.m,
    timeCost: config.t,
    parallelism: config.p,
    outputLength: config.dkLen,
  });
  // Return the PHC string as bytes for consistent interface
  return new TextEncoder().encode(phcString);
}

// ========================================
// BENCHMARK RUNNERS
// ========================================

async function runBenchmark(
  name: string,
  hashFn: () => Promise<Uint8Array>,
  iterations: number,
  warmupIterations: number,
  estimatedMemoryMB: number,
  implementation: string,
): Promise<BenchmarkResult> {
  // Warmup phase
  console.log(`  Warming up (${warmupIterations} iterations)...`);
  for (let i = 0; i < warmupIterations; i++) {
    await hashFn();
  }

  // Benchmark phase
  console.log(`  Benchmarking (${iterations} iterations)...`);
  const times: number[] = [];
  let hashResult: Uint8Array | null = null;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    hashResult = await hashFn();
    const end = performance.now();
    times.push(end - start);
  }

  const avgTimeMs = times.reduce((sum, t) => sum + t, 0) / times.length;
  const minTimeMs = Math.min(...times);
  const maxTimeMs = Math.max(...times);
  const stdDevMs = calculateStdDev(times, avgTimeMs);
  const opsPerSecond = 1000 / avgTimeMs;

  return {
    name,
    avgTimeMs,
    minTimeMs,
    maxTimeMs,
    stdDevMs,
    memoryEstimateMB: estimatedMemoryMB,
    totalOperations: iterations,
    operationsPerSecond: opsPerSecond,
    implementation,
  };
}

async function benchmarkScrypt(): Promise<BenchmarkResult> {
  console.log("\n📊 Benchmarking SCrypt (current implementation)...");
  console.log(`  Config: N=${SCRYPT_CONFIG.N} (2^17), r=${SCRYPT_CONFIG.r}, p=${SCRYPT_CONFIG.p}, dkLen=${SCRYPT_CONFIG.dkLen}`);

  // Memory estimate for SCrypt: 128 * r * (N + p) bytes
  const memoryEstimate = (128 * SCRYPT_CONFIG.r * (SCRYPT_CONFIG.N + SCRYPT_CONFIG.p)) / (1024 * 1024);

  return runBenchmark(
    "SCrypt (2^17, r=8, p=1)",
    () => hashWithScrypt(TEST_PASSWORD, TEST_SALT, SCRYPT_CONFIG),
    ITERATIONS,
    WARMUP_ITERATIONS,
    memoryEstimate,
    "noble",
  );
}

async function benchmarkNobleArgon2Configs(): Promise<BenchmarkResult[]> {
  if (!nobleArgon2id) {
    console.log("\n⚠️ Skipping @noble/hashes/argon2 benchmarks (not available)");
    return [];
  }

  const results: BenchmarkResult[] = [];

  for (const config of ARGON2_CONFIGS) {
    console.log(`\n📊 Benchmarking ${config.name} (@noble/hashes)...`);
    console.log(`  Config: m=${config.m} (${Math.round(config.m / 1024)} MiB), t=${config.t}, p=${config.p}, dkLen=${config.dkLen}`);

    const result = await runBenchmark(
      config.name,
      () => hashWithNobleArgon2id(TEST_PASSWORD, TEST_SALT, config),
      ITERATIONS,
      WARMUP_ITERATIONS,
      config.m / 1024, // Convert KiB to MiB
      "noble",
    );

    results.push(result);
  }

  return results;
}

async function benchmarkFelixArgon2Configs(): Promise<BenchmarkResult[]> {
  if (!felixArgon2) {
    console.log("\n⚠️ Skipping @felix/argon2 benchmarks (not available)");
    return [];
  }

  const results: BenchmarkResult[] = [];

  for (const config of ARGON2_CONFIGS) {
    console.log(`\n📊 Benchmarking ${config.name} (@felix/argon2)...`);
    console.log(`  Config: m=${config.m} (${Math.round(config.m / 1024)} MiB), t=${config.t}, p=${config.p}, dkLen=${config.dkLen}`);

    const result = await runBenchmark(
      `${config.name} (felix)`,
      () => hashWithFelixArgon2id(TEST_PASSWORD, TEST_SALT, config),
      ITERATIONS,
      WARMUP_ITERATIONS,
      config.m / 1024, // Convert KiB to MiB
      "felix",
    );

    results.push(result);
  }

  return results;
}

// ========================================
// VERIFICATION
// ========================================

async function verifyHashingFunctions(): Promise<void> {
  console.log("\n🔍 Verifying hashing functions...");

  // Verify SCrypt
  const scryptHash1 = await hashWithScrypt(TEST_PASSWORD, TEST_SALT, SCRYPT_CONFIG);
  const scryptHash2 = await hashWithScrypt(TEST_PASSWORD, TEST_SALT, SCRYPT_CONFIG);
  const scryptMatch = Buffer.from(scryptHash1).equals(scryptHash2);
  console.log(`  SCrypt deterministic: ${scryptMatch ? "✅ PASS" : "❌ FAIL"}`);

  // Verify Argon2id implementations
  if (nobleArgon2id) {
    const config = ARGON2_CONFIGS[2]; // Use middle config for verification
    const hash1 = await hashWithNobleArgon2id(TEST_PASSWORD, TEST_SALT, config);
    const hash2 = await hashWithNobleArgon2id(TEST_PASSWORD, TEST_SALT, config);
    const match = Buffer.from(hash1).equals(hash2);
    console.log(`  @noble/hashes/argon2id deterministic: ${match ? "✅ PASS" : "❌ FAIL"}`);
  }

  if (felixArgon2) {
    // Test that verify() works correctly
    const felixHash = await felixArgon2.hash(TEST_PASSWORD);
    const felixVerifyCorrect = await felixArgon2.verify(felixHash, TEST_PASSWORD);
    const felixVerifyWrong = await felixArgon2.verify(felixHash, "WrongPassword!");
    console.log(`  @felix/argon2id hash+verify: ${felixVerifyCorrect && !felixVerifyWrong ? "✅ PASS" : "❌ FAIL"}`);
  }

  // Verify different salts produce different hashes
  const differentSalt = randomBytes(32);
  const scryptDiffSalt = await hashWithScrypt(TEST_PASSWORD, differentSalt, SCRYPT_CONFIG);
  const scryptDifferent = !Buffer.from(scryptHash1).equals(scryptDiffSalt);
  console.log(`  SCrypt salt sensitivity: ${scryptDifferent ? "✅ PASS" : "❌ FAIL"}`);

  // Cross-implementation verification skipped - @felix/argon2 uses internal random salt
  // and produces PHC formatted strings, while @noble/hashes returns raw bytes
}

// ========================================
// RESULTS DISPLAY
// ========================================

function displayResults(
  scryptResult: BenchmarkResult,
  nobleResults: BenchmarkResult[],
  felixResults: BenchmarkResult[],
): void {
  console.log("\n");
  console.log("═".repeat(100));
  console.log("                                    BENCHMARK RESULTS");
  console.log("═".repeat(100));
  console.log("\n");

  // Header
  console.log(
    "Algorithm".padEnd(35) +
      "Avg (ms)".padStart(12) +
      "Min (ms)".padStart(12) +
      "Max (ms)".padStart(12) +
      "StdDev".padStart(10) +
      "Est. RAM".padStart(12) +
      "Impl".padStart(8),
  );
  console.log("─".repeat(100));

  // SCrypt result
  console.log(
    scryptResult.name.padEnd(35) +
      scryptResult.avgTimeMs.toFixed(2).padStart(12) +
      scryptResult.minTimeMs.toFixed(2).padStart(12) +
      scryptResult.maxTimeMs.toFixed(2).padStart(12) +
      scryptResult.stdDevMs.toFixed(2).padStart(10) +
      `${scryptResult.memoryEstimateMB.toFixed(0)} MB`.padStart(12) +
      scryptResult.implementation.padStart(8),
  );

  console.log("─".repeat(100));

  // Noble Argon2 results
  if (nobleResults.length > 0) {
    console.log(">>> @noble/hashes/argon2 <<<");
    for (const result of nobleResults) {
      console.log(
        result.name.padEnd(35) +
          result.avgTimeMs.toFixed(2).padStart(12) +
          result.minTimeMs.toFixed(2).padStart(12) +
          result.maxTimeMs.toFixed(2).padStart(12) +
          result.stdDevMs.toFixed(2).padStart(10) +
          `${result.memoryEstimateMB.toFixed(0)} MB`.padStart(12) +
          result.implementation.padStart(8),
      );
    }
  }

  console.log("─".repeat(100));

  // Felix Argon2 results
  if (felixResults.length > 0) {
    console.log(">>> @felix/argon2 (native) <<<");
    for (const result of felixResults) {
      console.log(
        result.name.padEnd(35) +
          result.avgTimeMs.toFixed(2).padStart(12) +
          result.minTimeMs.toFixed(2).padStart(12) +
          result.maxTimeMs.toFixed(2).padStart(12) +
          result.stdDevMs.toFixed(2).padStart(10) +
          `${result.memoryEstimateMB.toFixed(0)} MB`.padStart(12) +
          result.implementation.padStart(8),
      );
    }
  }

  console.log("═".repeat(100));

  // Comparison table
  console.log("\n");
  console.log("═".repeat(100));
  console.log("                            COMPARISON vs SCrypt (Current)");
  console.log("═".repeat(100));
  console.log("\n");

  console.log(
    "Algorithm".padEnd(35) +
      "Speed Diff".padStart(15) +
      "Ops/sec".padStart(15) +
      "Memory Diff".padStart(15) +
      "Verdict".padStart(15),
  );
  console.log("─".repeat(100));

  const allArgonResults = [...nobleResults, ...felixResults];

  for (const result of allArgonResults) {
    const speedRatio = scryptResult.avgTimeMs / result.avgTimeMs;
    const memoryRatio = result.memoryEstimateMB / scryptResult.memoryEstimateMB;

    let speedDiff: string;
    let verdict: string;

    if (speedRatio > 1.1) {
      speedDiff = `↑ ${speedRatio.toFixed(2)}x faster`;
      verdict = "✅ Better";
    } else if (speedRatio < 0.9) {
      speedDiff = `↓ ${(1 / speedRatio).toFixed(2)}x slower`;
      verdict = "⚠️ Slower";
    } else {
      speedDiff = "~ Same";
      verdict = "≈ Similar";
    }

    let memDiff: string;
    if (memoryRatio < 0.5) {
      memDiff = `↓ ${memoryRatio.toFixed(2)}x less`;
    } else if (memoryRatio > 2) {
      memDiff = `↑ ${memoryRatio.toFixed(2)}x more`;
    } else {
      memDiff = "~ Similar";
    }

    const displayName = result.implementation === "felix" ? `${result.name} [F]` : result.name;

    console.log(
      displayName.padEnd(35) +
        speedDiff.padStart(15) +
        result.operationsPerSecond.toFixed(2).padStart(15) +
        memDiff.padStart(15) +
        verdict.padStart(15),
    );
  }

  console.log("═".repeat(100));

  // Implementation comparison (if both available)
  if (nobleResults.length > 0 && felixResults.length > 0) {
    console.log("\n");
    console.log("═".repeat(100));
    console.log("                    Implementation Comparison: Noble vs Felix");
    console.log("═".repeat(100));
    console.log("\n");

    console.log(
      "Config".padEnd(35) +
        "Noble (ms)".padStart(15) +
        "Felix (ms)".padStart(15) +
        "Speedup".padStart(15),
    );
    console.log("─".repeat(100));

    for (let i = 0; i < ARGON2_CONFIGS.length; i++) {
      const noble = nobleResults[i];
      const felix = felixResults[i];
      const speedup = noble.avgTimeMs / felix.avgTimeMs;

      console.log(
        ARGON2_CONFIGS[i].name.padEnd(35) +
          noble.avgTimeMs.toFixed(2).padStart(15) +
          felix.avgTimeMs.toFixed(2).padStart(15) +
          `${speedup.toFixed(2)}x`.padStart(15),
      );
    }

    console.log("═".repeat(100));
  }

  // Summary
  displaySummary(scryptResult, nobleResults, felixResults);
}

function displaySummary(
  scryptResult: BenchmarkResult,
  nobleResults: BenchmarkResult[],
  felixResults: BenchmarkResult[],
): void {
  console.log("\n");
  console.log("═".repeat(100));
  console.log("                                         SUMMARY");
  console.log("═".repeat(100));
  console.log("\n");

  console.log(`Current SCrypt implementation:`);
  console.log(`  - Average time: ${scryptResult.avgTimeMs.toFixed(2)} ms`);
  console.log(`  - Estimated memory: ${scryptResult.memoryEstimateMB.toFixed(0)} MB`);
  console.log(`  - Operations/second: ${scryptResult.operationsPerSecond.toFixed(2)}`);
  console.log("\n");

  // Find fastest overall
  const allArgonResults = [...nobleResults, ...felixResults];

  if (allArgonResults.length > 0) {
    const fastestArgon2 = allArgonResults.reduce((fastest, current) => current.avgTimeMs < fastest.avgTimeMs ? current : fastest);

    // Find most memory-efficient Argon2 config
    const mostMemoryEfficient = allArgonResults.reduce((most, current) =>
      current.memoryEstimateMB < most.memoryEstimateMB ? current : most
    );

    // Find best balanced config - RFC 9106 (64 MiB, t=3, p=1) or OWASP-1
    const balancedNoble = nobleResults.find((r) => r.name.includes("RFC9106") && r.name.includes("p=1")) ||
      nobleResults.find((r) => r.name.includes("OWASP-1"));
    const balancedFelix = felixResults.find((r) => r.name.includes("RFC9106") && r.name.includes("p=1")) ||
      felixResults.find((r) => r.name.includes("OWASP-1"));

    console.log(`Fastest Argon2id config: ${fastestArgon2.name} (${fastestArgon2.implementation})`);
    console.log(`  - Average time: ${fastestArgon2.avgTimeMs.toFixed(2)} ms`);
    console.log(`  - Speed vs SCrypt: ${(scryptResult.avgTimeMs / fastestArgon2.avgTimeMs).toFixed(2)}x`);
    console.log("\n");

    console.log(`Most memory-efficient Argon2id: ${mostMemoryEfficient.name}`);
    console.log(`  - Memory usage: ${mostMemoryEfficient.memoryEstimateMB.toFixed(0)} MB`);
    console.log(`  - Memory vs SCrypt: ${(mostMemoryEfficient.memoryEstimateMB / scryptResult.memoryEstimateMB * 100).toFixed(1)}%`);
    console.log("\n");

    // Recommendation
    console.log("─".repeat(100));
    console.log("RECOMMENDATION:");
    console.log("─".repeat(100));

    const bestOption = felixResults.length > 0 ? balancedFelix || felixResults[2] : balancedNoble || nobleResults[2];

    if (bestOption && bestOption.avgTimeMs < scryptResult.avgTimeMs * 1.5) {
      console.log(`
Based on these benchmarks, migrating to Argon2id could be beneficial:

1. SECURITY: Argon2id is the winner of the 2015 Password Hashing Competition
   and provides better resistance against GPU-based attacks.

2. MEMORY USAGE: Argon2id configs use significantly less memory than SCrypt
   (${bestOption.memoryEstimateMB.toFixed(0)} MB vs ${scryptResult.memoryEstimateMB.toFixed(0)} MB).

3. PERFORMANCE: ${bestOption.name} offers ${bestOption.avgTimeMs < scryptResult.avgTimeMs ? "better" : "comparable"} performance
   (${bestOption.avgTimeMs.toFixed(2)} ms vs ${scryptResult.avgTimeMs.toFixed(2)} ms).

4. FLEXIBILITY: Argon2id allows tuning memory/CPU trade-offs with the
   recommended configurations all providing equal security levels.

${
        felixResults.length > 0
          ? `
IMPLEMENTATION: @felix/argon2 is faster due to native bindings.
   However, @noble/hashes/argon2 is pure JavaScript and more portable.
`
          : `
IMPLEMENTATION: @noble/hashes/argon2 is a pure JavaScript implementation.
   Consider @felix/argon2 for better performance if native bindings are acceptable.
`
      }

Suggested migration config: ${bestOption.name}
  - m=${bestOption.memoryEstimateMB * 1024} (memory in KiB)
  - t=${ARGON2_CONFIGS.find((c) => bestOption.name.includes(c.name.split(" (")[0]))?.t || 3} (iterations)
  - p=1 (parallelism)
`);
    } else {
      console.log(`
Based on these benchmarks, the current SCrypt implementation performs well.

However, Argon2id still offers security advantages:
1. Winner of 2015 Password Hashing Competition
2. Better resistance against side-channel and GPU attacks
3. More configurable memory/CPU trade-offs
4. Significantly lower memory usage

Consider Argon2id if:
- Memory usage is a concern (Argon2id uses less)
- You want the latest recommended algorithm
- Regulatory compliance requires Argon2
`);
    }
  } else {
    console.log(`
No Argon2 implementations were available for benchmarking.

To install:
  - @noble/hashes/argon2: Already included in @noble/hashes package
  - @felix/argon2: deno add jsr:@felix/argon2
`);
  }

  console.log("═".repeat(100));
}

// ========================================
// CONCURRENT LOAD TEST
// ========================================

async function runConcurrencyTest(): Promise<void> {
  console.log("\n");
  console.log("═".repeat(100));
  console.log("                              CONCURRENT LOAD TEST");
  console.log("═".repeat(100));
  console.log("\n");

  const concurrencyLevels = [1, 5, 10, 20];
  const testPassword = "ConcurrentTestP@ss!";
  const testSalt = randomBytes(32);

  console.log(
    "Algorithm".padEnd(35) +
      "Concurrency".padStart(12) +
      "Total (ms)".padStart(12) +
      "Avg (ms)".padStart(12) +
      "Throughput".padStart(15),
  );
  console.log("─".repeat(100));

  // Test SCrypt
  for (const concurrency of concurrencyLevels) {
    const start = performance.now();
    const promises = Array(concurrency).fill(null).map(() => hashWithScrypt(testPassword, testSalt, SCRYPT_CONFIG));
    await Promise.all(promises);
    const total = performance.now() - start;
    const avg = total / concurrency;
    const throughput = (concurrency / total) * 1000;

    console.log(
      "SCrypt".padEnd(35) +
        concurrency.toString().padStart(12) +
        total.toFixed(2).padStart(12) +
        avg.toFixed(2).padStart(12) +
        `${throughput.toFixed(2)} op/s`.padStart(15),
    );
  }

  console.log("─".repeat(100));

  // Test best Argon2id config (RFC9106 64 MiB, t=3, p=1) with Noble
  if (nobleArgon2id) {
    const argon2Config = ARGON2_CONFIGS[1]; // RFC9106 (64 MiB, t=3, p=1)
    for (const concurrency of concurrencyLevels) {
      const start = performance.now();
      const promises = Array(concurrency).fill(null).map(() => hashWithNobleArgon2id(testPassword, testSalt, argon2Config));
      await Promise.all(promises);
      const total = performance.now() - start;
      const avg = total / concurrency;
      const throughput = (concurrency / total) * 1000;

      console.log(
        `${argon2Config.name} (noble)`.padEnd(35) +
          concurrency.toString().padStart(12) +
          total.toFixed(2).padStart(12) +
          avg.toFixed(2).padStart(12) +
          `${throughput.toFixed(2)} op/s`.padStart(15),
      );
    }
    console.log("─".repeat(100));
  }

  // Test best Argon2id config (RFC9106 64 MiB, t=3, p=1) with Felix
  if (felixArgon2) {
    const argon2Config = ARGON2_CONFIGS[1]; // RFC9106 (64 MiB, t=3, p=1)
    for (const concurrency of concurrencyLevels) {
      const start = performance.now();
      const promises = Array(concurrency).fill(null).map(() => hashWithFelixArgon2id(testPassword, testSalt, argon2Config));
      await Promise.all(promises);
      const total = performance.now() - start;
      const avg = total / concurrency;
      const throughput = (concurrency / total) * 1000;

      console.log(
        `${argon2Config.name} (felix)`.padEnd(35) +
          concurrency.toString().padStart(12) +
          total.toFixed(2).padStart(12) +
          avg.toFixed(2).padStart(12) +
          `${throughput.toFixed(2)} op/s`.padStart(15),
      );
    }
  }

  console.log("═".repeat(100));
}

// ========================================
// PHC STRING VALIDATION
// ========================================

async function runPHCValidation(): Promise<void> {
  if (!felixArgon2) return;

  console.log("\n");
  console.log("═".repeat(100));
  console.log("                         PHC STRING PARAMETER VALIDATION");
  console.log("═".repeat(100));
  console.log("\n");
  console.log("Verifying @felix/argon2 encodes requested parameters into the PHC output string.");
  console.log("This confirms the library is actually applying the config, not using defaults.\n");

  for (const config of ARGON2_CONFIGS) {
    const phcString = await felixArgon2.hash(TEST_PASSWORD, {
      memoryCost: config.m,
      timeCost: config.t,
      parallelism: config.p,
      hashLength: config.dkLen,
    });

    // PHC format: $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
    const expectedParams = `m=${config.m},t=${config.t},p=${config.p}`;
    const containsParams = phcString.includes(expectedParams);
    const containsArgon2id = phcString.startsWith("$argon2id$");

    console.log(`  ${config.name}:`);
    console.log(`    PHC: ${phcString.substring(0, 60)}...`);
    console.log(`    Contains $argon2id$: ${containsArgon2id ? "✅" : "❌"}`);
    console.log(`    Contains ${expectedParams}: ${containsParams ? "✅" : "❌"}`);
    if (!containsParams) {
      console.log(`    ⚠️ WARNING: Parameters may not be applied! Full string: ${phcString}`);
    }
    console.log("");
  }

  console.log("═".repeat(100));
}

// ========================================
// SCALING VALIDATION (FFI overhead check)
// ========================================

async function runScalingTest(): Promise<void> {
  if (!felixArgon2) return;

  console.log("\n");
  console.log("═".repeat(100));
  console.log("                    SCALING VALIDATION (@felix/argon2 native)");
  console.log("═".repeat(100));
  console.log("\n");
  console.log("Testing with extreme parameter differences to verify timing scales with work.");
  console.log("If all times are ~equal, FFI overhead is dominating the measurement.\n");

  console.log(
    "Config".padEnd(40) +
      "Avg (ms)".padStart(12) +
      "m*t (work)".padStart(15) +
      "Scales?".padStart(10),
  );
  console.log("─".repeat(80));

  const results: { name: string; avgMs: number; work: number }[] = [];

  for (const config of ARGON2_SCALING_CONFIGS) {
    const times: number[] = [];
    // Warmup
    await felixArgon2.hash(TEST_PASSWORD, {
      memoryCost: config.m,
      timeCost: config.t,
      parallelism: config.p,
      hashLength: config.dkLen,
    });

    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await felixArgon2.hash(TEST_PASSWORD, {
        memoryCost: config.m,
        timeCost: config.t,
        parallelism: config.p,
        hashLength: config.dkLen,
      });
      times.push(performance.now() - start);
    }

    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const work = config.m * config.t;
    results.push({ name: config.name, avgMs: avg, work });

    console.log(
      config.name.padEnd(40) +
        avg.toFixed(2).padStart(12) +
        work.toString().padStart(15) +
        (results.length > 1 ? (avg > results[0].avgMs * 1.3 ? "  ✅ Yes" : "  ⚠️ Flat") : "  (baseline)"),
    );
  }

  // Summary
  const minWork = results.reduce((m, r) => r.work < m.work ? r : m);
  const maxWork = results.reduce((m, r) => r.work > m.work ? r : m);
  const workRatio = maxWork.work / minWork.work;
  const timeRatio = maxWork.avgMs / minWork.avgMs;

  console.log("\n");
  console.log(`  Work ratio (max/min): ${workRatio.toFixed(1)}x`);
  console.log(`  Time ratio (max/min): ${timeRatio.toFixed(1)}x`);

  if (timeRatio < workRatio * 0.3) {
    console.log(`  ⚠️ Time scaling is much less than work scaling.`);
    console.log(`     FFI overhead likely dominates for smaller configs.`);
    console.log(`     The higher configs ARE doing more work — look at absolute times.`);
  } else {
    console.log(`  ✅ Timing scales proportionally with work. Parameters are effective.`);
  }

  console.log("\n" + "═".repeat(100));
}

// ========================================
// VERIFY() BENCHMARK
// ========================================

async function runVerifyBenchmark(): Promise<void> {
  if (!felixArgon2) return;

  console.log("\n");
  console.log("═".repeat(100));
  console.log("                      VERIFY BENCHMARK (@felix/argon2 native)");
  console.log("═".repeat(100));
  console.log("\n");
  console.log("In production, verify() is called on every login. Benchmarking both hash and verify.\n");

  const config = ARGON2_CONFIGS[1]; // RFC9106 (64 MiB, t=3, p=1)

  console.log(
    "Operation".padEnd(25) +
      "Avg (ms)".padStart(12) +
      "Min (ms)".padStart(12) +
      "Max (ms)".padStart(12),
  );
  console.log("─".repeat(65));

  // Hash benchmark
  const hashTimes: number[] = [];
  let lastHash = "";
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    lastHash = await felixArgon2.hash(TEST_PASSWORD, {
      memoryCost: config.m,
      timeCost: config.t,
      parallelism: config.p,
      hashLength: config.dkLen,
    });
    hashTimes.push(performance.now() - start);
  }

  const hashAvg = hashTimes.reduce((s, t) => s + t, 0) / hashTimes.length;
  console.log(
    `hash() [${config.name}]`.padEnd(25) +
      hashAvg.toFixed(2).padStart(12) +
      Math.min(...hashTimes).toFixed(2).padStart(12) +
      Math.max(...hashTimes).toFixed(2).padStart(12),
  );

  // Verify benchmark
  const verifyTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await felixArgon2.verify(lastHash, TEST_PASSWORD);
    verifyTimes.push(performance.now() - start);
  }

  const verifyAvg = verifyTimes.reduce((s, t) => s + t, 0) / verifyTimes.length;
  console.log(
    "verify()".padEnd(25) +
      verifyAvg.toFixed(2).padStart(12) +
      Math.min(...verifyTimes).toFixed(2).padStart(12) +
      Math.max(...verifyTimes).toFixed(2).padStart(12),
  );

  // Wrong password verify (should take same time - constant-time)
  const wrongTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await felixArgon2.verify(lastHash, "WrongPassword123!");
    wrongTimes.push(performance.now() - start);
  }

  const wrongAvg = wrongTimes.reduce((s, t) => s + t, 0) / wrongTimes.length;
  console.log(
    "verify() (wrong pw)".padEnd(25) +
      wrongAvg.toFixed(2).padStart(12) +
      Math.min(...wrongTimes).toFixed(2).padStart(12) +
      Math.max(...wrongTimes).toFixed(2).padStart(12),
  );

  console.log("\n");
  const timingDiff = Math.abs(verifyAvg - wrongAvg);
  console.log(`  Correct vs wrong password timing difference: ${timingDiff.toFixed(2)} ms`);
  console.log(`  ${timingDiff < verifyAvg * 0.2 ? "✅ Constant-time (good)" : "⚠️ Timing variance detected"}`);

  console.log("\n" + "═".repeat(100));
}

// ========================================
// MAIN
// ========================================

async function main(): Promise<void> {
  console.log("═".repeat(100));
  console.log("              PASSWORD HASHING BENCHMARK: SCrypt vs Argon2id");
  console.log("═".repeat(100));
  console.log(`\nTest password: "${TEST_PASSWORD}"`);
  console.log(`Iterations per config: ${ITERATIONS}`);
  console.log(`Warmup iterations: ${WARMUP_ITERATIONS}`);
  console.log("\n");

  // Load Argon2 implementations
  console.log("Loading Argon2 implementations...");
  const implementations = await loadArgon2Implementations();
  console.log("");

  // Verify hashing functions work correctly
  await verifyHashingFunctions();

  // Run benchmarks
  const scryptResult = await benchmarkScrypt();
  const nobleResults = implementations.noble ? await benchmarkNobleArgon2Configs() : [];
  const felixResults = implementations.felix ? await benchmarkFelixArgon2Configs() : [];

  // Display results
  displayResults(scryptResult, nobleResults, felixResults);

  // Run concurrency test
  await runConcurrencyTest();

  // Run PHC string validation and scaling tests (felix only)
  if (implementations.felix) {
    await runPHCValidation();
    await runScalingTest();
    await runVerifyBenchmark();
  }

  console.log("\n✅ Benchmark complete!\n");
}

// Run the benchmark
main().catch((error) => {
  console.error("Benchmark failed:", error);
  Deno.exit(1);
});
