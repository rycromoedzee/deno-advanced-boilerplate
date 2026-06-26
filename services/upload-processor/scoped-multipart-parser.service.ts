/**
 * @file services/upload-processor/scoped-multipart-parser.service.ts
 * @description Scoped streaming multipart parser for POST /api/documents/upload
 *
 * Intentionally narrow: supports exactly the current upload form contract.
 * Not intended to be extracted into a reusable generic multipart library.
 *
 * The parser returns a lazy ReadableStream for the file part. The stream is only
 * consumed when the downstream pipeline (encryption + storage) pulls from it.
 * Text fields are collected eagerly since they are small.
 *
 * Supports:
 * - multipart/form-data only
 * - Exactly one file field named "file"
 * - Text fields: name, description, folderId, tags, metadata, sharedUsers, initialComment
 * - Strict limits for header bytes, field bytes, field count, and file size
 * - Rejects nested multipart, repeated file fields, and unsupported content-disposition shapes
 */

import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";

const DEFAULT_SUPPORTED_TEXT_FIELDS = new Set([
  "name",
  "description",
  "folderId",
  "tags",
  "metadata",
  "sharedUsers",
  "initialComment",
]);

export interface ScopedMultipartParseOptions {
  /** Override the default allowed-text-field whitelist. */
  allowedTextFields?: Set<string>;
}

const MAX_TEXT_FIELD_BYTES = 1024 * 1024;
const MAX_PART_HEADER_BYTES = 64 * 1024;
const MAX_TOTAL_FIELDS = 20;

export interface MultipartFilePart {
  filename: string;
  contentType: string;
  fieldName: string;
  stream: ReadableStream<Uint8Array>;
}

export interface ScopedMultipartResult {
  fields: Map<string, string>;
  file: MultipartFilePart | null;
  approximateFileSize: number;
}

function extractBoundary(contentType: string): string {
  const match = contentType.match(/boundary=("[^"]+"|[^\s;]+)/i);
  if (!match) {
    throwHttpError("UPLOAD.MULTIPART_MISSING_BOUNDARY");
  }
  let boundary = match[1];
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }
  if (!boundary) {
    throwHttpError("UPLOAD.MULTIPART_EMPTY_BOUNDARY");
  }
  return boundary;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function parseContentDisposition(headerLine: string): {
  name: string | null;
  filename: string | null;
} {
  const nameMatch = headerLine.match(/\bname="([^"]*)"/i);
  const filenameMatch = headerLine.match(/\bfilename="([^"]*)"/i);
  return {
    name: nameMatch ? nameMatch[1] : null,
    filename: filenameMatch ? filenameMatch[1] : null,
  };
}

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0;
  if (haystack.length < needle.length) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

class ByteStream {
  private buffer = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private eof = false;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  get buffered(): Uint8Array {
    return this.buffer;
  }

  get isEof(): boolean {
    return this.eof;
  }

  async fill(): Promise<void> {
    if (this.eof) return;
    const { done, value } = await this.reader.read();
    if (done) {
      this.eof = true;
      return;
    }
    const newBuf = new Uint8Array(this.buffer.length + value.length);
    newBuf.set(this.buffer);
    newBuf.set(value, this.buffer.length);
    this.buffer = newBuf;
  }

  consume(count: number): Uint8Array {
    const data = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return data;
  }

  async fillUntil(needed: number): Promise<boolean> {
    while (this.buffer.length < needed && !this.eof) {
      await this.fill();
    }
    return this.buffer.length >= needed;
  }

  release(): void {
    if (!this.eof) {
      this.reader.releaseLock();
    }
  }

  async cancelStream(): Promise<void> {
    if (!this.eof) {
      await this.reader.cancel();
      this.eof = true;
    }
  }
}

export class ScopedMultipartParser {
  static async parse(
    request: Request,
    options: ScopedMultipartParseOptions = {},
  ): Promise<ScopedMultipartResult> {
    const allowedTextFields = options.allowedTextFields ?? DEFAULT_SUPPORTED_TEXT_FIELDS;
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throwHttpError("UPLOAD.CONTENT_TYPE_NOT_MULTIPART");
    }

