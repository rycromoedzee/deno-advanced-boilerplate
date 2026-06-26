/**
 * Argon2id Parameter Tuning Benchmark (@felix/argon2)
 *
 * Tests memory, time, and lanes configurations to help select
 * the right parameters for your hardware target (~130–250ms per hash).
 *
 * Usage: deno run --allow-all scripts/argon2-tune.ts
 */
import { hash, Variant, verify, Version } from "jsr:@felix/argon2";

const PASSWORD = "MySecureP@ssword123!";
const SALT = crypto.getRandomValues(new Uint8Array(16));
const ITERS = 3;

interface Config {
  label: string;
  memoryCost: number; // KiB
  timeCost: number;
  lanes: number;
  hashLength: number;
}

const configs: Config[] = [
  // ── Memory sweep (t=3, lanes=1) ──────────────────────────────────
  { label: "32 MiB  t=3 l=1", memoryCost: 32768, timeCost: 3, lanes: 1, hashLength: 32 },
  { label: "64 MiB  t=3 l=1", memoryCost: 65536, timeCost: 3, lanes: 1, hashLength: 32 },
  { label: "96 MiB  t=3 l=1", memoryCost: 98304, timeCost: 3, lanes: 1, hashLength: 32 },
  { label: "128 MiB t=3 l=1", memoryCost: 131072, timeCost: 3, lanes: 1, hashLength: 32 },
  // ── Time sweep (m=96 MiB, lanes=1) ──────────────────────────────
  { label: "96 MiB  t=1 l=1", memoryCost: 98304, timeCost: 1, lanes: 1, hashLength: 32 },
  { label: "96 MiB  t=2 l=1", memoryCost: 98304, timeCost: 2, lanes: 1, hashLength: 32 },
  { label: "96 MiB  t=5 l=1", memoryCost: 98304, timeCost: 5, lanes: 1, hashLength: 32 },
  // ── Lanes sweep (m=64 MiB, t=3) ─────────────────────────────────
  { label: "64 MiB  t=3 l=2", memoryCost: 65536, timeCost: 3, lanes: 2, hashLength: 32 },
  { label: "64 MiB  t=3 l=4", memoryCost: 65536, timeCost: 3, lanes: 4, hashLength: 32 },
  { label: "64 MiB  t=3 l=8", memoryCost: 65536, timeCost: 3, lanes: 8, hashLength: 32 },
];

async function bench(cfg: Config): Promise<{ avg: number; min: number; max: number }> {
  // warmup
  await hash(PASSWORD, {
    salt: SALT,
    variant: Variant.Argon2id,
    version: Version.V13,
    memoryCost: cfg.memoryCost,
    timeCost: cfg.timeCost,
    lanes: cfg.lanes,
    hashLength: cfg.hashLength,
  });

  const times: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    await hash(PASSWORD, {
      salt: SALT,
      variant: Variant.Argon2id,
      version: Version.V13,
      memoryCost: cfg.memoryCost,
      timeCost: cfg.timeCost,
      lanes: cfg.lanes,
      hashLength: cfg.hashLength,
    });
    times.push(performance.now() - t0);
  }

  const avg = times.reduce((a, b) => a + b, 0) / ITERS;
  return { avg, min: Math.min(...times), max: Math.max(...times) };
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log("═".repeat(80));
console.log("  Argon2id Parameter Tuning (@felix/argon2 native)");
console.log("═".repeat(80));
console.log(`  Password: "${PASSWORD}"   Iters: ${ITERS}  (1 warmup)\n`);

const colLabel = 20;
const colNum = 10;

const header = [
  "Config".padEnd(colLabel),
  "Avg (ms)".padStart(colNum),
  "Min (ms)".padStart(colNum),
  "Max (ms)".padStart(colNum),
  "Est RAM".padStart(colNum),
].join("  ");
console.log(header);
console.log("─".repeat(header.length));

for (const cfg of configs) {
  process.stdout.write(`  Benchmarking ${cfg.label}…`);
  const r = await bench(cfg);
  process.stdout.write("\r");
  const ramMB = (cfg.memoryCost / 1024).toFixed(0) + " MB";
  console.log([
    cfg.label.padEnd(colLabel),
    r.avg.toFixed(1).padStart(colNum),
    r.min.toFixed(1).padStart(colNum),
    r.max.toFixed(1).padStart(colNum),
    ramMB.padStart(colNum),
  ].join("  "));
}

console.log("\n" + "═".repeat(80));
console.log("  verify() constant-time check  (96 MiB, t=3, l=1)");
console.log("─".repeat(80));

const phc = await hash(PASSWORD, {
  salt: SALT,
  variant: Variant.Argon2id,
  version: Version.V13,
  memoryCost: 98304,
  timeCost: 3,
  lanes: 1,
  hashLength: 32,
});

const t0 = performance.now();
const correctResult = await verify(phc, PASSWORD);
const correctMs = (performance.now() - t0).toFixed(1);

const t1 = performance.now();
const wrongResult = await verify(phc, "WrongPassword!");
const wrongMs = (performance.now() - t1).toFixed(1);

console.log(`  Correct password: ${correctMs} ms  (valid=${correctResult})`);
console.log(`  Wrong   password: ${wrongMs} ms  (valid=${wrongResult})`);
const diff = Math.abs(parseFloat(correctMs) - parseFloat(wrongMs));
console.log(`  Timing diff: ${diff.toFixed(1)} ms  ${diff < 10 ? "✅ constant-time" : "⚠️  difference > 10ms"}`);
console.log("═".repeat(80));
