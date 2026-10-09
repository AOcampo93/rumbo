import { isOwnMediaUrl } from '@rumbo/api-contract';
import { and, eq, ne } from 'drizzle-orm';
import type { Tx } from '../db/index.js';
import { media } from '../db/schema.js';
import { fail } from '../errors.js';

// The route cover rule the server checks (phase 7.3, ADR 0005): checkUserRoute
// already accepts, as a route's cover, the address of one of the server's
// photos; here the server makes sure it is one, and that the route may use it.

/** Where a photo is served, below the origin: `/api/v1/media/<id>.jpg`. */
const MEDIA_PATH_PREFIX = '/api/v1/media/';
const MEDIA_EXTENSION = '.jpg';

/** The address of a stored photo: absolute, on the server's own origin. */
export const mediaUrl = (origin: string, id: string): string =>
  `${origin}${MEDIA_PATH_PREFIX}${id}${MEDIA_EXTENSION}`;

/**
 * The id in a photo's address, or null when the address is not a photo of this
 * server: another origin (even with the same path), another shape, or anything
 * after the file name.
 */
export function ownMediaId(url: string, origin: string): string | null {
  const prefix = `${origin}${MEDIA_PATH_PREFIX}`;
  return isOwnMediaUrl(url) && url.startsWith(prefix)
    ? url.slice(prefix.length, -MEDIA_EXTENSION.length)
    : null;
}

export interface CoverWrite {
  routeId: string;
  /** The device the route belongs to: only a photo it uploaded may be the route's cover. */
  ownerDeviceId: string | null;
  /** `spec.coverImage.url`, if the route has a cover. */
  coverUrl: string | undefined;
  /** The cover the stored route had before this write (none for a new route). */
  previousCoverUrl?: string | undefined;
  publicOrigin: string;
  now: Date;
}

/**
 * Makes the photos agree with the route that was just written, inside the
 * same transaction. A cover that is one of the server's own photos must exist,
 * come from the route's owner and be free or already this route's (422
 * `unverified_content` at `spec.coverImage` if not); it is then attached to
 * the route. Every other photo the route had is released, to be deleted a week
 * later. A cover that is not a photo of the server (a card's photo from
 * Wikimedia) or no cover at all just releases them.
 *
 * A route that keeps the cover it already had is accepted even if that photo
 * is gone (the operator deleted it): the app shows the route's illustration
 * instead, and its owner's next saves don't fail for something they didn't do.
 *
 * The photo's row is locked while the route is written, so two routes can't
 * both claim it.
 */
export async function attachCover(tx: Tx, write: CoverWrite): Promise<void> {
  const { routeId, ownerDeviceId, coverUrl, previousCoverUrl, publicOrigin, now } = write;
  let cover: string | null = null;
  let attached = false;
  if (coverUrl !== undefined && isOwnMediaUrl(coverUrl)) {
    const id = ownMediaId(coverUrl, publicOrigin);
    const [photo] =
      id && ownerDeviceId
        ? await tx
            .select({ routeId: media.routeId })
            .from(media)
            .where(and(eq(media.id, id), eq(media.deviceId, ownerDeviceId)))
            .for('update')
        : [];
    const unchangedButGone = !photo && id !== null && coverUrl === previousCoverUrl;
    if (unchangedButGone) {
      await tx
        .update(media)
        .set({ routeId: null, unusedSince: now })
        .where(eq(media.routeId, routeId));
      return;
    }
    if (!id || !photo || (photo.routeId !== null && photo.routeId !== routeId)) {
      throw fail(422, 'unverified_content', [
        { path: 'spec.coverImage', message: 'Not a photo this device uploaded to this server' },
      ]);
    }
    cover = id;
    attached = photo.routeId === routeId;
  }

  await tx
    .update(media)
    .set({ routeId: null, unusedSince: now })
    .where(and(eq(media.routeId, routeId), cover ? ne(media.id, cover) : undefined));
  if (cover && !attached) {
    await tx.update(media).set({ routeId, unusedSince: null }).where(eq(media.id, cover));
  }
}

/** A route is going away: its photos are released, to be deleted a week later. */
export async function releasePhotos(tx: Tx, routeId: string, now: Date): Promise<void> {
  await tx.update(media).set({ routeId: null, unusedSince: now }).where(eq(media.routeId, routeId));
}
