/**
 * @file handlers/documents-comments/index.ts
 * @description Barrel for document comments handlers (mirrors routes/documents-comments/)
 */

export {
  createCommentHandler,
  deleteCommentHandler,
  getCommentHandler,
  listCommentsHandler,
  resolveCommentHandler,
  unresolveCommentHandler,
} from "./documents-comments.handler.ts";
