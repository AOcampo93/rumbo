import type { AnyEngineEvent, EngineEventType } from '@rumbo/geo-engine';
import type { ActionDef, NormalizedRouteSpec } from '@rumbo/route-spec';
import type { Sound, UiText } from './types.ts';

interface DefaultFeedback {
  vibrate: number[];
  sound: Sound;
  /** i18n key of the notification title; no key, no notification. */
  notify?: string;
}

/**
 * Default feedback per event (docs/PROJECT_PLAN.md §9.4). Notification texts
 * are i18n keys; the app only shows them while it is in the background.
 */
export const DEFAULT_FEEDBACK: Partial<Record<EngineEventType, DefaultFeedback>> = {
  approach: { vibrate: [80], sound: 'approach' },
  enter: { vibrate: [200, 100, 200], sound: 'arrive', notify: 'notify.arrive' },
  out_of_order: { vibrate: [100, 50, 100], sound: 'alert', notify: 'notify.outOfOrder' },
  deviation: { vibrate: [300], sound: 'alert', notify: 'notify.deviation' },
  idle: { vibrate: [150], sound: 'soft', notify: 'notify.idle' },
  timeout: { vibrate: [300, 100, 300], sound: 'alert', notify: 'notify.timeout' },
  finished: { vibrate: [100, 50, 100, 50, 300], sound: 'finish', notify: 'notify.finish' },
};

/** Pattern used when an action turns vibration on for an event that has none by default. */
const FALLBACK_VIBRATION = [150];
const SOUNDS: readonly string[] = ['approach', 'arrive', 'alert', 'finish', 'soft'];

export interface FeedbackPlan {
  vibrate?: number[];
  sound?: Sound;
  notify?: { title: UiText; body: UiText; tag: string; url: string };
}

/**
 * The feedback for one event: the defaults, adjusted by the triggered
 * action's own `feedback` (vibrate: false silences, sound: null mutes,
 * notify: false skips the notification).
 */
export function planFeedback(
  event: AnyEngineEvent,
  action: ActionDef | null,
  route: NormalizedRouteSpec,
): FeedbackPlan {
  const base = DEFAULT_FEEDBACK[event.type];
  const override = action?.feedback;
  const plan: FeedbackPlan = {};

  if (override?.vibrate ?? Boolean(base)) plan.vibrate = base?.vibrate ?? FALLBACK_VIBRATION;

  const sound = override?.sound === undefined ? base?.sound : override.sound;
  if (sound && SOUNDS.includes(sound)) plan.sound = sound as Sound;

  if (override?.notify ?? Boolean(base?.notify)) {
    const point = event.pointId ? route.points.find((p) => p.id === event.pointId) : undefined;
    plan.notify = {
      title: { key: base?.notify ?? 'notify.generic', params: point ? { name: point.name } : {} },
      body: { key: 'notify.tapToOpen' },
      tag: `${event.type}:${event.pointId ?? route.id}`,
      // Tapping it opens the run with this point's card (§10.2).
      url: event.pointId ? `/run?point=${encodeURIComponent(event.pointId)}` : '/run',
    };
  }
  return plan;
}
