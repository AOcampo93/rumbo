import type { z } from 'zod';
import { api, apiErrorCode } from './api.ts';

// Calls to the AI endpoints (POST /content/generate and POST /suggest/places,
// phase 7): the anonymous device id travels with them, the answers are checked
// against the contract, and every failure becomes an AiError whose code the
// screens explain in the user's language.

export type AiErrorCode =
  'offline' | 'ai_unavailable' | 'ai_budget_exceeded' | 'ai_device_limit' | 'failed';

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode) {
    super(`The AI request failed: ${code}`);
    this.name = 'AiError';
    this.code = code;
  }
}

/** The catalog message for each error, for screens that show the reason as it is. */
export const AI_ERROR_MESSAGES = {
  offline: 'errors.ai.offline',
  ai_unavailable: 'errors.ai.unavailable',
  ai_budget_exceeded: 'errors.ai.budgetExceeded',
  ai_device_limit: 'errors.ai.deviceLimit',
  failed: 'errors.ai.failed',
} as const satisfies Record<AiErrorCode, string>;

/** Errors that asking again won't fix today: no AI here, or the day's budget or limit is spent. */
export const BLOCKING_AI_ERRORS: ReadonlySet<AiErrorCode> = new Set([
  'ai_unavailable',
  'ai_budget_exceeded',
  'ai_device_limit',
]);

/**
 * POSTs `body` and returns the answer once it has passed `schema`. Rejects
 * with an AiError, or with the caller's own AbortError when `signal` aborts
 * (the screen closed, a newer request replaced this one).
 */
export async function postAi<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options: { timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<T> {
  const { signal } = options;
  let response: Response;
  try {
    response = await api(path, {
      method: 'POST',
      body,
      device: true,
      timeoutMs: options.timeoutMs,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AiError(globalThis.navigator?.onLine === false ? 'offline' : 'failed');
  }
  if (!response.ok) throw new AiError(await errorFor(response));
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AiError('failed');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError('failed');
  return parsed.data;
}

async function errorFor(response: Response): Promise<AiErrorCode> {
  const code = await apiErrorCode(response);
  if (code === 'ai_unavailable' || code === 'ai_budget_exceeded' || code === 'ai_device_limit') {
    return code;
  }
  // Everything else (generation_failed, rate_limited, a proxy's error page…) can be tried again.
  return 'failed';
}
