import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import {
  isOwnMediaUrl,
  MEDIA_LIMITS,
  MEDIA_PATH,
  MediaUploadResponseSchema,
} from '@rumbo/api-contract';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { devices, media } from '../src/db/schema.js';
import { installErrorHandling } from '../src/errors.js';
import { MAX_INPUT_PIXELS } from '../src/media/photo.js';
import { adminGuard } from '../src/push/admin.js';
import { mediaRoutes } from '../src/routes/media.js';
import { DEVICE, OTHER_DEVICE, resetDatabase, setupApi } from './helpers.js';
import {
  type Api,
  download,
  GIVEAWAY_EXIF,
  halves,
  insertPhoto,
  JPEG,
  photoRow,
  smallJpeg,
  solid,
  storePhoto,
  upload,
} from './media-helpers.js';
import { ADMIN_TOKEN } from './push-fakes.js';

// POST /media, GET /media/<id>.jpg and the operator's DELETE (phase 7.3, ADR
// 0005): what the server makes of an upload, what it serves, and the limits
// that keep the photos from filling it. The images are real ones, made with
// sharp.

const BEARER = `Bearer ${ADMIN_TOKEN}`;
const ORIGIN = 'https://rumbo.arturoocampo.com';

let api: Api;
beforeAll(async () => {
  api = await setupApi({ adminToken: ADMIN_TOKEN, rateLimitPerMinute: 100_000 });
});
afterAll(() => api.close());
beforeEach(() => resetDatabase(api.database));

/** The marker segments a JPEG has before its image data: 0xe1 is EXIF or XMP, 0xe2 an ICC profile… */
function markersOf(jpeg: Buffer): number[] {
  const found: number[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1] as number;
    found.push(marker);
    if (marker === 0xda) break;
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return found;
}
const APP_AND_COMMENT_MARKERS = [...Array.from({ length: 16 }, (_, i) => 0xe0 + i), 0xfe];

/** The colour at a pixel of the stored photo. */
async function pixel(jpeg: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at] as number, data[at + 1] as number, data[at + 2] as number];
}
const isRed = ([r, g, b]: number[]) =>
  (r as number) > 140 && (g as number) < 110 && (b as number) < 110;
const isBlue = ([r, , b]: number[]) => (b as number) > 140 && (r as number) < 110;

describe('POST /api/v1/media', () => {
  it.each([
    ['image/jpeg', () => solid(640, 480).jpeg().toBuffer()],
    ['image/png', () => solid(640, 480).png().toBuffer()],
    ['image/webp', () => solid(640, 480).webp().toBuffer()],
  ])('takes %s and keeps it as a JPEG', async (type, make) => {
    const res = await upload(api, await make(), { 'content-type': type });
    expect(res.statusCode).toBe(201);
    const body = MediaUploadResponseSchema.parse(res.json());
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toBe(`${ORIGIN}/api/v1/media/${body.id}.jpg`);
    expect(isOwnMediaUrl(body.url)).toBe(true);
    expect(new URL(body.url).pathname).toMatch(MEDIA_PATH);
    expect(body).toMatchObject({ width: 640, height: 480 });

    const stored = await photoRow(api, body.id);
    expect(stored).toMatchObject({
      id: body.id,
      deviceId: DEVICE,
      routeId: null,
      unusedSince: null,
      width: 640,
      height: 480,
      bytes: body.bytes,
    });
    expect(stored?.data.length).toBe(body.bytes);
    const meta = await sharp(stored?.data).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 640, height: 480 });
    expect(stored?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('gives every photo an address of 128 random bits, even the same photo twice', async () => {
    const body = await smallJpeg();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await storePhoto(api, {}, body)).id);
    expect(ids.size).toBe(5);
    for (const id of ids) expect(Buffer.from(id, 'base64url')).toHaveLength(16);
    expect(await api.db.select().from(media)).toHaveLength(5);
  });

  it('uses the origin the server is configured with in the address', async () => {
    const local = await setupApi({ publicOrigin: 'http://localhost:5173' });
    try {
      const res = await upload(local, await smallJpeg());
      expect(res.statusCode).toBe(201);
      const { id, url } = res.json();
      expect(url).toBe(`http://localhost:5173/api/v1/media/${id}.jpg`);
      expect(isOwnMediaUrl(url)).toBe(true);
    } finally {
      await local.close();
    }
  });

  it('records the device that uploaded it', async () => {
    const { id } = await storePhoto(api, {
      'x-device-id': OTHER_DEVICE,
      'user-agent': 'Mozilla/5.0 (Android 15)',
    });
    expect((await photoRow(api, id))?.deviceId).toBe(OTHER_DEVICE);
    const [device] = await api.db.select().from(devices).where(eq(devices.id, OTHER_DEVICE));
    expect(device?.platform).toBe('android');
  });

  it('takes several photos at once', async () => {
    const body = await smallJpeg();
    const answers = await Promise.all(Array.from({ length: 6 }, () => upload(api, body)));
    expect(answers.map((res) => res.statusCode)).toEqual(Array(6).fill(201));
    expect(new Set(answers.map((res) => res.json().id)).size).toBe(6);
  });
});

