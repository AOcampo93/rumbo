import { createECDH } from 'node:crypto';
import type { AppConfig } from '../config.js';

// The server's VAPID identity (RFC 8292): the key pair the push services use
// to recognise who sends, and a contact for them. Push is on only when all
// three settings are present and well formed, so a typo shows up when the
// server starts and not as a push service refusing every message.

/** A VAPID identity that passed `checkVapid`. */
export interface Vapid {
  publicKey: string;
  /** Secret: never logged, never in an error message. */
  privateKey: string;
  /** An https: URL or a mailto: address. */
  subject: string;
}

export type VapidConfig = Pick<AppConfig, 'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'>;

export type VapidCheck =
  | { ok: true; vapid: Vapid }
  /** unset: push was not asked for; incomplete: some settings are missing; invalid: some are malformed. */
  | { ok: false; reason: 'unset' | 'incomplete' | 'invalid' };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The bytes of an unpadded base64url text of exactly `length` bytes; null otherwise. */
function decode(value: string, length: number): Buffer | null {
  if (!BASE64URL.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === length ? bytes : null;
}

/** The push services accept an https: URL or a mailto: address as the contact. */
function isContact(subject: string): boolean {
  try {
    const { protocol } = new URL(subject);
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** Whether `publicKey` is the P-256 public half of `privateKey`: a mixed-up pair is refused by every push service. */
function isPair(publicKey: Buffer, privateKey: Buffer): boolean {
  try {
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(privateKey);
    return curve.getPublicKey().equals(publicKey);
  } catch {
    return false;
  }
}

export function checkVapid(config: VapidConfig): VapidCheck {
  const { vapidPublicKey: publicKey, vapidPrivateKey: privateKey, vapidSubject: subject } = config;
  if (!publicKey && !privateKey && !subject) return { ok: false, reason: 'unset' };
  if (!publicKey || !privateKey || !subject) return { ok: false, reason: 'incomplete' };
  const publicBytes = decode(publicKey, 65);
  const privateBytes = decode(privateKey, 32);
  if (!publicBytes || !privateBytes || !isContact(subject) || !isPair(publicBytes, privateBytes)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, vapid: { publicKey, privateKey, subject } };
}
