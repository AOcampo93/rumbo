import { randomBytes } from 'node:crypto';
import { MEDIA_LIMITS, MediaParamsSchema, MediaUploadResponseSchema } from '@rumbo/api-contract';
import { and, count, eq, gt, min, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { media } from '../db/schema.js';
import { requireDeviceId, touchDevice } from '../device.js';
import { fail } from '../errors.js';
import { addressLimit } from '../limits.js';
import { mediaUrl } from '../media/cover.js';
import { processPhoto } from '../media/photo.js';
import type { AdminGuard } from '../push/admin.js';
import { type DataOptions, requireDatabase } from './routes.js';

// The photos users upload as the cover of their routes (phase 7.3, ADR 0005).
// POST /media turns an upload into a metadata-free JPEG and keeps it in the
// database; GET /media/<id>.jpg serves it to anyone who has the address (128
// random bits); the operator can delete one. The photo itself is never logged:
// only its id and sizes.

export interface MediaRoutesOptions extends DataOptions {
  /** The hooks the operator's endpoint is guarded with (ADMIN_TOKEN, shared with the other admin endpoints). */
  admin: AdminGuard;
  /** The origin in the address of every photo. */
  publicOrigin: string;
  /** Uploads per minute per client address. */
  rateLimitPerMinute: number;
  /** Uploads one device may make in 24 hours. */
  uploadsPerDevicePerDay: number;
  /** The most the stored photos may weigh in total, in bytes. */
  maxTotalBytes: number;
}

const DAY_MS = 24 * 3_600_000;

/**
 * A day. A photo never changes (its address is made for it once), but the
 * operator may delete one, and the copies browsers keep must not outlive that
 * for long.
 */
const CACHE_A_DAY = 'public, max-age=86400';

/** Characters of a photo's id: 128 random bits in base64url. */
const ID_LENGTH = 22;

/** The operator names a photo by its id, the 22 characters of its address. */
const MediaIdParamsSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{22}$/) });

/** The photo as raw bytes, for the API description (the body is not JSON). */
const PhotoSchema = z
  .custom<Buffer>((value) => Buffer.isBuffer(value))
  .meta({
    type: 'string',
    format: 'binary',
  });

