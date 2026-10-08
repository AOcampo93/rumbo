import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import {
  createPushSender,
  createWebPushTransport,
  type PushSender,
  type PushTransport,
} from './send.js';
import { checkVapid, type Vapid, type VapidConfig } from './vapid.js';

/** Web Push, switched on: who we are for the push services, and the way to send. */
export interface Push {
  vapid: Vapid;
  sender: PushSender;
}

export interface PushSetup {
  /** Null until migrations ran (or without DATABASE_URL). */
  database: () => Database | null;
  log: FastifyBaseLogger;
  /** The way messages reach the push services; the real one unless a test brings its own. */
  transport?: PushTransport;
}

/** Null when the VAPID settings are missing or malformed: push is then off (503 push_unavailable). */
export function createPush(config: VapidConfig, setup: PushSetup): Push | null {
  const checked = checkVapid(config);
  if (!checked.ok) return null;
  const transport = setup.transport ?? createWebPushTransport(checked.vapid);
  return {
    vapid: checked.vapid,
    sender: createPushSender({ database: setup.database, transport, log: setup.log }),
  };
}
