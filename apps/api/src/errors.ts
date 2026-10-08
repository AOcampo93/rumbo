import type { ApiError, ApiErrorCode } from '@rumbo/api-contract';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

// Every error answers `{ code }` (PROJECT_PLAN §11.1): the client translates
// codes into the user's language; the API never sends text to show.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
  }
}

export const fail = (status: number, code: ApiErrorCode) => new ApiFailure(status, code);

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiFailure) {
      return reply.status(error.status).send({ code: error.code } satisfies ApiError);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: issue.instancePath || '/',
        message: issue.message ?? 'invalid',
      }));
      return reply.status(400).send({ code: 'validation_failed', details } satisfies ApiError);
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 413)
      return reply.status(413).send({ code: 'payload_too_large' } satisfies ApiError);
    if (status === 429) return reply.status(429).send({ code: 'rate_limited' } satisfies ApiError);
    // Malformed JSON, wrong content type…: the client's fault, nothing to log.
    if (status >= 400 && status < 500) {
      return reply.status(400).send({ code: 'validation_failed' } satisfies ApiError);
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ code: 'internal' } satisfies ApiError);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ code: 'not_found' } satisfies ApiError),
  );
}
