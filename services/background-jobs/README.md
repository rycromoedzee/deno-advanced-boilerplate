# Background Tasks System

A scale-to-zero compatible background task processing system for the Moedzee backend.

## Overview

This system enables long-running operations (like PDF generation, data exports, video processing) to be processed asynchronously without
blocking API requests. It's specifically designed to work in scale-to-zero environments where background workers only run when tasks exist.

### Key Features

- ✅ **Scale-to-Zero Compatible**: No permanent background processes
- ✅ **Multi-Instance Safe**: Atomic queue operations prevent duplicate processing
- ✅ **DB as Source of Truth**: All task state persisted in PostgreSQL `jobs` table
- ✅ **Cache Read-Through**: Fast reads via cache layer
- ✅ **Real-Time Updates**: SSE streaming for live progress tracking
- ✅ **Task Cancellation**: Best-effort cancellation with proper status handling
- ✅ **Retry with Backoff**: Exponential backoff for failed tasks
- ✅ **Orphan Detection**: Scheduled job recovers stuck tasks

## Architecture

### Route → Handler → Service Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client Request                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Route Layer (routes/tasks/task.route.ts)                           │
│  - OpenAPI schema definitions                                        │
│  - Zod validation                                                    │
│  - Response type definitions                                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Handler Layer (handlers/tasks/*.ts)                                │
│  - Uses defineHandler factory                                        │
│  - Extracts auth context (userId, environmentId)                    │
│  - Calls services                                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Service Layer                                                       │
│  - TaskEnqueueService: Create and process tasks                     │
│  - TaskStatusService: Query status + SSE streaming                  │
│  - TaskCancelService: Handle cancellation requests                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Storage Layer                                                       │
│  - PostgreSQL (jobs table): Source of truth                         │
│  - Cache (Redis/Deno KV): Read-through layer                        │
│  - Queue: Cache-based FIFO queue                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Triggered Consumer Pattern

Instead of permanent background workers with `while(true)` loops, we use a triggered consumer:

1. Task enqueued → Processor starts
2. Process until queue is empty → Processor stops
3. This allows the app to scale-to-zero when idle

## Quick Start

### 1. Create a Task Handler

Extend the `BaseTaskHandler` class:

```typescript
// services/background-tasks/handlers/pdf-export.handler.ts
import { BaseTaskHandler, TaskResultType } from "@services/background-tasks/index.ts";
import { z } from "@deps";

// Define input schema
const PdfExportInputSchema = z.object({
  documentId: z.string().uuid(),
  format: z.enum(["a4", "letter"]).default("a4"),
});

type PdfExportInput = z.infer<typeof PdfExportInputSchema>;
type PdfExportResult = { downloadUrl: string; expiresAt: number };

export class PdfExportHandler extends BaseTaskHandler<PdfExportInput, PdfExportResult> {
  readonly taskType = "pdf-export";
  readonly description = "Export documents to PDF format";
  readonly inputSchema = PdfExportInputSchema;
  readonly resultType = TaskResultType.DOWNLOAD;
  readonly maxRetries = 3;

  protected async execute(input: PdfExportInput, context: TaskContext): Promise<PdfExportResult> {
    // Update progress
    await context.updateProgress(10, "Starting PDF export...");

    // Check for cancellation periodically
    await this.throwIfCancelled();

    // Do work...
    await context.updateProgress(50, "Processing document...");

    // Check again before final steps
    await this.throwIfCancelled();

    // Complete
    await context.updateProgress(100, "PDF export complete");

    return {
      downloadUrl: `/api/downloads/${context.taskId}`,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
  }
}
```

### 2. Register the Handler

Add to the handler registry:

```typescript
// services/background-tasks/handlers/index.ts
import { PdfExportHandler } from "./pdf-export.handler.ts";

export const handlerDefinitions: BaseTaskHandler<unknown, unknown>[] = [
  new PdfExportHandler(),
  // Add more handlers here...
];
```

### 3. Trigger Tasks via API

```bash
# Trigger a task
curl -X POST https://api.example.com/api/tasks/pdf-export/trigger \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"input": {"documentId": "123e4567-e89b-12d3-a456-426614174000"}}'

# Response:
{
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "statusUrl": "/api/tasks/550e8400-e29b-41d4-a716-446655440000/status",
  "streamUrl": "/api/tasks/550e8400-e29b-41d4-a716-446655440000/stream"
}
```

### 4. Stream Progress via SSE

```javascript
const eventSource = new EventSource(streamUrl);

eventSource.addEventListener("connected", (e) => {
  console.log("Connected to task stream");
});

eventSource.addEventListener("processing", (e) => {
  const state = JSON.parse(e.data);
  console.log(`Progress: ${state.progress}% - ${state.message}`);
});

eventSource.addEventListener("completed", (e) => {
  const state = JSON.parse(e.data);
  console.log("Task completed!", state.result);
  eventSource.close();
});

eventSource.addEventListener("failed", (e) => {
  const state = JSON.parse(e.data);
  console.error("Task failed:", state.error);
  eventSource.close();
});
```

## API Endpoints

| Method | Path                           | Description                          |
| ------ | ------------------------------ | ------------------------------------ |
| POST   | `/api/tasks/:taskType/trigger` | Start a new task                     |
| GET    | `/api/tasks/:taskId/status`    | Get task status as JSON              |
| GET    | `/api/tasks/:taskId/stream`    | SSE stream for real-time updates     |
| POST   | `/api/tasks/:taskId/cancel`    | Request task cancellation            |
| GET    | `/api/tasks/:taskId/download`  | Download result file (if applicable) |

## Task Handler Guide

### BaseTaskHandler Class

All task handlers must extend `BaseTaskHandler`:

```typescript
abstract class BaseTaskHandler<TInput, TResult> {
  // Required properties
  abstract readonly taskType: string; // Unique identifier
  abstract readonly description: string; // Human-readable description
  abstract readonly inputSchema: z.ZodSchema<TInput>; // Zod schema
  abstract readonly resultType: TaskResultType; // Result type

  // Optional properties
  readonly maxRetries?: number; // Default: 3

  // Required method
  protected abstract execute(input: TInput, context: TaskContext): Promise<TResult>;

  // Cancellation helpers
  protected async checkCancelled(): Promise<boolean>;
  protected async throwIfCancelled(): Promise<void>;
}
```

### TaskContext Interface

```typescript
interface TaskContext {
  taskId: string;
  userId?: string;
  environmentId?: string;
  updateProgress: (progress: number, message?: string) => Promise<void>;
}
```

### Result Types

```typescript
enum TaskResultType {
  JSON = "json", // Return JSON data
  DOWNLOAD = "download", // Return file download URL
  NOTIFICATION = "notification", // Just a status message
}
```

### Best Practices

#### 1. Check for Cancellation

```typescript
protected async execute(input: Input, context: TaskContext): Promise<Result> {
  await this.throwIfCancelled(); // Check at start
  
  for (const item of items) {
    await this.throwIfCancelled(); // Check in loops
    await processItem(item);
  }
  
  await this.throwIfCancelled(); // Check before final steps
  return result;
}
```

#### 2. Report Progress

```typescript
await context.updateProgress(0, "Starting...");
// ... work ...
await context.updateProgress(25, "Step 1 complete");
// ... more work ...
await context.updateProgress(50, "Step 2 complete");
// ... final work ...
await context.updateProgress(100, "Complete");
```

#### 3. Handle Errors Gracefully

```typescript
protected async execute(input: Input, context: TaskContext): Promise<Result> {
  try {
    return await riskyOperation();
  } catch (error) {
    // Log and re-throw to mark task as failed
    console.error(`Task ${context.taskId} failed:`, error);
    throw error;
  }
}
```

#### 4. Clean Up Resources

```typescript
protected async execute(input: Input, context: TaskContext): Promise<Result> {
  const tempFile = await createTempFile();
  
  try {
    return await processFile(tempFile);
  } finally {
    await deleteTempFile(tempFile);
  }
}
```

## Task Lifecycle

### Status Flow

```
PENDING → PROCESSING → COMPLETED
                   ↘ FAILED
                   ↘ CANCELLED
```

### State Transitions

1. **PENDING**: Task enqueued, waiting for processor
2. **PROCESSING**: Handler is executing
3. **COMPLETED**: Handler returned successfully
4. **FAILED**: Handler threw an error (after retries exhausted)
5. **CANCELLED**: User requested cancellation

### Retry Behavior

When a task fails:

1. Task is marked as PENDING again
2. `retryCount` is incremented
3. Task is re-enqueued after exponential backoff delay
4. Process repeats until `maxRetries` is reached
5. If all retries fail, task is marked as FAILED

Backoff formula: `baseDelay * (2 ^ retryCount) + jitter`

## Authorization

### Multi-Tenant Isolation

Both `userId` AND `environmentId` are required for all task operations:

```typescript
// In handler
const state = await getTaskStatusService().getTaskState(
  taskId,
  userId, // From auth context
  environmentId, // From auth context
);
```

### 404 Pattern

For security, unauthorized access returns 404 (not 403):

```typescript
if (state.userId !== userId || state.environmentId !== environmentId) {
  return null; // Will become 404 in handler
}
```

This prevents information disclosure about task existence.

## Storage Strategy

### DB as Source of Truth

All state changes go to DB first:

```typescript
// 1. Update DB
await db.update(jobs).set({ status, meta }).where(eq(jobs.id, taskId));

// 2. Invalidate cache
await cache.delete(CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS, taskId);

// 3. (Future) Publish to pub/sub
await pubSub.publish(`task:${taskId}:updates`, state);
```

### Cache as Read-Through

Reads go to cache first, falling back to DB:

```typescript
// Try cache
const cached = await cache.get(CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS, taskId);
if (cached) return cached;

// Cache miss - query DB
const job = await db.select().from(jobs).where(eq(jobs.id, taskId));

// Populate cache
await cache.set(CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS, taskId, state, { ttl: 3600 });

return state;
```

## Scheduled Jobs

### Task Cleanup Job

The `task-cleanup.job.ts` handles:

1. **Orphan Detection**: Finds tasks stuck in PROCESSING for > 30 minutes
2. **Orphan Recovery**: Re-queues orphans if retries remain, marks FAILED otherwise
3. **TTL Cleanup**: Deletes completed/failed/cancelled tasks older than 7 days

Runs every 30 minutes via the job registry.

## Monitoring

### Task Metrics

```typescript
// Get queue length
const length = await getTaskEnqueueService().getQueueLength();

// Get handler stats
const types = getRegisteredTaskTypes();
console.log(`Registered handlers: ${types.join(", ")}`);
```

### Logging

All task operations are logged with structured logging:

```typescript
await useLogger(LoggerLevels.info, {
  message: "Background task completed",
  section: loggerAppSections.INTERNAL,
  messageKey: "background_tasks.completed",
  details: { taskId, taskType, duration },
});
```

## Error Handling

### Error Keys

Task-specific errors are defined in `constants/errors/tasks.ts`:

| Key                       | HTTP Code | Description              |
| ------------------------- | --------- | ------------------------ |
| `TASKS.HANDLER_NOT_FOUND` | 400       | No handler for task type |
| `TASKS.TASK_NOT_FOUND`    | 404       | Task doesn't exist       |
| `TASKS.ALREADY_COMPLETED` | 400       | Task already completed   |
| `TASKS.ALREADY_CANCELLED` | 400       | Task already cancelled   |
| `TASKS.ALREADY_FAILED`    | 400       | Task already failed      |
| `TASKS.NOT_DOWNLOADABLE`  | 400       | No downloadable result   |
| `TASKS.NOT_COMPLETED`     | 400       | Task not finished yet    |

## File Structure

```
services/background-tasks/
├── index.ts                    # Public exports
├── singletons.ts               # Service getters
├── task-enqueue.service.ts     # Create and process tasks
├── task-status.service.ts      # Status queries + SSE
├── task-cancel.service.ts      # Cancellation handling
├── base-task-handler.ts        # Abstract base class
├── handlers/
│   └── index.ts                # Handler registry
├── providers/
│   └── cache-queue.provider.ts # Cache-based queue
└── utils/
    └── cancellation-token.ts   # Efficient cancellation

handlers/tasks/
├── task-trigger.handler.ts     # Trigger task
├── task-status.handler.ts      # Get status
├── task-stream.handler.ts      # SSE stream
├── task-cancel.handler.ts      # Cancel task
└── task-download.handler.ts    # Download result

routes/tasks/
└── task.route.ts               # OpenAPI routes

models/tasks/
└── task.model.ts               # Zod schemas

jobs/
└── task-cleanup.job.ts         # Orphan detection + cleanup
```

## Troubleshooting

### Tasks Not Processing

1. Check handler is registered: `getRegisteredTaskTypes()`
2. Check queue length: `await cache.queueLength(queueName)`
3. Check for errors in logs with messageKey `background_tasks.*`

### Duplicate Processing

Should not happen with cache-based queue (atomic dequeue). If observed:

1. Check all instances use the same cache backend
2. Verify cache provider supports atomic operations

### Stuck Tasks

1. Check `jobs` table for tasks in PROCESSING state
2. Check `updatedAt` timestamp
3. Wait for cleanup job (30 min) or run manually

### SSE Not Streaming

1. Check authorization (userId/environmentId match)
2. Check cache connectivity
3. Verify task exists and is not completed

## Migration from Old System

If migrating from the old cache-only system:

1. **Phase 0**: Drain existing queue, add CANCELLED status
2. **Phase 1**: Deploy new services (runs in parallel)
3. **Phase 2**: Switch routes to new handlers
4. **Phase 3**: Remove old implementation files

See `plans/background-tasks-improvement-plan.md` for detailed migration steps.

## Future Enhancements

- [ ] Redis Pub/Sub for SSE (replace polling)
- [ ] Task priority queue
- [ ] Task dependencies (chains)
- [ ] Scheduled task execution
- [ ] Dead letter queue
- [ ] Admin UI for queue monitoring