/** The media type of a Content-Type header: lowercase, without parameters. */
const mediaTypeOf = (header: string | undefined): string =>
  (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * The headers of a photo: cached for good, and a browser may do nothing with
 * the bytes but show them as an image. They are never markup, but nothing
 * relies on that. Set only once the photo is known to exist: an error answer
 * must not carry them.
 */
function served(reply: FastifyReply, etag: string): FastifyReply {
  return reply
    .header('etag', etag)
    .header('cache-control', CACHE_A_DAY)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('cross-origin-resource-policy', 'same-origin');
}

export const mediaRoutes: FastifyPluginAsyncZod<MediaRoutesOptions> = async (app, options) => {
  const uploadLimit = addressLimit(app, [
    { max: options.rateLimitPerMinute, timeWindow: '1 minute' },
  ]);
  const needsDevice = async (request: FastifyRequest) => {
    requireDeviceId(request);
  };
  // Checked before the body is read. Fastify answers an unknown Content-Type
  // with its own 415, which the error handler turns into a 400.
  const photoContentType = async (request: FastifyRequest) => {
    if (
      !(MEDIA_LIMITS.types as readonly string[]).includes(
        mediaTypeOf(request.headers['content-type']),
      )
    ) {
      throw fail(415, 'unsupported_media');
    }
  };
  // The device's share of the day and the server's space, checked before the
  // photo is read or decoded. Two uploads racing can pass the device's limit
  // together: it is a courtesy, the address limit and the space are the walls.
  const roomForUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const { db } = requireDatabase(options);
    const deviceId = requireDeviceId(request);
    const now = Date.now();
    const [mine] = await db
      .select({ uploads: count(), first: min(media.createdAt) })
      .from(media)
      .where(and(eq(media.deviceId, deviceId), gt(media.createdAt, new Date(now - DAY_MS))));
    if ((mine?.uploads ?? 0) >= options.uploadsPerDevicePerDay) {
      // Room again when the oldest upload of the day is a day old.
      const wait = mine?.first ? Math.ceil((mine.first.getTime() + DAY_MS - now) / 1000) : 1;
      reply.header('retry-after', Math.max(wait, 1));
      throw fail(429, 'rate_limited');
    }
    const [stored] = await db
      .select({ bytes: sql<string>`coalesce(sum(${media.bytes}), 0)` })
      .from(media);
    if (Number(stored?.bytes ?? 0) >= options.maxTotalBytes) throw fail(503, 'unavailable');
  };

  // The photo arrives as the body itself, in one of the three types: a Buffer.
  for (const type of MEDIA_LIMITS.types) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: MEDIA_LIMITS.maxUploadBytes },
      (_request, body, done) => done(null, body),
    );
  }

  app.post(
    '/v1/media',
    {
      onRequest: [uploadLimit, needsDevice, photoContentType, roomForUpload],
      bodyLimit: MEDIA_LIMITS.maxUploadBytes,
      schema: {
        tags: ['media'],
        summary:
          'Stores a photo for a route cover (needs X-Device-Id): the body is the photo itself (JPEG, PNG or WebP, up to 4 MB), which the server turns upright, scales down to 1600 px and keeps as a JPEG without any metadata',
        consumes: [...MEDIA_LIMITS.types],
        body: PhotoSchema,
        response: { 201: MediaUploadResponseSchema },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const deviceId = requireDeviceId(request);
      const photo = await processPhoto(request.body);
      const id = randomBytes(16).toString('base64url');
      const bytes = photo.data.length;
      await db.insert(media).values({
        id,
        deviceId,
        data: photo.data,
        bytes,
        width: photo.width,
        height: photo.height,
      });
      await touchDevice(db, deviceId, request.headers['user-agent']);
      request.log.info(
        {
          mediaId: id,
          inputBytes: request.body.length,
          bytes,
          width: photo.width,
          height: photo.height,
        },
        'photo stored',
      );
      return reply.status(201).send({
        id,
        url: mediaUrl(options.publicOrigin, id),
        width: photo.width,
        height: photo.height,
        bytes,
      });
    },
  );

  app.get(
    '/v1/media/:file',
    {
      schema: {
        tags: ['media'],
        summary: 'A stored photo (a JPEG), for ever cached: its address never shows another photo',
        params: MediaParamsSchema,
        response: {
          200: {
            description: 'The photo',
            content: { 'image/jpeg': { schema: PhotoSchema } },
          },
        },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      // The address is the id and `.jpg`; the schema checked both.
      const id = request.params.file.slice(0, ID_LENGTH);
      // The id is the ETag: the same id is always the same bytes. A client
      // that has them only needs to know the photo still exists.
      const etag = `"${id}"`;
      if (request.headers['if-none-match'] === etag) {
        const [exists] = await db.select({ id: media.id }).from(media).where(eq(media.id, id));
        if (!exists) throw fail(404, 'not_found');
        return served(reply, etag).status(304).send();
      }
      const [photo] = await db.select({ data: media.data }).from(media).where(eq(media.id, id));
      if (!photo) throw fail(404, 'not_found');
      return served(reply, etag).type('image/jpeg').send(photo.data);
    },
  );

  app.delete(
    '/v1/admin/media/:id',
    {
      onRequest: [...options.admin],
      schema: {
        tags: ['admin'],
        summary:
          'Deletes a stored photo for good; a route that used it keeps its address, which then answers 404 (Authorization: Bearer ADMIN_TOKEN)',
        params: MediaIdParamsSchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const { id } = request.params;
      const deleted = await db.delete(media).where(eq(media.id, id)).returning({ id: media.id });
      if (deleted.length === 0) throw fail(404, 'not_found');
      request.log.info({ mediaId: id }, 'media deleted by the operator');
      return reply.status(204).send();
    },
  );
};
