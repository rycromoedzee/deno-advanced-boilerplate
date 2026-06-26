# `jobs/` — scheduled job definitions

This directory holds **scheduled (cron-driven) job definitions** and the scheduler that runs them. It is intentionally separate from
[`services/background-jobs/`](../services/background-jobs/), which is the on-demand task-execution engine. See the file-structure skill note
for the full rationale.

## Layout

- `*.job.ts` — one scheduled job each (`refresh-token-cleanup`, `trace-cleanup`, `threat-intelligence-*`, `db-backup`,
  `notifications-cleanup`, `upload-session-cleanup`). Each exports its run function + cron schedule metadata.
- `registry.ts` — single source of truth; lists every job and its cron expression. Consumed by all execution modes.
- `services/scheduler.ts` — decides _when_ a job is due (worker mode via `Deno.cron`, or event-driven inline mode for scale-to-zero
  environments) and dispatches it.
- `services/job-state.service.ts` — persists last-run timestamps.
- `services/job-lock.service.ts` — guards against double-execution.
- `runners/` — process entry points: `worker.ts` (persistent server), `standalone.ts` (standalone runner), wired via `runners/index.ts`.
- `job-helpers.ts` — shared helpers used across job files.
- `types/` — shared worker-message types.

## How jobs run

Jobs are **periodic and time-based.** The scheduler reads `registry.ts`, checks each job's cron expression against the clock (worker mode)
or the current request time (inline mode), and fires the job's run function. For on-demand, event-driven async work (enqueue/cancel/status
of a discrete task), use `services/background-jobs/` instead.
