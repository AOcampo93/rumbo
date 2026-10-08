import { LocaleSchema, plainText } from '@rumbo/route-spec';
import { z } from 'zod';
import { isAuthSecret, isP256dh, isPushEndpoint, MAX_ENDPOINT_LENGTH } from './subscription.js';

// The request and response bodies of the push endpoints (/v1/push/…, and the
// announcements of /v1/admin/push). Errors are the contract's usual { code }.

export const PushKeyResponseSchema = z.object({
  /** The VAPID public key (base64url): the browser's `applicationServerKey`. */
  publicKey: z.string(),
});

/**
 * What a browser's PushSubscription (toJSON) gives, plus the language its
 * notifications come in. Fields beyond these (`expirationTime`) are ignored.
 */
export const PushSubscribeBodySchema = z.object({
  endpoint: z
    .string()
    .max(MAX_ENDPOINT_LENGTH)
    .refine(isPushEndpoint, 'Not the https address of a supported push service'),
  keys: z.object({
    p256dh: z.string().refine(isP256dh, 'Not a P-256 public key in base64url'),
    auth: z.string().refine(isAuthSecret, 'Not a 16-byte secret in base64url'),
  }),
  locale: LocaleSchema,
});
export type PushSubscribeBody = z.infer<typeof PushSubscribeBodySchema>;

/** Unknown endpoints are fine (204): it only has to be text. */
export const PushUnsubscribeBodySchema = z.object({
  endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
});

/** One text per language: an announcement reaches every subscription in its own. */
const inEveryLanguage = (max: number) =>
  z.strictObject({ es: plainText({ max }), en: plainText({ max }), pt: plainText({ max }) });

/** A path on this site (`/run`), never an address elsewhere: no scheme, no `//`, no backslash. */
const SitePathSchema = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[^\p{Cc}\s\\]*$/u, 'A path on this site, like /run');

export const AnnouncementBodySchema = z.strictObject({
  title: inEveryLanguage(80),
  body: inEveryLanguage(240),
  /** Where tapping the notification goes; the home page when omitted. */
  url: SitePathSchema.optional(),
});
export type AnnouncementBody = z.infer<typeof AnnouncementBodySchema>;

export const AnnouncementResponseSchema = z.object({
  /** Messages the push services accepted. */
  sent: z.number().int(),
  /** Subscriptions the message did not reach, those the push service had forgotten included. */
  failed: z.number().int(),
});
export type AnnouncementResponse = z.infer<typeof AnnouncementResponseSchema>;
