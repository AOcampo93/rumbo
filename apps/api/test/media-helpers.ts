import { randomBytes } from 'node:crypto';
import type { MediaUploadResponse } from '@rumbo/api-contract';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { media } from '../src/db/schema.js';
import type { Api, Headers } from './community-helpers.js';
import { DEVICE } from './helpers.js';

// What the tests of the route covers (phase 7.3) share: photos made with sharp
// (real files, not fixtures), the upload call, and the rows they leave.

export type { Api };

export const JPEG = 'image/jpeg';

const RED = '#c0392b';
const BLUE = '#2980b9';

/** A solid-colour image: the sharp pipeline to encode it in the format a test needs. */
export const solid = (width: number, height: number, background: string = RED) =>
  sharp({ create: { width, height, channels: 3, background } });

/** An image whose left half is red and whose right half is blue: where things end up shows how it was turned. */
export const halves = (width: number, height: number) =>
  solid(width, height, RED).composite([
    {
      input: { create: { width: width / 2, height, channels: 3, background: BLUE } },
      left: width / 2,
      top: 0,
    },
  ]);

/** The upload body the tests send most: a small JPEG. */
export const smallJpeg = (width = 300, height = 200) => solid(width, height).jpeg().toBuffer();

/** An EXIF block that gives away who took the photo and where: the phone and the GPS position. */
export const GIVEAWAY_EXIF = {
  IFD0: { Make: 'AcmePhones', Model: 'Pixelator 9000', Software: 'Camera 12.3' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '39/1 44/1 4600/100',
    GPSLongitudeRef: 'W',
    GPSLongitude: '8/1 48/1 3000/100',
  },
};

/** POST /media as the app does it. */
export const upload = (
  api: Api,
  body: Buffer | string,
  headers: Headers = {},
  remoteAddress?: string,
) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/media',
    payload: body,
    headers: { 'x-device-id': DEVICE, 'content-type': JPEG, ...headers },
    ...(remoteAddress ? { remoteAddress } : {}),
  });

/** Uploads a small photo and gives back what the server answered. */
export async function storePhoto(
  api: Api,
  headers: Headers = {},
  body?: Buffer,
): Promise<MediaUploadResponse> {
  const res = await upload(api, body ?? (await smallJpeg()), headers);
  if (res.statusCode !== 201) throw new Error(`could not upload a photo: ${res.body}`);
  return res.json();
}

/** GET /media/<file>. */
export const download = (api: Api, file: string, headers: Headers = {}) =>
  api.app.inject({ method: 'GET', url: `/api/v1/media/${file}`, headers });

/** The photo's row, with its bytes. */
export const photoRow = async (api: Api, id: string) =>
  (await api.db.select().from(media).where(eq(media.id, id)))[0];

/** The row of a photo the server never made, for the tests of the limits and the cleanup. */
export async function insertPhoto(api: Api, overrides: Partial<typeof media.$inferInsert> = {}) {
  const id = randomBytes(16).toString('base64url');
  const data = Buffer.from('not really a photo');
  await api.db.insert(media).values({
    id,
    deviceId: DEVICE,
    data,
    bytes: data.length,
    width: 10,
    height: 10,
    ...overrides,
  });
  return id;
}
