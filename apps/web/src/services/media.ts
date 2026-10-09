import {
  isOwnMediaUrl,
  MEDIA_LIMITS,
  type MediaUploadResponse,
  MediaUploadResponseSchema,
} from '@rumbo/api-contract';
import { api, apiErrorCode } from './api.ts';

// A route's cover photo (phase 7.3, ADR 0005). The phone does the heavy work:
// it decodes the photo upright (EXIF orientation applied), scales it to
// MEDIA_LIMITS.maxEdge on its longest side and re-encodes it as a JPEG, which
// also drops every piece of metadata (the GPS position above all). Then POST
// /media stores it and answers where it is served; that url is the route's
// `coverImage.url`. The browser-bound step (decoding and drawing) hides behind
// PhotoDeps so tests don't need a canvas.

/** Quality of the JPEG the phone makes: plenty for a card's cover, a few hundred KB. */
export const PHOTO_QUALITY = 0.85;
/** More patience than other calls: a photo on a slow mobile link takes a while. */
const UPLOAD_TIMEOUT_MS = 45_000;

export type MediaErrorCode =
  /** No connection. */
  | 'offline'
  /** Not a photo this browser (or the server) can read. */
  | 'unsupported'
  | 'too_large'
  | 'rate_limited'
  /** The server has no room (or no database) for photos right now. */
  | 'unavailable'
  | 'failed';

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode) {
    super(`The photo could not be used: ${code}`);
    this.name = 'MediaError';
    this.code = code;
  }
}

/**
 * The size of a `width` × `height` photo scaled down so that its longest side is
 * at most `maxEdge` pixels, keeping its proportions. Never scaled up.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (Math.max(width, height) <= maxEdge) return { width, height };
  // The longest side is exactly maxEdge; the other one is rounded (and at least a pixel).
  if (width >= height) {
    return { width: maxEdge, height: Math.max(1, Math.round((height * maxEdge) / width)) };
  }
  return { width: Math.max(1, Math.round((width * maxEdge) / height)), height: maxEdge };
}

/** A photo the browser decoded, upright. */
export interface DecodedPhoto {
  width: number;
  height: number;
  /** Draws it at `width` × `height` over white and exports it as a JPEG. */
  toJpeg(width: number, height: number, quality: number): Promise<Blob>;
  /** Frees what the browser holds for it. Called once, when the photo is no longer needed. */
  close(): void;
}

/** The browser-bound pieces of scalePhoto, swappable for tests. */
export interface PhotoDeps {
  /** Rejects when the file isn't an image the browser can decode. */
  decode(file: Blob): Promise<DecodedPhoto>;
}

/**
 * Decodes with createImageBitmap (honouring the photo's orientation) and, where
 * it can't, with an <img> element, which browsers also show upright.
 */
async function openImage(file: Blob): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // An older browser that doesn't know the option, or a photo it can't read: the <img> tries too.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

function drawToJpeg(
  image: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new MediaError('failed'));
  // A JPEG has no transparency: the clear pixels of a PNG would turn black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Safari keeps a canvas' memory until it is resized.
        canvas.width = 0;
        canvas.height = 0;
        if (blob && blob.size > 0) resolve(blob);
        else reject(new MediaError('failed'));
      },
      'image/jpeg',
      quality,
    );
  });
}

const browserPhoto: PhotoDeps = {
  async decode(file) {
    const opened = await openImage(file);
    return {
      width: opened.width,
      height: opened.height,
      toJpeg: (width, height, quality) => drawToJpeg(opened.image, width, height, quality),
      close: opened.close,
    };
  },
};

/**
 * The JPEG to upload for a photo the user picked: upright, at most
 * MEDIA_LIMITS.maxEdge on its longest side and without any metadata. Rejects
 * with a MediaError: 'unsupported' when the browser can't read the file.
 */
export async function scalePhoto(file: Blob, deps: PhotoDeps = browserPhoto): Promise<Blob> {
  let photo: DecodedPhoto;
  try {
    photo = await deps.decode(file);
  } catch {
    throw new MediaError('unsupported');
  }
  try {
    if (!(photo.width > 0 && photo.height > 0)) throw new MediaError('unsupported');
    const size = fitWithin(photo.width, photo.height, MEDIA_LIMITS.maxEdge);
    let jpeg: Blob;
    try {
      jpeg = await photo.toJpeg(size.width, size.height, PHOTO_QUALITY);
    } catch (error) {
      throw error instanceof MediaError ? error : new MediaError('failed');
    }
    if (jpeg.size > MEDIA_LIMITS.maxUploadBytes) throw new MediaError('too_large');
    return jpeg;
  } finally {
    photo.close();
  }
}

/** What the server's refusal says about the photo (its code, or the status when a proxy answered). */
async function errorFor(response: Response): Promise<MediaErrorCode> {
  const code = await apiErrorCode(response);
  if (code === 'unsupported_media' || response.status === 415) return 'unsupported';
  if (code === 'payload_too_large' || response.status === 413) return 'too_large';
  if (code === 'rate_limited' || response.status === 429) return 'rate_limited';
  if (code === 'unavailable' || response.status === 503) return 'unavailable';
  return 'failed';
}

/**
 * POST /media: stores the photo (a JPEG from scalePhoto) and answers where it
 * is served. Rejects with a MediaError, or with the caller's own AbortError
 * when `signal` aborts (the user left the screen).
 */
export async function uploadPhoto(
  photo: Blob,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<MediaUploadResponse> {
  const { signal } = options;
  if (photo.size > MEDIA_LIMITS.maxUploadBytes) throw new MediaError('too_large');
  let response: Response;
  try {
    response = await api('/media', {
      method: 'POST',
      blob: photo,
      device: true,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MediaError(globalThis.navigator?.onLine === false ? 'offline' : 'failed');
  }
  if (!response.ok) throw new MediaError(await errorFor(response));
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new MediaError('failed');
  }
  const parsed = MediaUploadResponseSchema.safeParse(json);
  // A url the route would be refused with is no use: better to say so now.
  if (!parsed.success || !isOwnMediaUrl(parsed.data.url)) throw new MediaError('failed');
  return parsed.data;
}
