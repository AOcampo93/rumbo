import 'fake-indexeddb/auto';
import { MEDIA_LIMITS } from '@rumbo/api-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DecodedPhoto,
  fitWithin,
  MediaError,
  PHOTO_QUALITY,
  type PhotoDeps,
  scalePhoto,
  uploadPhoto,
} from '../src/services/media.ts';

// A route's cover photo (phase 7.3, ADR 0005): the phone scales it to at most
// 1600 px on its longest side and re-encodes it as a JPEG (which drops the
// EXIF and the GPS position), then POST /media stores it. happy-dom has no
// canvas, so the browser-bound step is swapped for a fake, and the real one is
// checked against stubs of createImageBitmap and the canvas.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const OWN_URL = 'https://rumbo.test/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg';
const STORED = { id: 'AAAAAAAAAAAAAAAAAAAAAA', url: OWN_URL, width: 1600, height: 1200, bytes: 4 };

const jpeg = (bytes = 4) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const picked = () => new File([new Uint8Array(8)], 'IMG_0001.HEIC', { type: 'image/heic' });

/** URL.createObjectURL and revokeObjectURL, swapped for the photo's test and put back afterwards. */
const objectUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
function stubObjectUrls(url: string) {
  const created = vi.fn(() => url);
  const revoked = vi.fn();
  URL.createObjectURL = created;
  URL.revokeObjectURL = revoked;
  return { created, revoked };
}

afterEach(() => {
  URL.createObjectURL = objectUrls.create;
  URL.revokeObjectURL = objectUrls.revoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitWithin', () => {
  const max = MEDIA_LIMITS.maxEdge;

  it('scales a photo down until its longest side is the limit, keeping its proportions', () => {
    expect(fitWithin(4000, 3000, max)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, max)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(4032, 3024, max)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(2000, 2000, max)).toEqual({ width: 1600, height: 1600 });
    // A 12 MP iPhone photo: the other side is rounded to the nearest pixel.
    expect(fitWithin(4284, 5712, max)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(5000, 3333, max)).toEqual({ width: 1600, height: 1067 });
  });

  it('never scales a photo up, nor touches one that already fits', () => {
    expect(fitWithin(1600, 900, max)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(800, 600, max)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 1, max)).toEqual({ width: 1, height: 1 });
  });

  it('leaves a pixel on the short side of a very long photo', () => {
    expect(fitWithin(10_000, 3, max)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(3, 10_000, max)).toEqual({ width: 1, height: 1600 });
  });
});