describe('what the server makes of a photo', () => {
  it.each([
    ['a landscape photo', 4000, 3000, 1600, 1200],
    ['a portrait photo', 3000, 4000, 1200, 1600],
    ['a square one', 2400, 2400, 1600, 1600],
    ['a panorama', 9000, 1000, 1600, 178],
  ])('scales %s down to fit inside 1600 px', async (_name, width, height, wide, high) => {
    const res = await upload(api, await solid(width, height).jpeg().toBuffer());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: wide, height: high });
    expect(Math.max(wide, high)).toBeLessThanOrEqual(MEDIA_LIMITS.maxEdge);
    const meta = await sharp((await photoRow(api, res.json().id))?.data).metadata();
    expect(meta).toMatchObject({ width: wide, height: high });
  });

  it('never enlarges a photo that is smaller', async () => {
    for (const [width, height] of [
      [800, 600],
      [1600, 900],
      [64, 64],
      [1, 1],
    ] as const) {
      const res = await upload(api, await solid(width, height).png().toBuffer());
      expect(res.json(), `${width}x${height}`).toMatchObject({ width, height });
    }
  });

  it.each([
    [1, 300, 200, 'left'],
    [3, 300, 200, 'right'],
    [6, 200, 300, 'top'],
    [8, 200, 300, 'bottom'],
  ])('turns a photo upright by its EXIF orientation %i', async (orientation, w, h, redSide) => {
    // 300x200 as the sensor saw it: red on the left, blue on the right.
    const input = await halves(300, 200).withMetadata({ orientation }).jpeg().toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(orientation);

    const res = await upload(api, input);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: w, height: h });
    const { data } = (await photoRow(api, res.json().id)) as { data: Buffer };
    // The other half is blue, a quarter of the way in from each end.
    const near = {
      left: [w / 4, h / 2],
      right: [(3 * w) / 4, h / 2],
      top: [w / 2, h / 4],
      bottom: [w / 2, (3 * h) / 4],
    };
    const far = { left: near.right, right: near.left, top: near.bottom, bottom: near.top };
    const [rx, ry] = near[redSide as keyof typeof near] as [number, number];
    const [bx, by] = far[redSide as keyof typeof far] as [number, number];
    expect(isRed(await pixel(data, rx, ry)), `red at the ${redSide}`).toBe(true);
    expect(isBlue(await pixel(data, bx, by)), `blue opposite`).toBe(true);
    // Upright for good: the stored photo says nothing about its orientation.
    expect((await sharp(data).metadata()).orientation).toBeUndefined();
  });

  it('keeps no metadata at all: not the phone, not the GPS position, not the XMP or the colour profile', async () => {
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Someone Private</dc:creator>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    const input = await solid(800, 600)
      .withExif(GIVEAWAY_EXIF)
      .withXmp(xmp)
      .withIccProfile('p3')
      .jpeg()
      .toBuffer();
    // The upload does carry them all.
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();
    expect(input.includes('AcmePhones')).toBe(true);
    expect(input.includes('Someone Private')).toBe(true);

    const res = await upload(api, input);
    expect(res.statusCode).toBe(201);
    const { data } = (await photoRow(api, res.json().id)) as { data: Buffer };
    const after = await sharp(data).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.hasProfile).toBe(false);
    expect(after.space).toBe('srgb');
    // No marker segment that could hold any of it (EXIF, XMP, ICC, IPTC, comments).
    expect(markersOf(data).filter((marker) => APP_AND_COMMENT_MARKERS.includes(marker))).toEqual(
      [],
    );
    for (const giveaway of ['AcmePhones', 'Pixelator', 'Someone Private', 'Exif', 'xmpmeta']) {
      expect(data.includes(giveaway), giveaway).toBe(false);
    }
    // What GET serves is what is stored.
    const served = await download(api, `${res.json().id}.jpg`);
    expect(markersOf(served.rawPayload).filter((m) => APP_AND_COMMENT_MARKERS.includes(m))).toEqual(
      [],
    );
  });

  it('puts transparent parts of a PNG or WebP on white', async () => {
    const clear = {
      create: {
        width: 100,
        height: 100,
        channels: 4 as const,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    };
    for (const [type, body] of [
      ['image/png', await sharp(clear).png().toBuffer()],
      ['image/webp', await sharp(clear).webp().toBuffer()],
    ] as const) {
      const res = await upload(api, body, { 'content-type': type });
      expect(res.statusCode, type).toBe(201);
      const [r, g, b] = await pixel(
        ((await photoRow(api, res.json().id)) as { data: Buffer }).data,
        50,
        50,
      );
      expect(
        [r, g, b].every((channel) => channel > 245),
        `${type}: ${r},${g},${b}`,
      ).toBe(true);
    }
  });

  it('reads only the first frame of an animation', async () => {
    const frames = Buffer.concat(
      await Promise.all(
        [0, 1, 2].map((i) => solid(60, 40, ['#ff0000', '#00ff00', '#0000ff'][i]).raw().toBuffer()),
      ),
    );
    const animated = await sharp(frames, {
      raw: { width: 60, height: 40 * 3, channels: 3, pageHeight: 40 },
    })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(3);
    const res = await upload(api, animated, { 'content-type': 'image/webp' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: 60, height: 40 });
  });

  it('writes a JPEG smaller than the PNG it came from', async () => {
    const png = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 30 },
      },
    })
      .png()
      .toBuffer();
    const res = await upload(api, png, { 'content-type': 'image/png' });
    expect(res.statusCode).toBe(201);
    expect(res.json().bytes).toBeLessThan(png.length);
  });
});

