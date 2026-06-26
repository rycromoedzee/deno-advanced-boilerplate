import { getToken } from "@/composables/useAuth";

/** Default request timeout in milliseconds (matches the previous axios instance). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Base URL prefix for all requests. Empty string = same-origin (Vite dev proxy handles /api). */
const baseURL = import.meta.env.VITE_API_BASE_URL || "";

export interface RequestOptions {
  /**
   * Query-string parameters. `undefined`, `null`, and `""` values are skipped — this matches
   * how axios serialized params. (Array values are not supported; no service uses them.)
   */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Extra request headers. `Admin-Token` is added automatically and need not be passed. */
  headers?: Record<string, string>;
}

/** Internal options used by `request()` — adds an optional JSON `body` to `RequestOptions`. */
interface InternalRequestOptions extends RequestOptions {
  body?: unknown;
}

/**
 * Typed error thrown for any non-2xx response, network failure, or timeout.
 * Carries the same information axios exposed, but strongly typed.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly data: unknown;
  readonly url: string;
  readonly method: string;

  constructor(
    status: number,
    statusText: string,
    data: unknown,
    url: string,
    method: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.data = data;
    this.url = url;
    this.method = method;
  }
}

interface ErrorDetails {
  url: string;
  method: string;
  status: number;
  statusText: string;
  data: unknown;
  message: string;
  timestamp: string;
}

/**
 * Reproduce the previous axios response-interceptor behavior exactly: log the error, persist it
 * to localStorage for debugging across reloads, and redirect to the admin 404 page on 401/404.
 * `method` is lowercased to match axios's `error.config.method` (axios lowercases it internally).
 */
function handleError(details: ErrorDetails): void {
  console.log("[API Response Error]", details);
  localStorage.setItem("last_api_error", JSON.stringify(details));

  if (details.status === 401 || details.status === 404) {
    console.log("[API Response] Redirecting to 404 due to status:", details.status);
    window.location.href = "/internal/__admin/404";
  }
}

/** Build the full URL: baseURL + path + serialized query params (empty values skipped). */
function buildUrl(url: string, params?: RequestOptions["params"]): string {
  const full = `${baseURL}${url}`;
  if (!params) return full;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `${full}${full.includes("?") ? "&" : "?"}${query}` : full;
}

/** Core request function backing every verb method. */
async function request<T>(
  method: string,
  url: string,
  options: InternalRequestOptions = {},
): Promise<T> {
  const { params, headers, body } = options;
  const fullUrl = buildUrl(url, params);
  const methodLower = method.toLowerCase();

  const requestHeaders: Record<string, string> = { ...headers };
  const token = getToken();
  if (token) {
    requestHeaders["Admin-Token"] = token;
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure or timeout. AbortSignal.timeout rejects with a DOMException whose
    // name is "TimeoutError"; everything else is treated as a generic network error.
    const err = error as { name?: string; message?: string };
    const isTimeout = err?.name === "TimeoutError";
    const message = isTimeout ? `Request timed out after ${DEFAULT_TIMEOUT_MS}ms` : err?.message ?? "Network error";
    handleError({
      url: fullUrl,
      method: methodLower,
      status: 0,
      statusText: "",
      data: undefined,
      message,
      timestamp: new Date().toISOString(),
    });
    throw new HttpError(0, "", undefined, fullUrl, methodLower, message);
  }

  if (!response.ok) {
    // Non-2xx: try to parse an error body, then log + redirect + throw.
    let errorData: unknown;
    try {
      const text = await response.text();
      errorData = text ? JSON.parse(text) : undefined;
    } catch {
      errorData = undefined;
    }
    const message = `HTTP ${response.status} ${response.statusText}`;
    handleError({
      url: fullUrl,
      method: methodLower,
      status: response.status,
      statusText: response.statusText,
      data: errorData,
      message,
      timestamp: new Date().toISOString(),
    });
    throw new HttpError(response.status, response.statusText, errorData, fullUrl, methodLower, message);
  }

  // Success. Parse JSON; an empty body (204 or empty 200) resolves to undefined.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(url: string, options?: RequestOptions): Promise<T> => request<T>("GET", url, options),
  post: <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>("POST", url, { ...options, body }),
  put: <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>("PUT", url, { ...options, body }),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>("PATCH", url, { ...options, body }),
  delete: <T>(url: string, options?: RequestOptions): Promise<T> => request<T>("DELETE", url, options),
};
