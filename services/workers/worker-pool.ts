/**
 * @file services/workers/worker-pool.ts
 * @description Generalized worker pool base class for offloading CPU-intensive work
 * to dedicated worker threads, keeping the main event loop responsive.
 *
 * Usage: Extend this class and provide a worker script URL. The pool manages
 * worker lifecycle, task queuing, and result dispatch via transferable objects
 * (zero-copy ArrayBuffer transfers).
 *
 * @example
 * ```typescript
 * class MyPool extends WorkerPool<{ value: number }, { result: number }> {
 *   constructor(size: number) {
 *     super(new URL("./my-worker.ts", import.meta.url).href, size);
 *   }
 *   async process(input: { value: number }): Promise<{ result: number }> {
 *     return this.dispatch({ value: input.value }, []);
 *   }
 * }
 * ```
 */

export interface WorkerTask<TInput, TOutput> {
  id: number;
  input: TInput;
  transferables: Transferable[];
  resolve: (output: TOutput) => void;
  reject: (error: Error) => void;
}

export interface WorkerMessage<TInput> {
  id: number;
  input: TInput;
}

export interface WorkerResult<TOutput> {
  id: number;
  success: boolean;
  output?: TOutput;
  error?: string;
}

/**
 * Control message a worker posts to the pool once its module has finished
 * loading and its `onmessage` handler is installed. This avoids the Deno
 * race where messages posted to a not-yet-initialized worker are dropped.
 */
export interface WorkerReadyMessage {
  ready: true;
}

interface PoolWorkerEntry<TInput, TOutput> {
  worker: Worker;
  busy: boolean;
  /**
   * Whether the worker has signalled readiness. Tasks dispatched before this
   * is true are held in `pendingBeforeReady` and flushed once the worker is
   * ready, so no message is lost during worker startup.
   */
  ready: boolean;
  pending: Map<number, WorkerTask<TInput, TOutput>>;
  /** Tasks assigned to this worker before it signalled readiness. */
  pendingBeforeReady: WorkerTask<TInput, TOutput>[];
}

/**
 * Generalized worker pool that manages a fixed set of Deno Workers.
 * Tasks are queued when all workers are busy and dispatched FIFO.
 *
 * @typeParam TInput  - Message type sent TO the worker
 * @typeParam TOutput - Message type received FROM the worker (success case)
 */
export abstract class WorkerPool<TInput, TOutput> {
  private readonly entries: PoolWorkerEntry<TInput, TOutput>[] = [];
  private readonly queue: WorkerTask<TInput, TOutput>[] = [];
  private nextId = 0;
  private terminated = false;

  /**
   * @param workerUrl  - Absolute URL of the worker module (use `new URL(..., import.meta.url).href`)
   * @param poolSize   - Number of worker threads to spawn (default 1)
   */
  constructor(workerUrl: string, poolSize = 1) {
    const size = Math.max(1, poolSize);
    for (let i = 0; i < size; i++) {
      const entry: PoolWorkerEntry<TInput, TOutput> = {
        worker: new Worker(workerUrl, { type: "module" }),
        busy: false,
        ready: false,
        pending: new Map(),
        pendingBeforeReady: [],
      };

      entry.worker.onmessage = (
        event: MessageEvent<WorkerResult<TOutput> | WorkerReadyMessage>,
      ) => {
        const data = event.data;

        // Readiness handshake: flush any tasks that were dispatched to this
        // worker before it finished loading. Without this, Deno silently drops
        // messages posted before the worker installed its onmessage handler,
        // leaving the corresponding promises pending forever.
        if ((data as WorkerReadyMessage).ready === true) {
          entry.ready = true;
          const buffered = entry.pendingBeforeReady;
          entry.pendingBeforeReady = [];
          for (const task of buffered) {
            this.post(entry, task);
          }
          return;
        }

        const { id, success, output, error } = data as WorkerResult<TOutput>;
        const task = entry.pending.get(id);
        if (!task) return;

        entry.pending.delete(id);
        entry.busy = false;

        if (success && output !== undefined) {
          task.resolve(output);
        } else {
          task.reject(new Error(error ?? "Worker task failed with no error message"));
        }

        // Dispatch next queued task to this now-free worker
        this.drainQueue(entry);
      };

      entry.worker.onerror = (event: ErrorEvent) => {
        // Surface worker load/runtime errors that would otherwise be silent and
        // leave task promises pending forever.
        console.error("[worker-pool] worker.onerror:", {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error instanceof Error ? event.error.stack : String(event.error),
        });
        // Reject all pending tasks on this worker (both in-flight and buffered).
        for (const task of entry.pending.values()) {
          task.reject(new Error(`Worker error: ${event.message}`));
        }
        entry.pending.clear();
        for (const task of entry.pendingBeforeReady) {
          task.reject(new Error(`Worker error: ${event.message}`));
        }
        entry.pendingBeforeReady = [];
        entry.busy = false;
        this.drainQueue(entry);
      };

      this.entries.push(entry);
    }
  }