describe('what is not a photo', () => {
  /** Real files of the kinds libvips reads and the server must not. */
  async function files() {
    const gif = await solid(20, 20).gif().toBuffer();
    const tiff = await solid(20, 20).tiff().toBuffer();
    const noisy = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .jpeg()
      .toBuffer();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>',
    );
    return { gif, tiff, noisy, svg };
  }

  it('is 415 unsupported_media: a file that is damaged, another format, text, an SVG', async () => {
    const { gif, tiff, noisy, svg } = await files();
    const cases: Array<[string, Buffer | string, string]> = [
      ['random bytes', randomBytes(3000), 'image/jpeg'],
      ['text posing as a JPEG', 'Dear diary, this is not a photo.', 'image/jpeg'],
      ['a JPEG cut short', noisy.subarray(0, noisy.length / 2), 'image/jpeg'],
      ['a JPEG with its end missing', noisy.subarray(0, noisy.length - 2000), 'image/jpeg'],
      ['a PNG that is a JPEG gone wrong', randomBytes(500), 'image/png'],
      ['a WebP that is nothing', 'RIFFxxxxWEBP', 'image/webp'],
      ['an SVG as a PNG', svg, 'image/png'],
      ['an SVG as itself', svg, 'image/svg+xml'],
      ['a GIF as a PNG', gif, 'image/png'],
      ['a GIF as itself', gif, 'image/gif'],
      ['a TIFF as a JPEG', tiff, 'image/jpeg'],
      ['nothing at all', Buffer.alloc(0), 'image/jpeg'],
      ['a text file', 'hello', 'text/plain'],
      ['JSON', '{"photo":true}', 'application/json'],
      ['a form', 'photo=1', 'application/x-www-form-urlencoded'],
      ['bytes of no kind', randomBytes(100), 'application/octet-stream'],
    ];
    for (const [name, body, type] of cases) {
      const res = await upload(api, body, { 'content-type': type });
      expect(res.statusCode, name).toBe(415);
      expect(res.json(), name).toEqual({ code: 'unsupported_media' });
      expect(res.headers['cache-control'], name).toBe('no-store');
    }
    expect(await api.db.select().from(media)).toEqual([]);
  });

  it('is 415 without a Content-Type too, and for a type with parameters it does not know', async () => {
    const noType = await api.app.inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: await smallJpeg(),
      headers: { 'x-device-id': DEVICE },
    });
    expect(noType.statusCode).toBe(415);
    expect(noType.json()).toEqual({ code: 'unsupported_media' });
    const odd = await upload(api, await smallJpeg(), { 'content-type': 'image/jpegx; q=1' });
    expect(odd.statusCode).toBe(415);
    // The type is read as the HTTP says: any case, with parameters.
    const shouting = await upload(api, await smallJpeg(), {
      'content-type': 'IMAGE/JPEG; charset=binary',
    });
    expect(shouting.statusCode).toBe(201);
  });

  it('is 415 for a photo of more pixels than the server decodes, however few bytes it takes', async () => {
    // 56 megapixels of one colour: under a megabyte as a PNG, a quarter of a gigabyte once decoded.
    const bomb = await solid(8000, 7000).png().toBuffer();
    expect(8000 * 7000).toBeGreaterThan(MAX_INPUT_PIXELS);
    expect(bomb.length).toBeLessThan(MEDIA_LIMITS.maxUploadBytes);
    const res = await upload(api, bomb, { 'content-type': 'image/png' });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ code: 'unsupported_media' });
  });

  it('never hands a file to the loaders of the formats it does not take', async () => {
    // Not only refused after being read: libvips cannot read them here at all.
    const { gif, tiff, svg } = await files();
    for (const [name, file] of [
      ['a GIF', gif],
      ['a TIFF', tiff],
      ['an SVG', svg],
    ] as const) {
      await expect(sharp(file).metadata(), name).rejects.toThrow(/unsupported image format/);
    }
    const jpeg = await smallJpeg();
    const png = await solid(8, 8).png().toBuffer();
    const webp = await solid(8, 8).webp().toBuffer();
    expect((await sharp(jpeg).metadata()).format).toBe('jpeg');
    expect((await sharp(png).metadata()).format).toBe('png');
    expect((await sharp(webp).metadata()).format).toBe('webp');
  });

  it('says nothing about the file: the answer is the same code for every one', async () => {
    const { svg } = await files();
    const a = await upload(api, svg, { 'content-type': 'image/png' });
    const b = await upload(api, randomBytes(64), { 'content-type': 'image/jpeg' });
    expect(a.body).toBe(b.body);
    expect(a.body).toBe('{"code":"unsupported_media"}');
  });
});

