import type { RunEndBody, RunStartBody, RunStartResponse } from '@rumbo/api-contract';
import { api } from './api.ts';
import { db, KEYS } from './storage.ts';

// Each run's start and end go to the API for the internal metrics (started vs
// finished, time per route). Best effort: the run never waits for the network.
// An end that can't be sent (offline) waits in an outbox and goes later.

interface PendingEnd {
  runId: string;
  body: RunEndBody;
}

/** The run's id on the server, or null (offline, API down). */
export async function registerRunStart(body: RunStartBody): Promise<string | null> {
  try {
    const response = await api('/runs', { method: 'POST', body, device: true });
    if (response.status !== 201) return null;
    return ((await response.json()) as RunStartResponse).runId;
  } catch {
    return null;
  }
}

/** True when the server has it or will never take it (4xx): nothing to retry. */
async function sendEnd(end: PendingEnd): Promise<boolean> {
  try {
    const response = await api(`/runs/${end.runId}`, {
      method: 'PATCH',
      body: end.body,
      device: true,
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function registerRunEnd(runId: string, body: RunEndBody): Promise<void> {
  const end = { runId, body };
  if (await sendEnd(end)) return;
  const pending = (await db.get<PendingEnd[]>(KEYS.runOutbox)) ?? [];
  await db.set(KEYS.runOutbox, [...pending.filter((p) => p.runId !== runId), end].slice(-20));
}

/** Sends the ends that couldn't go before (on app start). */
export async function flushRunOutbox(): Promise<void> {
  const pending = (await db.get<PendingEnd[]>(KEYS.runOutbox)) ?? [];
  if (pending.length === 0) return;
  const failed: PendingEnd[] = [];
  for (const end of pending) if (!(await sendEnd(end))) failed.push(end);
  await db.set(KEYS.runOutbox, failed);
}
