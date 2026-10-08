import { and, count, eq, gt, gte, or, sql } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { aiGenerations } from '../db/schema.js';
import { fail } from '../errors.js';
import type { AiBudget, AiCallRecord, AiUsage } from './provider.js';

// What the AI may spend (PROJECT_PLAN §12.2): an estimated daily budget for
// the whole server and a number of generations per device, both over the UTC
// day and both read from ai_generations, where every call is recorded.

export type BudgetConfig = Pick<
  AppConfig,
  | 'aiDailyBudgetUsd'
  | 'aiMaxGenerationsPerDevicePerDay'
  | 'aiPriceInputPerMtok'
  | 'aiPriceOutputPerMtok'
  | 'aiPricePerWebSearch'
>;

/** A recorded call, which may also say which version of the prompt it ran. */
export interface AiBudgetCall extends AiCallRecord {
  promptVersion?: string;
}

export interface AiBudgetStore extends AiBudget {
  record(call: AiBudgetCall): Promise<void>;
}

/** What a call cost, estimated from what it used and the configured prices. */
export function estimateCostUsd(usage: AiUsage, prices: BudgetConfig): number {
  return (
    (usage.inputTokens * prices.aiPriceInputPerMtok +
      usage.outputTokens * prices.aiPriceOutputPerMtok) /
      1_000_000 +
    usage.webSearches * prices.aiPricePerWebSearch
  );
}

/** Midnight UTC of the day `time` (epoch ms) falls in. */
export function utcDayStart(time: number): Date {
  const day = new Date(time);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
}

/**
 * The budget over a database. `db` may be a function, since the app starts
 * before its database is ready; without one the calls answer 503 `unavailable`.
 */
export function createAiBudget(
  db: Db | (() => Db | null),
  config: BudgetConfig,
  now: () => number = Date.now,
): AiBudgetStore {
  const current = (): Db => {
    const database = typeof db === 'function' ? db() : db;
    if (!database) throw fail(503, 'unavailable');
    return database;
  };

  return {
    async check(deviceId) {
      const database = current();
      const since = utcDayStart(now());
      const [spent] = await database
        .select({ usd: sql<number>`coalesce(sum(${aiGenerations.costUsd}), 0)` })
        .from(aiGenerations)
        .where(gte(aiGenerations.createdAt, since));
      if (Number(spent?.usd ?? 0) >= config.aiDailyBudgetUsd) {
        throw fail(429, 'ai_budget_exceeded');
      }
      // A generation counts when it gave something or cost something: a
      // provider that was down must not use up the day of whoever tried.
      const [mine] = await database
        .select({ n: count() })
        .from(aiGenerations)
        .where(
          and(
            eq(aiGenerations.deviceId, deviceId),
            gte(aiGenerations.createdAt, since),
            or(eq(aiGenerations.status, 'ok'), gt(aiGenerations.costUsd, 0)),
          ),
        );
      if ((mine?.n ?? 0) >= config.aiMaxGenerationsPerDevicePerDay) {
        throw fail(429, 'ai_device_limit');
      }
    },

    async record(call) {
      await current()
        .insert(aiGenerations)
        .values({
          deviceId: call.deviceId,
          kind: call.kind,
          cacheKey: call.cacheKey,
          locale: call.locale,
          model: call.model,
          promptVersion: call.promptVersion ?? null,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
          webSearches: call.usage.webSearches,
          costUsd: estimateCostUsd(call.usage, config),
          status: call.status,
          latencyMs: Math.round(call.latencyMs),
          createdAt: new Date(now()),
        });
    },
  };
}