describe('scalePhoto, with a decoder of its own', () => {
  function decoder(
    width: number,
    height: number,
    result: () => Promise<Blob> = async () => jpeg(),
  ) {
    const photo: DecodedPhoto = {
      width,
      height,
      toJpeg: vi.fn(result),
      close: vi.fn(),
    };
    const deps: PhotoDeps = { decode: vi.fn(async () => photo) };
    return { photo, deps };
  }

  it('asks for a JPEG of the scaled size at the quality of a card cover, and lets the photo go', async () => {
    const { photo, deps } = decoder(4000, 3000);
    const file = picked();
    const result = await scalePhoto(file, deps);
    expect(deps.decode).toHaveBeenCalledWith(file);
    expect(photo.toJpeg).toHaveBeenCalledWith(1600, 1200, PHOTO_QUALITY);
    expect(PHOTO_QUALITY).toBe(0.85);
    expect(result.type).toBe('image/jpeg');
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('re-encodes a small photo too (it is what drops the metadata), at its own size', async () => {
    const { photo, deps } = decoder(800, 600);
    await scalePhoto(picked(), deps);
    expect(photo.toJpeg).toHaveBeenCalledWith(800, 600, PHOTO_QUALITY);
  });

  it('says "unsupported" for a file the browser cannot decode', async () => {
    const deps: PhotoDeps = {
      decode: vi.fn(async () => Promise.reject(new Error('EncodingError'))),
    };
    await expect(scalePhoto(picked(), deps)).rejects.toMatchObject({
      name: 'MediaError',
      code: 'unsupported',
    });
  });

  it('says "unsupported" for an image with no size, and still lets it go', async () => {
    const { photo, deps } = decoder(0, 0);
    await expect(scalePhoto(picked(), deps)).rejects.toMatchObject({ code: 'unsupported' });
    expect(photo.toJpeg).not.toHaveBeenCalled();
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('says "failed" when the photo cannot be drawn, and still lets it go', async () => {
    const { photo, deps } = decoder(4000, 3000, async () =>
      Promise.reject(new Error('out of memory')),
    );
    await expect(scalePhoto(picked(), deps)).rejects.toMatchObject({ code: 'failed' });
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the reason of its own errors', async () => {
    const { deps } = decoder(4000, 3000, async () => Promise.reject(new MediaError('too_large')));
    await expect(scalePhoto(picked(), deps)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('refuses a JPEG the server would not take, before anything is sent', async () => {
    const { photo, deps } = decoder(4000, 3000, async () => jpeg(MEDIA_LIMITS.maxUploadBytes + 1));
    await expect(scalePhoto(picked(), deps)).rejects.toMatchObject({ code: 'too_large' });
    expect(photo.close).toHaveBeenCalledTimes(1);
  });
});

describe("scalePhoto, in the browser's own way", () => {
  /** A canvas that records what is drawn on it, and exports whatever `exported` says. */
  function fakeCanvas(exported: Blob | null = jpeg(10)) {
    const calls: Array<[string, ...unknown[]]> = [];
    const context = {
      fillStyle: '',
      imageSmoothingQuality: '',
      fillRect: (...args: unknown[]) => calls.push(['fillRect', context.fillStyle, ...args]),
      drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args]),
    };
    const canvas = {
      width: 300,
      height: 150,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((done: (blob: Blob | null) => void, type: string, quality: number) => {
        calls.push(['toBlob', type, quality, canvas.width, canvas.height]);
        done(exported);
      }),
    };
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : create(tag)) as typeof document.createElement);
    return { canvas, context, calls };
  }

  it('decodes upright with createImageBitmap, draws over white at the scaled size and exports a JPEG', async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { canvas, context, calls } = fakeCanvas();
    const file = picked();

    const result = await scalePhoto(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    // White first (a JPEG has no transparency), then the photo, scaled, and the export.
    expect(calls).toEqual([
      ['fillRect', '#fff', 0, 0, 1600, 1200],
      ['drawImage', bitmap, 0, 0, 1600, 1200],
      ['toBlob', 'image/jpeg', 0.85, 1600, 1200],
    ]);
    expect(context.imageSmoothingQuality).toBe('high');
    // The canvas gives its memory back once exported (Safari keeps it otherwise).
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(10);
  });

  it('falls back to an <img> where createImageBitmap is missing or refuses the option', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const urls = stubObjectUrls('blob:photo');
    const images: Array<{ src: string }> = [];
    class FakeImage {
      src = '';
      naturalWidth = 2400;
      naturalHeight = 1800;
      constructor() {
        images.push(this);
      }
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const { calls } = fakeCanvas();

    await scalePhoto(picked());

    expect(images.map((image) => image.src)).toEqual(['blob:photo']);
    expect(calls.map(([name]) => name)).toEqual(['fillRect', 'drawImage', 'toBlob']);
    expect(calls[2]).toEqual(['toBlob', 'image/jpeg', 0.85, 1600, 1200]);
    expect(urls.revoked).toHaveBeenCalledWith('blob:photo');
  });

  it('says "unsupported" when neither way can read the file', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new DOMException('The source image could not be decoded.'))),
    );
    const urls = stubObjectUrls('blob:broken');
    class BrokenImage {
      src = '';
      decode() {
        return Promise.reject(new DOMException('Encoding error', 'EncodingError'));
      }
    }
    vi.stubGlobal('Image', BrokenImage);
    await expect(scalePhoto(picked())).rejects.toMatchObject({ code: 'unsupported' });
    expect(urls.revoked).toHaveBeenCalledWith('blob:broken');
  });

  it('says "failed" when the canvas cannot be used or exports nothing', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 100, height: 100, close() {} })),
    );
    fakeCanvas(null);
    await expect(scalePhoto(picked())).rejects.toMatchObject({ code: 'failed' });

    vi.restoreAllMocks();
    const { canvas } = fakeCanvas();
    canvas.getContext.mockReturnValue(null as never);
    await expect(scalePhoto(picked())).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('uploadPhoto', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  function stubFetch(
    answer: (init: RequestInit) => Promise<Response> | Response = () => json(STORED, 201),
  ) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => answer(init));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('POSTs the photo as the body, as a JPEG, with the device id, and returns where it is served', async () => {
    const fetchMock = stubFetch();
    const photo = jpeg(1234);
    const stored = await uploadPhoto(photo);
    expect(stored).toEqual(STORED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/media');
    expect(init).toMatchObject({ method: 'POST', body: photo });
    expect(init?.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'x-device-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  const refusals: Array<[string, Response, string]> = [
    ['an unreadable photo', json({ code: 'unsupported_media' }, 415), 'unsupported'],
    ['a photo that is too large', json({ code: 'payload_too_large' }, 413), 'too_large'],
    [
      'one that a proxy found too large',
      new Response('<html>413</html>', { status: 413 }),
      'too_large',
    ],
    ['too many uploads', json({ code: 'rate_limited' }, 429), 'rate_limited'],
    ['no room for photos', json({ code: 'unavailable' }, 503), 'unavailable'],
    ['a proxy that is down', new Response(null, { status: 503 }), 'unavailable'],
    ['a missing device id', json({ code: 'missing_device_id' }, 400), 'failed'],
    ['an internal error', json({ code: 'internal' }, 500), 'failed'],
  ];
  it.each(refusals)('turns %s into a MediaError', async (_name, response, code) => {
    stubFetch(() => response.clone());
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ name: 'MediaError', code });
  });

  it('says "offline" when the request cannot leave and the browser knows it is offline, "failed" otherwise', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'failed' });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'offline' });
  });

  it('does not take an answer it could not use for a cover', async () => {
    stubFetch(() => json({ ...STORED, url: 'https://elsewhere.test/photo.jpg' }, 201));
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'failed' });
    stubFetch(() => json({ id: 'x' }, 201));
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'failed' });
    stubFetch(() => new Response('not json', { status: 201 }));
    await expect(uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'failed' });
  });

  it('does not even try with a photo over the limit', async () => {
    const fetchMock = stubFetch();
    await expect(uploadPhoto(jpeg(MEDIA_LIMITS.maxUploadBytes + 1))).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives the caller's own abort back, not a MediaError", async () => {
    stubFetch(
      (init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const controller = new AbortController();
    const upload = uploadPhoto(jpeg(), { signal: controller.signal });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    controller.abort(new DOMException('Left the screen', 'AbortError'));
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.signal.aborted).toBe(true);
  });
});