  /**
   * Dispatch a task to a free worker or enqueue it if all are busy.
   * The returned Promise resolves/rejects when the worker completes the task.
   *
   * @param input        - Payload to send to the worker
   * @param transferables - ArrayBuffers to transfer (zero-copy); their ownership
   *                        moves to the worker — do NOT read them after this call
   */
  protected dispatch(input: TInput, transferables: Transferable[]): Promise<TOutput> {
    if (this.terminated) {
      return Promise.reject(new Error("WorkerPool has been terminated"));
    }

    return new Promise<TOutput>((resolve, reject) => {
      const task: WorkerTask<TInput, TOutput> = {
        id: this.nextId++,
        input,
        transferables,
        resolve,
        reject,
      };

      const freeEntry = this.entries.find((e) => !e.busy);
      if (freeEntry) {
        this.send(freeEntry, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private send(entry: PoolWorkerEntry<TInput, TOutput>, task: WorkerTask<TInput, TOutput>) {
    entry.busy = true;
    entry.pending.set(task.id, task);

    // If the worker has not signalled readiness yet, hold the task until it
    // does. Posting now would race the worker's module load and the message
    // could be dropped, hanging the task forever.
    if (!entry.ready) {
      entry.pendingBeforeReady.push(task);
      return;
    }

    this.post(entry, task);
  }

  private post(entry: PoolWorkerEntry<TInput, TOutput>, task: WorkerTask<TInput, TOutput>) {
    entry.worker.postMessage(
      { id: task.id, input: task.input } satisfies WorkerMessage<TInput>,
      task.transferables,
    );
  }

  private drainQueue(entry: PoolWorkerEntry<TInput, TOutput>) {
    if (this.queue.length > 0 && !entry.busy) {
      const next = this.queue.shift()!;
      this.send(entry, next);
    }
  }

  /** Number of tasks waiting for a free worker */
  get queueLength(): number {
    return this.queue.length;
  }

  /** Number of workers currently processing a task */
  get activeWorkers(): number {
    return this.entries.filter((e) => e.busy).length;
  }

  /** Total pool size */
  get poolSize(): number {
    return this.entries.length;
  }

  /**
   * Gracefully terminate all workers. Any in-flight tasks are rejected.
   * Pool cannot be used after calling this.
   */
  terminate(): void {
    this.terminated = true;
    for (const entry of this.entries) {
      // Reject any pending tasks
      for (const task of entry.pending.values()) {
        task.reject(new Error("WorkerPool terminated"));
      }
      entry.pending.clear();
      entry.worker.terminate();
    }
    // Reject queued tasks
    for (const task of this.queue) {
      task.reject(new Error("WorkerPool terminated"));
    }
    this.queue.length = 0;
  }
}
