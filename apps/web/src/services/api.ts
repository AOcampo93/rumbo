import { type ApiErrorCode, ApiErrorSchema, DEVICE_ID_HEADER } from '@rumbo/api-contract';
import { LOCALE_TAGS, currentLocale } from '../i18n/index.ts';
import { deviceId } from './device.ts';

// Calls to the API on the same origin (/api/v1, PROJECT_PLAN §11.1): JSON,
// the active language in Accept-Language, the anonymous device id when the
// endpoint needs it, and a timeout so the app never hangs on a bad network.

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Sends X-Device-Id. */
  device?: boolean;
  /** Extra headers, e.g. X-Edit-Token. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Lets the request outlive the page (closing the tab mid-request). Browsers
   * cap such bodies at 64 KiB, so only small fire-and-forget calls ask for it.
   */
  keepalive?: boolean;
}

/**
 * Never rejects because of the HTTP status: callers check `ok`/`status`. It
 * rejects on network errors and when aborted: with the caller's reason when
 * the caller's signal aborts, with a TimeoutError when `timeoutMs` runs out.
 */
export async function api(path: string, request: ApiRequest = {}): Promise<Response> {
  const controller = new AbortController();
  const { signal } = request;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(
    () => controller.abort(new DOMException('The request took too long', 'TimeoutError')),
    request.timeoutMs ?? 8000,
  );
  try {
    const headers: Record<string, string> = {
      ...request.headers,
      accept: 'application/json',
      'accept-language': LOCALE_TAGS[currentLocale()],
    };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.device) headers[DEVICE_ID_HEADER] = await deviceId();
    // Aborted already (or while reading the device id): never send it.
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException('The request was aborted', 'AbortError');
    }
    return await fetch(`/api/v1${path}`, {
      method: request.method ?? 'GET',
      headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
      ...(request.keepalive ? { keepalive: true } : {}),
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** The API's error code in a response, or null when the body isn't an ApiError (e.g. a proxy's HTML page). */
export async function apiErrorCode(response: Response): Promise<ApiErrorCode | null> {
  try {
    const parsed = ApiErrorSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data.code : null;
  } catch {
    return null;
  }
}