describe('what an upload may weigh', () => {
  it('is 413 payload_too_large past 4 MB, without reading it', async () => {
    const res = await upload(api, Buffer.alloc(MEDIA_LIMITS.maxUploadBytes + 1));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ code: 'payload_too_large' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await api.db.select().from(media)).toEqual([]);
  });

  it('takes up to 4 MB: a body of exactly that size gets as far as being decoded', async () => {
    const res = await upload(api, Buffer.alloc(MEDIA_LIMITS.maxUploadBytes));
    expect(res.statusCode).toBe(415);
  });

  it('takes a large photo that fits: noise at 3 MP is a few MB of JPEG', async () => {
    const noisy = await sharp({
      create: {
        width: 2048,
        height: 1536,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 70 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(1_000_000);
    expect(noisy.length).toBeLessThan(MEDIA_LIMITS.maxUploadBytes);
    const res = await upload(api, noisy);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: 1600, height: 1200 });
    expect(res.json().bytes).toBeLessThan(MEDIA_LIMITS.maxUploadBytes);
  });
});

describe('who may upload', () => {
  it('wants the device id: 400 missing_device_id, before the body is read', async () => {
    for (const headers of [
      { 'x-device-id': '' },
      { 'x-device-id': 'me' },
      { 'x-device-id': '123' },
    ]) {
      const res = await upload(api, await smallJpeg(), headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(400);
      expect(res.json()).toEqual({ code: 'missing_device_id' });
    }
    const none = await api.app.inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: await smallJpeg(),
      headers: { 'content-type': JPEG },
    });
    expect(none.statusCode).toBe(400);
    expect(none.json()).toEqual({ code: 'missing_device_id' });
    // Not a 413 or a 415 either: nobody is anybody yet.
    const huge = await api.app.inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: Buffer.alloc(MEDIA_LIMITS.maxUploadBytes + 1),
      headers: { 'content-type': 'text/plain' },
    });
    expect(huge.json()).toEqual({ code: 'missing_device_id' });
    expect(await api.db.select().from(media)).toEqual([]);
  });
});

