import { DEVICE_ID_HEADER } from '@rumbo/api-contract';
import { LOCALE_TAGS, currentLocale } from '../i18n/index.ts';
import { deviceId } from './device.ts';

// Calls to the API on the same origin (/api/v1, PROJECT_PLAN §11.1): JSON,
// the active language in Accept-Language, the anonymous device id when the
// endpoint needs it, and a timeout so the app never hangs on a bad network.

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Sends X-Device-Id. */
  device?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function api(path: string, request: ApiRequest = {}): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': LOCALE_TAGS[currentLocale()],
  };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (request.device) headers[DEVICE_ID_HEADER] = await deviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 8000);
  request.signal?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(`/api/v1${path}`, {
      method: request.method ?? 'GET',
      headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
      keepalive: request.method !== undefined && request.method !== 'GET',
    });
  } finally {
    clearTimeout(timer);
  }
}
