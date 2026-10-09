import { MEDIA_LIMITS } from '@rumbo/api-contract';
import sharp from 'sharp';
import { fail } from '../errors.js';

// What the server makes of an uploaded photo (phase 7.3, ADR 0005): a JPEG of
// at most MEDIA_LIMITS.maxEdge pixels on its longest side, upright, with no
// metadata at all: neither the GPS position nor the phone's model, nor an ICC
// profile, nor a thumbnail. The upload is untrusted input to a native image
// library, so it is held to a few formats and a size, and never trusted to be
// what its Content-Type says.

/** Pixels (width x height) of the largest upload decoded: a PNG of a few KB can declare billions. */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * How the stored JPEG is encoded. mozjpeg makes smaller files at the same
 * quality, which matters: the photos take database space.
 */
const JPEG = { quality: 82, mozjpeg: true } as const;

/**
 * 'error' aborts on a truncated or corrupt file but lets the warnings through:
 * phones and editors write files that libjpeg and libpng complain about and
 * that are fine photos.
 */
const INPUT = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS } as const;

/** The only formats decoded: what POST /media takes. */
const DECODED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

// libvips knows many more formats than these three (SVG, TIFF, GIF, AVIF…).
// Their loaders are blocked, so a file that only claims to be a photo never
// reaches one of them.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
  operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer', 'VipsForeignLoadWebpBuffer'],
});

export interface Photo {
  /** The JPEG to store. */
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Runs a call into the library. Whatever it says about a file it can't read
 * (also what it throws at once, for an empty buffer) is of no use to anyone:
 * 415 and nothing else.
 */
async function reading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw fail(415, 'unsupported_media');
  }
}

/**
 * Decodes the upload, turns it upright by its EXIF orientation, scales it down
 * to fit inside MEDIA_LIMITS.maxEdge (never up), flattens any transparency onto
 * white and encodes it as a JPEG without metadata. Anything that is not a
 * readable JPEG, PNG or WebP of a sane size is 415 `unsupported_media`.
 */
export async function processPhoto(upload: Buffer): Promise<Photo> {
  // The header alone says what the file is; an animation's later frames are never read.
  const { format } = await reading(() => sharp(upload, INPUT).metadata());
  if (format === undefined || !DECODED_FORMATS.has(format)) throw fail(415, 'unsupported_media');

  const { data, info } = await reading(() =>
    sharp(upload, INPUT)
      .autoOrient()
      .resize({
        width: MEDIA_LIMITS.maxEdge,
        height: MEDIA_LIMITS.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg(JPEG)
      .toBuffer({ resolveWithObject: true }),
  );
  return { data, width: info.width, height: info.height };
}
