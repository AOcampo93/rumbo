import {
  type ApiError,
  type ApiErrorCode,
  type ErrorDetail,
  MAX_ERROR_DETAILS,
} from '@rumbo/api-contract';
import { DrizzleQueryError } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

// Every error answers `{ code }` (PROJECT_PLAN §11.1): the client translates
// codes into the user's language; the API never sends text to show.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    /** Where a request is wrong, for developers (never shown). */
    readonly details?: readonly ErrorDetail[],
  ) {
    super(code);
  }
}

/** An error answer; `details` are cut to the first MAX_ERROR_DETAILS. */
export const fail = (status: number, code: ApiErrorCode, details?: readonly ErrorDetail[]) =>
  new ApiFailure(status, code, details?.slice(0, MAX_ERROR_DETAILS));

/**
 * Postgres data exceptions that a request's values can cause although every
 * validator accepted them: a number out of range, a value an integer column
 * can't parse ("Infinity"), a text Postgres can't store.
 */
const DATA_EXCEPTIONS = new Set(['22003', '22P02', '22P05']);

/** The SQLSTATE of a Postgres error, also when Drizzle wraps it. */
function sqlState(error: unknown): string | undefined {
  const source = error instanceof DrizzleQueryError ? error.cause : error;
  const code = (source as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

export const isDataException = (error: unknown): boolean =>
  DATA_EXCEPTIONS.has(sqlState(error) ?? '');

/**
 * What may be logged of an error. Drizzle puts the query's parameters in its
 * message and in `params` (positions, device ids, token hashes): only the
 * database's own code and message are kept.
 */
function loggable(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  return { type: 'DrizzleQueryError', code: cause?.code, message: cause?.message };
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Error answers are never cached, whatever the handler set before failing.
    reply.header('cache-control', 'no-store');
    if (error instanceof ApiFailure) {
      return reply.status(error.status).send({
        code: error.code,
        ...(error.details?.length ? { details: [...error.details] } : {}),
      } satisfies ApiError);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.slice(0, MAX_ERROR_DETAILS).map((issue) => ({
        path: issue.instancePath || '/',
        message: issue.message ?? 'invalid',
      }));
      return reply.status(400).send({ code: 'validation_failed', details } satisfies ApiError);
    }
    // Values the database can't store: the client's data, not a bug to log.
    if (isDataException(error)) {
      return reply.status(400).send({ code: 'validation_failed' } satisfies ApiError);
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 413)
      return reply.status(413).send({ code: 'payload_too_large' } satisfies ApiError);
    if (status === 429) return reply.status(429).send({ code: 'rate_limited' } satisfies ApiError);
    // Malformed JSON, wrong content type…: the client's fault, nothing to log.
    if (status >= 400 && status < 500) {
      return reply.status(400).send({ code: 'validation_failed' } satisfies ApiError);
    }
    request.log.error({ err: loggable(error) }, 'unhandled error');
    return reply.status(500).send({ code: 'internal' } satisfies ApiError);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .status(404)
      .header('cache-control', 'no-store')
      .send({ code: 'not_found' } satisfies ApiError),
  );
}
