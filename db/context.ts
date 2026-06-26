/**
 * @file db/context.ts
 * @description Database request context (global vs tenant connection selection)
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage<{
  environmentId: string;
  userId: string;
}>();