    const boundary = extractBoundary(contentType);
    const delimiter = new TextEncoder().encode(`--${boundary}`);
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);

    if (!request.body) {
      throwHttpError("UPLOAD.BODY_EMPTY");
    }

    const stream = new ByteStream(request.body);
    const fields = new Map<string, string>();
    let filePart: MultipartFilePart | null = null;
    let approximateFileSize = 0;
    let fieldsParsed = 0;
    let totalFieldOverhead = 0;
    let fileFound = false;

    try {
      await skipPreamble(stream, delimiter);

      let moreParts = true;
      while (moreParts) {
        const headerInfo = await readPartHeader(stream);
        if (!headerInfo) {
          moreParts = false;
          break;
        }

        fieldsParsed++;
        if (fieldsParsed > MAX_TOTAL_FIELDS) {
          throwHttpError("UPLOAD.TOO_MANY_FORM_FIELDS");
        }

        totalFieldOverhead += delimiter.length + headerInfo.headerBytes + 4;

        if (headerInfo.filename !== null) {
          if (fileFound) {
            throwHttpError("UPLOAD.MULTIPLE_FILE_FIELDS");
          }
          if (headerInfo.fieldName !== "file") {
            throwHttpErrorWithCustomMessage("COMMON.BAD_REQUEST", `Unexpected file field: ${headerInfo.fieldName}`);
          }

          fileFound = true;

          const fileReadable = createFilePartStream(stream, delimiter);

          filePart = {
            filename: headerInfo.filename || "unknown",
            contentType: headerInfo.contentType || "application/octet-stream",
            fieldName: headerInfo.fieldName,
            stream: fileReadable,
          };

          approximateFileSize = contentLength > 0
            ? Math.max(0, contentLength - totalFieldOverhead - delimiter.length * (fieldsParsed + 1))
            : 0;

          moreParts = false;
          break;
        }

        if (!allowedTextFields.has(headerInfo.fieldName)) {
          await skipToDelimiter(stream, delimiter);
          moreParts = !isAtClosingDelimiter(stream, delimiter);
          if (moreParts) await consumeDelimiterSuffix(stream);
          continue;
        }

        const fieldResult = await readTextFieldData(stream, delimiter);
        totalFieldOverhead += fieldResult.data.length;

        if (fieldResult.data.length > MAX_TEXT_FIELD_BYTES) {
          throwHttpErrorWithCustomMessage("COMMON.BAD_REQUEST", `Text field '${headerInfo.fieldName}' exceeds maximum size`);
        }

        fields.set(headerInfo.fieldName, decodeUtf8(fieldResult.data));
        moreParts = !fieldResult.hitClosing;
        if (moreParts) await consumeDelimiterSuffix(stream);
      }
    } catch (error) {
      stream.cancelStream().catch(() => {});
      throw error;
    }

    return { fields, file: filePart, approximateFileSize };
  }
}

async function skipPreamble(stream: ByteStream, delimiter: Uint8Array): Promise<void> {
  for (;;) {
    const idx = findSubarray(stream.buffered, delimiter);
    if (idx !== -1) {
      stream.consume(idx + delimiter.length);
      await consumeDelimiterSuffix(stream);
      return;
    }
    if (stream.isEof) return;
    const keepLen = Math.min(stream.buffered.length, delimiter.length);
    stream.consume(stream.buffered.length - keepLen);
    await stream.fill();
  }
}

async function consumeDelimiterSuffix(stream: ByteStream): Promise<void> {
  await stream.fillUntil(2);
  if (stream.buffered.length >= 2 && stream.buffered[0] === 0x0d && stream.buffered[1] === 0x0a) {
    stream.consume(2);
  }
}

async function readPartHeader(
  stream: ByteStream,
): Promise<
  {
    fieldName: string;
    filename: string | null;
    contentType: string;
    headerBytes: number;
  } | null