describe('the limits', () => {
  let other: Api | undefined;
  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it('count uploads per address, whatever device id they carry, failures included: 429 with Retry-After', async () => {
    other = await setupApi({ mediaRateLimitPerMinute: 3 });
    const body = await smallJpeg();
    expect((await upload(other, body, { 'x-device-id': randomUUID() })).statusCode).toBe(201);
    expect((await upload(other, body, { 'x-device-id': randomUUID() })).statusCode).toBe(201);
    // A failed upload costs one too.
    expect((await upload(other, 'nope', { 'x-device-id': randomUUID() })).statusCode).toBe(415);
    const limited = await upload(other, body, { 'x-device-id': randomUUID() });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
    // The address limit comes before everything else.
    const anonymous = await upload(other, body, { 'x-device-id': '' });
    expect(anonymous.statusCode).toBe(429);
    // Someone else is not affected.
    expect((await upload(other, body, {}, '203.0.113.9')).statusCode).toBe(201);
    expect(await other.db.select().from(media)).toHaveLength(3);
  });

  it('count photos per device in 24 hours: 429 with the time to wait', async () => {
    other = await setupApi({ mediaUploadsPerDevicePerDay: 2 });
    const body = await smallJpeg();
    const first = await storePhoto(other, {}, body);
    // Photos that could not be read cost nothing.
    expect((await upload(other, 'nope')).statusCode).toBe(415);
    await storePhoto(other, {}, body);

    const limited = await upload(other, body);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(limited.headers['cache-control']).toBe('no-store');
    // The day counts from the first of the two: just short of 24 hours from now.
    const wait = Number(limited.headers['retry-after']);
    expect(wait).toBeGreaterThan(24 * 3600 - 120);
    expect(wait).toBeLessThanOrEqual(24 * 3600);

    // Another device has its own day.
    expect((await upload(other, body, { 'x-device-id': OTHER_DEVICE })).statusCode).toBe(201);

    // The oldest photo is 23 hours old: still in the day. At 25 hours it is out.
    const old = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    await other.db
      .update(media)
      .set({ createdAt: old(23) })
      .where(eq(media.id, first.id));
    expect((await upload(other, body)).statusCode).toBe(429);
    await other.db
      .update(media)
      .set({ createdAt: old(25) })
      .where(eq(media.id, first.id));
    expect((await upload(other, body)).statusCode).toBe(201);
    expect((await upload(other, body)).statusCode).toBe(429);
  });

  it('keep the photos below MEDIA_MAX_TOTAL_MB in all: 503 unavailable once they fill it', async () => {
    other = await setupApi({ mediaMaxTotalMb: 1 });
    const cap = 1024 * 1024;
    const body = await smallJpeg();
    // 100 bytes short of the cap: one more fits (the cap is checked before the photo is read).
    const filler = await insertPhoto(other, { bytes: cap - 100, deviceId: OTHER_DEVICE });
    const last = await upload(other, body);
    expect(last.statusCode).toBe(201);

    const full = await upload(other, body);
    expect(full.statusCode).toBe(503);
    expect(full.json()).toEqual({ code: 'unavailable' });
    expect(full.headers['cache-control']).toBe('no-store');
    expect(await other.db.select().from(media)).toHaveLength(2);
    // What is stored is still served, and room opens as photos go.
    expect((await download(other, `${last.json().id}.jpg`)).statusCode).toBe(200);
    await other.db.delete(media).where(eq(media.id, filler));
    expect((await upload(other, body)).statusCode).toBe(201);
  });

  it('answer 503 unavailable while the database is not ready', async () => {
    const config = { ...loadConfig({}), adminToken: ADMIN_TOKEN };
    const app = await buildApp(config, { database: null, data: () => null }, { logger: false });
    try {
      const id = randomBytes(16).toString('base64url');
      for (const res of [
        await app.inject({
          method: 'POST',
          url: '/api/v1/media',
          payload: await smallJpeg(),
          headers: { 'x-device-id': DEVICE, 'content-type': JPEG },
        }),
        await app.inject({ method: 'GET', url: `/api/v1/media/${id}.jpg` }),
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/media/${id}`,
          headers: { authorization: BEARER },
        }),
      ]) {
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ code: 'unavailable' });
      }
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/v1/media/:file', () => {
  it('serves the stored bytes as a JPEG that is cached for ever, and shows nothing but the image', async () => {
    const { id, bytes } = await storePhoto(api);
    const res = await download(api, `${id}.jpg`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(((await photoRow(api, id)) as { data: Buffer }).data)).toBe(true);
    expect(res.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'content-length': String(bytes),
      'cache-control': 'public, max-age=86400',
      etag: `"${id}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await sharp(res.rawPayload).metadata()).format).toBe('jpeg');
  });

  it('asks for no device id and no token', async () => {
    const { id } = await storePhoto(api);
    const variants: Array<Record<string, string>> = [
      {},
      { 'x-device-id': OTHER_DEVICE },
      { 'x-device-id': 'rubbish' },
    ];
    for (const headers of variants) {
      expect((await download(api, `${id}.jpg`, headers)).statusCode, JSON.stringify(headers)).toBe(
        200,
      );
    }
  });

  it('answers a HEAD with the headers and no bytes', async () => {
    const { id, bytes } = await storePhoto(api);
    const res = await api.app.inject({ method: 'HEAD', url: `/api/v1/media/${id}.jpg` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(res.headers).toMatchObject({ 'content-type': 'image/jpeg', etag: `"${id}"` });
    expect(Number(res.headers['content-length'])).toBe(bytes);
  });

  it('answers 304, without the bytes, to a client that has them', async () => {
    const { id } = await storePhoto(api);
    const res = await download(api, `${id}.jpg`, { 'if-none-match': `"${id}"` });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.headers).toMatchObject({
      etag: `"${id}"`,
      'cache-control': 'public, max-age=86400',
    });
    // Another photo's ETag is not this one's.
    const other = await storePhoto(api);
    const full = await download(api, `${id}.jpg`, { 'if-none-match': `"${other.id}"` });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.length).toBeGreaterThan(0);
  });

  it('answers 404 not_found for a photo that does not exist or is gone, never from a cache', async () => {
    const { id } = await storePhoto(api);
    const unknown = `${randomBytes(16).toString('base64url')}.jpg`;
    for (const [file, headers] of [
      [unknown, {}],
      // A client that has a photo asks whether it still exists.
      [`${id}.jpg`, { 'if-none-match': `"${id}"` }],
    ] as const) {
      if (file === `${id}.jpg`) await api.db.delete(media).where(eq(media.id, id));
      const res = await download(api, file, headers);
      expect(res.statusCode, file).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.etag).toBeUndefined();
    }
  });

  it('answers 400 validation_failed for a name that cannot be a stored photo', async () => {
    const { id } = await storePhoto(api);
    for (const file of [
      'short.jpg',
      `${id}.png`,
      `${id}.jpeg`,
      id,
      `${id}x.jpg`,
      `${'A'.repeat(21)}.jpg`,
      `${'A'.repeat(22)}%2F.jpg`,
      '..%2F..%2Fetc%2Fpasswd',
    ]) {
      const res = await download(api, file);
      expect(res.statusCode, file).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });
});

describe('DELETE /api/v1/admin/media/:id', () => {
  const remove = (id: string, authorization?: string) =>
    api.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/media/${id}`,
      headers: authorization === undefined ? {} : { authorization },
    });

  it('deletes a photo for good: 204, and its address then answers 404', async () => {
    const { id } = await storePhoto(api);
    const keep = await storePhoto(api);
    const res = await remove(id, BEARER);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await photoRow(api, id)).toBeUndefined();
    expect((await download(api, `${id}.jpg`)).statusCode).toBe(404);
    // Only that one.
    expect(await photoRow(api, keep.id)).toBeDefined();
    expect((await download(api, `${keep.id}.jpg`)).statusCode).toBe(200);
  });

  it('answers 404 not_found for a photo that does not exist, and for one already deleted', async () => {
    const { id } = await storePhoto(api);
    expect((await remove(id, BEARER)).statusCode).toBe(204);
    for (const missing of [id, randomBytes(16).toString('base64url')]) {
      const res = await remove(missing, BEARER);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found' });
    }
  });

  it('wants the operator’s token, like the other admin endpoints, and touches nothing without it', async () => {
    const { id } = await storePhoto(api);
    for (const authorization of [
      undefined,
      '',
      'Bearer',
      'Bearer nope',
      `Bearer ${ADMIN_TOKEN}x`,
      ADMIN_TOKEN,
    ]) {
      const res = await remove(id, authorization);
      expect(res.statusCode, String(authorization)).toBe(403);
      expect(res.json()).toEqual({ code: 'forbidden' });
    }
    expect(await photoRow(api, id)).toBeDefined();
    // Nobody who uploaded it can delete it either.
    const own = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/media/${id}`,
      headers: { 'x-device-id': DEVICE },
    });
    expect(own.statusCode).toBe(403);
  });

  it('does not exist without a usable ADMIN_TOKEN: 404', async () => {
    const { id } = await storePhoto(api);
    for (const adminToken of [null, 'x'.repeat(31)]) {
      const off = await setupApi({ adminToken });
      try {
        const res = await off.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/media/${id}`,
          headers: { authorization: BEARER },
        });
        expect(res.statusCode, String(adminToken)).toBe(404);
        expect(res.json()).toEqual({ code: 'not_found' });
      } finally {
        await off.close();
      }
    }
  });

  it('checks the token before the id, and wants the 22 characters of an id', async () => {
    const { id } = await storePhoto(api);
    expect((await remove('BAD_ID', 'Bearer nope')).statusCode).toBe(403);
    for (const bad of ['BAD_ID', `${id}.jpg`, `${id}x`, 'A'.repeat(21)]) {
      const res = await remove(bad, BEARER);
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
    expect(await photoRow(api, id)).toBeDefined();
  });

  it('shares its budget with the other admin endpoints, wrong tokens included', async () => {
    const limited = await setupApi({ adminToken: ADMIN_TOKEN, adminRateLimitPerMinute: 3 });
    try {
      const id = randomBytes(16).toString('base64url');
      const call = (authorization: string, url = `/api/v1/admin/media/${id}`) =>
        limited.app.inject({ method: 'DELETE', url, headers: { authorization } });
      expect((await call('Bearer nope')).statusCode).toBe(403);
      expect((await call(BEARER)).statusCode).toBe(404);
      expect(
        (
          await limited.app.inject({
            method: 'GET',
            url: '/api/v1/admin/moderation',
            headers: { authorization: BEARER },
          })
        ).statusCode,
      ).toBe(200);
      const res = await call(BEARER);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ code: 'rate_limited' });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});

describe('what the log keeps', () => {
  /** The media routes on their own, logging to `lines`. */
  async function loggedApp(lines: string[]) {
    const app = Fastify({
      logger: {
        level: 'info',
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
          },
        }),
      },
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    installErrorHandling(app);
    await app.register(rateLimit, { global: false });
    const admin = adminGuard(app, { adminToken: ADMIN_TOKEN, rateLimitPerMinute: 100 });
    await app.register(mediaRoutes, {
      database: () => api.database,
      admin,
      publicOrigin: ORIGIN,
      rateLimitPerMinute: 100,
      uploadsPerDevicePerDay: 100,
      maxTotalBytes: 100 * 1024 * 1024,
    });
    return app;
  }

  it('is the id and the sizes of a stored photo, and nothing of the photo, the phone or the device', async () => {
    const lines: string[] = [];
    const app = await loggedApp(lines);
    try {
      const input = await solid(2000, 1000).withExif(GIVEAWAY_EXIF).jpeg().toBuffer();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/media',
        payload: input,
        headers: { 'x-device-id': DEVICE, 'content-type': JPEG, 'user-agent': 'Secret Phone 5' },
      });
      expect(res.statusCode).toBe(201);
      const { id, bytes } = res.json();
      // A file the server could not read leaves no trace of what it was.
      await app.inject({
        method: 'POST',
        url: '/v1/media',
        payload: 'Dear diary',
        headers: { 'x-device-id': DEVICE, 'content-type': JPEG },
      });
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const stored = entries.filter((entry) => entry.msg === 'photo stored');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        level: 30,
        mediaId: id,
        inputBytes: input.length,
        bytes,
        width: 1600,
        height: 800,
      });
      expect(Object.keys(stored[0] ?? {}).sort()).toEqual(
        [
          'bytes',
          'height',
          'hostname',
          'inputBytes',
          'level',
          'mediaId',
          'msg',
          'pid',
          'reqId',
          'time',
          'width',
        ].sort(),
      );
      const log = lines.join('');
      for (const secret of [DEVICE, 'AcmePhones', 'Secret Phone', 'Dear diary']) {
        expect(log, secret).not.toContain(secret);
      }
      expect(entries.filter((entry) => (entry.level as number) >= 40)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('says that the operator deleted a photo, with its id', async () => {
    const lines: string[] = [];
    const app = await loggedApp(lines);
    try {
      const { id } = await storePhoto(api);
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/admin/media/${id}`,
        headers: { authorization: BEARER },
      });
      expect(res.statusCode).toBe(204);
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const deleted = entries.filter((entry) => entry.msg === 'media deleted by the operator');
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ level: 30, mediaId: id });
      expect(lines.join('')).not.toContain(ADMIN_TOKEN);
    } finally {
      await app.close();
    }
  });
});

describe('the API description', () => {
  it('documents the three endpoints, the photo as raw bytes', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    const { paths } = res.json();
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining(['/v1/media', '/v1/media/{file}', '/v1/admin/media/{id}']),
    );

    const post = paths['/v1/media'].post;
    expect(Object.keys(post.requestBody.content).sort()).toEqual([...MEDIA_LIMITS.types].sort());
    for (const type of MEDIA_LIMITS.types) {
      expect(post.requestBody.content[type].schema).toMatchObject({
        type: 'string',
        format: 'binary',
      });
    }
    expect(Object.keys(post.responses)).toEqual(['201']);
    expect(
      Object.keys(post.responses['201'].content['application/json'].schema.properties),
    ).toEqual(['id', 'url', 'width', 'height', 'bytes']);

    const get = paths['/v1/media/{file}'].get;
    expect(get.parameters[0]).toMatchObject({ name: 'file', in: 'path', required: true });
    expect(Object.keys(get.responses['200'].content)).toEqual(['image/jpeg']);

    expect(Object.keys(paths['/v1/admin/media/{id}'])).toEqual(['delete']);
  });
});