> {
  let headerBytes = 0;
  const headerLines: string[] = [];

  for (;;) {
    await stream.fillUntil(2);
    if (stream.buffered.length === 0) return null;

    const lineEnd = findSubarray(stream.buffered, new Uint8Array([0x0d, 0x0a]));
    if (lineEnd === -1) {
      await stream.fill();
      continue;
    }

    if (lineEnd === 0) {
      stream.consume(2);
      break;
    }

    const lineBytes = stream.consume(lineEnd);
    stream.consume(2);
    headerBytes += lineBytes.length + 2;
    headerLines.push(decodeUtf8(lineBytes));

    if (headerBytes > MAX_PART_HEADER_BYTES) {
      throwHttpError("UPLOAD.PART_HEADER_TOO_LARGE");
    }
  }

  let fieldName: string | null = null;
  let filename: string | null = null;
  let partContentType = "";

  for (const line of headerLines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("content-disposition:")) {
      const parsed = parseContentDisposition(line);
      fieldName = parsed.name;
      filename = parsed.filename;
    } else if (lower.startsWith("content-type:")) {
      partContentType = line.substring(line.indexOf(":") + 1).trim();
    }
  }

  if (!fieldName) {
    throwHttpError("UPLOAD.PART_MISSING_NAME");
  }

  return { fieldName, filename, contentType: partContentType, headerBytes };
}

function createFilePartStream(
  stream: ByteStream,
  delimiter: Uint8Array,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const idx = findSubarray(stream.buffered, delimiter);
          if (idx !== -1) {
            let data = stream.buffered.subarray(0, idx);
            if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
              data = data.subarray(0, data.length - 2);
            }
            if (data.length > 0) {
              controller.enqueue(data);
            }
            stream.consume(idx + delimiter.length);
            await consumeDelimiterSuffix(stream);
            controller.close();
            return;
          }

          if (stream.isEof) {
            if (stream.buffered.length > 0) {
              controller.enqueue(stream.buffered);
              stream.consume(stream.buffered.length);
            }
            controller.close();
            return;
          }

          if (stream.buffered.length > delimiter.length) {
            const safeEnd = stream.buffered.length - delimiter.length;
            const data = stream.buffered.subarray(0, safeEnd);
            controller.enqueue(new Uint8Array(data));
            stream.consume(safeEnd);
            return;
          }

          await stream.fill();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      stream.cancelStream().catch(() => {});
    },
  });
}

async function skipToDelimiter(stream: ByteStream, delimiter: Uint8Array): Promise<void> {
  for (;;) {
    const idx = findSubarray(stream.buffered, delimiter);
    if (idx !== -1) {
      stream.consume(idx + delimiter.length);
      return;
    }
    if (stream.isEof) return;
    const keepLen = Math.min(stream.buffered.length, delimiter.length);
    stream.consume(stream.buffered.length - keepLen);
    await stream.fill();
  }
}

async function readTextFieldData(
  stream: ByteStream,
  delimiter: Uint8Array,
): Promise<{ data: Uint8Array; hitClosing: boolean }> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  for (;;) {
    const idx = findSubarray(stream.buffered, delimiter);
    if (idx !== -1) {
      let data = stream.buffered.subarray(0, idx);
      if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
        data = data.subarray(0, data.length - 2);
      }

      chunks.push(data);
      totalLen += data.length;

      stream.consume(idx + delimiter.length);

      const hitClosing = isAtClosingDelimiter(stream, delimiter);

      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return { data: result, hitClosing };
    }

    if (stream.isEof) {
      chunks.push(stream.buffered);
      totalLen += stream.buffered.length;
      stream.consume(stream.buffered.length);

      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return { data: result, hitClosing: true };
    }

    if (stream.buffered.length > delimiter.length) {
      const safeEnd = stream.buffered.length - delimiter.length;
      chunks.push(stream.buffered.subarray(0, safeEnd));
      totalLen += safeEnd;
      stream.consume(safeEnd);
    }

    await stream.fill();
  }
}

function isAtClosingDelimiter(stream: ByteStream, _delimiter: Uint8Array): boolean {
  const buf = stream.buffered;
  const closingMarker = new Uint8Array([0x2d, 0x2d]);
  if (buf.length < closingMarker.length) return false;
  return buf[0] === 0x2d && buf[1] === 0x2d;
}
