import type { AnyEngineEvent } from '@rumbo/geo-engine';
import type { ActionDef } from '@rumbo/route-spec';
import { defaultActionFor, isInterruption } from './defaults.ts';
import { planFeedback } from './feedback.ts';
import type {
  AbortSignalLike,
  Decision,
  EventSystem,
  EventSystemOptions,
  HandlerContext,
  HandlerResult,
  ViewOutcome,
} from './types.ts';

type ActionRef = ActionDef & { id: string };

/** Queue order (§9.3): errors first, then interruptions, then content; navigation last. */
type Kind = 'error' | 'interruption' | 'content' | 'navigation';
const RANK: Record<Kind, number> = { error: 3, interruption: 2, content: 1, navigation: 0 };

interface Item {
  seq: number;
  kind: Kind;
  event: AnyEngineEvent;
  action: ActionRef | null;
  /** Same trigger for the same point: queued only once. */
  key: string;
}

interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(): void;
}

// Browsers and Node both provide AbortController; typed by hand (no DOM lib here).
const AbortControllerImpl = (
  globalThis as unknown as { AbortController: new () => AbortControllerLike }
).AbortController;

/**
 * Turns engine events into actions and feedback (docs/PROJECT_PLAN.md §9).
 * Blocking actions run one at a time; toasts never wait. A failing action
 * never blocks the route: the point gets a basic sheet and is completed anyway.
 */
export function createEventSystem(options: EventSystemOptions): EventSystem {
  const { engine, route, ui, feedback, logger } = options;
  const analytics = options.analytics ?? (() => {});
  const content = options.content ?? (async () => null);
  const now = options.now ?? (() => Date.now());
  const handlers = new Map(options.handlers.map((handler) => [handler.type, handler]));
  const pointsById = new Map(route.points.map((p) => [p.id, p]));

  let unsubscribe: (() => void) | null = null;
  let pending: Item[] = [];
  let running: { item: Item; controller: AbortControllerLike } | null = null;
  let pumping = false;
  let seq = 0;

  /** Adapter calls must never take the dispatcher down. */
  function safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger?.warn(`event-system: ${what} failed`, error);
    }
  }

  /** The event's action: its trigger's, or the default one (§9.3). */
  function actionFor(event: AnyEngineEvent): ActionRef | null {
    if (event.trigger) {
      const def = route.actions[event.trigger];
      if (def) return { ...def, id: event.trigger };
      logger?.warn(`event-system: trigger "${event.trigger}" has no action`);
      // The engine won't complete an arrival that has a trigger: show the basic sheet.
      if (event.type === 'enter') return { id: event.trigger, type: 'info_sheet', params: {} };
    }
    return defaultActionFor(event);
  }

  function track(event: AnyEngineEvent): void {
    // Product analytics never include coordinates (§13).
    const { progress, elapsedMs } = event.state;
    switch (event.type) {
      case 'started':
        return analytics('run_started', { routeId: route.id, mode: route.mode });
      case 'paused':
        return analytics('run_paused', { reason: event.data.reason ?? null });
      case 'resumed':
        return analytics('run_resumed', {});
      case 'cancelled':
        return analytics('run_cancelled', { reason: event.data.reason, elapsedMs });
      case 'finished':
        return analytics('run_finished', {
          elapsedMs,
          completed: progress.completed,
          total: progress.total,
        });
      case 'enter':
        return analytics('point_reached', { pointId: event.pointId, manual: event.data.manual });
      case 'gps_weak':
        return analytics('gps_weak', { reason: event.data.reason });
      case 'error':
        return analytics('error', { code: event.data.code });
      default:
        return undefined;
    }
  }

  function react(event: AnyEngineEvent, action: ActionRef | null): void {
    const plan = planFeedback(event, action, route);
    if (plan.vibrate) {
      const pattern = plan.vibrate;
      safely('vibrate', () => feedback.vibrate(pattern));
    }
    if (plan.sound) {
      const sound = plan.sound;
      safely('play', () => feedback.play(sound));
    }
    if (plan.notify) {
      const notification = plan.notify;
      safely('notify', () => feedback.notify(notification));
    }
  }

  function onEvent(event: AnyEngineEvent): void {
    if (event.type === 'position') return;
    track(event);
    const action = actionFor(event);
    react(event, action);

    // Cancelling closes whatever is open and forgets what was waiting.
    if (event.type === 'cancelled') abortAll();

    if (event.type === 'error') {
      enqueue({ kind: 'error', event, action: null, key: `error:${event.data.code}` });
    } else if (action) {
      dispatch(event, action);
    }
    // An arrival without an action is the engine's (`autoCompleteWithoutAction`).

    if (event.type === 'finished' || event.type === 'cancelled') {
      enqueue({ kind: 'navigation', event, action: null, key: 'navigate:summary' });
    }
    schedulePump();
  }

  function dispatch(event: AnyEngineEvent, action: ActionRef): void {
    const handler = handlers.get(action.type);
    const presentation = action.presentation ?? handler?.presentation ?? 'blocking';
    if (presentation === 'toast') {
      void runDetached(event, action);
      return;
    }
    enqueue({
      kind: isInterruption(event.type) ? 'interruption' : 'content',
      event,
      action,
      key: `${action.id}|${event.pointId ?? ''}`,
    });
  }

  /** Starts on a microtask: the engine may still be delivering an event. */
  function schedulePump(): void {
    void Promise.resolve().then(pump);
  }

  /**
   * Arrivals whose card never closed get it again: after a reload the
   * engine comes back with those points reached, and only a completed card
   * completes them. No feedback: the user already got it on arrival.
   */
  function resumeArrivals(): void {
    const state = engine.getState();
    if (state.status !== 'running' && state.status !== 'paused') return;
    for (const point of state.points) {
      const trigger = pointsById.get(point.id)?.triggers.onEnter;
      if (point.state !== 'reached' || !trigger) continue;
      const event: AnyEngineEvent = {
        id: `resume:${point.id}`,
        type: 'enter',
        trigger,
        pointId: point.id,
        timestamp: point.reachedAt ?? now(),
        data: { distance: point.distance ?? 0, accuracy: 0, dwellMs: 0, manual: false },
        state,
      };
      const action = actionFor(event);
      if (action) dispatch(event, action);
    }
    schedulePump();
  }

  function enqueue(item: Omit<Item, 'seq'>): void {
    // A running item that was aborted no longer counts: start() may queue it again.
    const live = running && !running.controller.signal.aborted ? running.item : null;
    if (live?.key === item.key || pending.some((p) => p.key === item.key)) return;
    seq += 1;
    pending.push({ ...item, seq });
  }

  function takeNext(): Item | undefined {
    let best: Item | undefined;
    for (const item of pending) {
      if (
        !best ||
        RANK[item.kind] > RANK[best.kind] ||
        (RANK[item.kind] === RANK[best.kind] && item.seq < best.seq)
      ) {
        best = item;
      }
    }
    if (best) pending = pending.filter((item) => item !== best);
    return best;
  }

  /** An interruption the state already resolved is not worth showing anymore. */
  function isStale(item: Item): boolean {
    if (item.kind === 'navigation') return false;
    const state = engine.getState();
    const over = state.status === 'finished' || state.status === 'cancelled';
    const { event } = item;
    if (over && event.type !== 'finished' && event.type !== 'cancelled') return true;
    switch (event.type) {
      case 'deviation':
        return !state.flags.offRoute;
      case 'idle':
        return !state.flags.idle;
      case 'out_of_order': {
        const def = pointsById.get(event.data.actualPointId);
        const point = state.points.find((p) => p.id === event.data.actualPointId);
        const reach = def ? def.radius + route.settings.exitHysteresis : 0;
        return point?.distance == null || point.distance > reach;
      }
      case 'enter':
        return state.points.find((p) => p.id === event.pointId)?.state !== 'reached';
      default:
        return false;
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (unsubscribe) {
        const item = takeNext();
        if (!item) break;
        if (!isStale(item)) await execute(item);
      }
    } finally {
      pumping = false;
    }
  }

  function contextFor(
    event: AnyEngineEvent,
    action: ActionRef,
    signal: AbortSignalLike,
  ): HandlerContext {
    return {
      event,
      route,
      point: event.pointId ? (pointsById.get(event.pointId) ?? null) : null,
      action,
      content,
      ui,
      feedback,
      analytics,
      signal,
    };
  }

  async function runAction(
    event: AnyEngineEvent,
    action: ActionRef,
    signal: AbortSignalLike,
  ): Promise<HandlerResult> {
    const handler = handlers.get(action.type);
    if (!handler) {
      logger?.warn(`event-system: no handler for action type "${action.type}"`);
      return { status: 'failed' };
    }
    let params: unknown = action.params ?? {};
    if (handler.paramsSchema) {
      const parsed = handler.paramsSchema.safeParse(params);
      if (!parsed.success) {
        logger?.warn(`event-system: invalid params for action "${action.id}"`, parsed.error.issues);
        return { status: 'failed' };
      }
      params = parsed.data;
    }
    try {
      await handler.load?.();
      // `params` passed the handler's own schema, so it has the type run() expects.
      return await handler.run(params as never, contextFor(event, action, signal));
    } catch (error) {
      logger?.warn(`event-system: action "${action.id}" threw`, error);
      return { status: 'failed' };
    }
  }

  async function runDetached(event: AnyEngineEvent, action: ActionRef): Promise<void> {
    const startedAt = now();
    const result = await runAction(event, action, new AbortControllerImpl().signal);
    if (result.status === 'failed')
      analytics('error', { code: 'action_failed', type: action.type });
    completeArrival(event, action, result, startedAt);
  }

  /** After an arrival's action, whatever its result (§9.3), the point is done. */
  function completeArrival(
    event: AnyEngineEvent,
    action: ActionRef,
    result: HandlerResult,
    startedAt: number,
  ): void {
    if (event.type !== 'enter' || !event.pointId) return;
    const completed = engine.complete(event.pointId, {
      ...(result.score !== undefined ? { score: result.score } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
    });
    if (!completed) return;
    analytics('point_completed', {
      pointId: event.pointId,
      handlerType: action.type,
      status: result.status,
      ms: now() - startedAt,
    });
  }

  async function execute(item: Item): Promise<void> {
    const controller = new AbortControllerImpl();
    running = { item, controller };
    const startedAt = now();
    try {
      if (item.kind === 'navigation') {
        safely('navigate', () => ui.navigate('summary'));
        return;
      }
      if (item.kind === 'error') {
        await showError(item.event, controller.signal);
        return;
      }
      const action = item.action as ActionRef;
      if (item.kind === 'interruption') analytics('interruption_shown', { type: item.event.type });

      let result = await runAction(item.event, action, controller.signal);
      if (result.status === 'failed' && !controller.signal.aborted) {
        analytics('error', { code: 'action_failed', type: action.type });
        // The route never stops on a broken action: show the basic sheet instead.
        if (item.event.type === 'enter') {
          const fallback = await runAction(
            item.event,
            { id: 'fallback:info_sheet', type: 'info_sheet', params: {} },
            controller.signal,
          );
          result = { ...fallback, status: 'failed' };
        }
      }
      // Aborted means cancelled or stopped: the point stays reached for later.
      if (controller.signal.aborted) return;
      completeArrival(item.event, action, result, startedAt);
      if (result.decision) await decide(result.decision, item.event.type);
    } finally {
      if (running?.item === item) running = null;
    }
  }

  /** Error sheet with instructions (§9.3); "Retry" resumes the run. */
  async function showError(event: AnyEngineEvent, signal: AbortSignalLike): Promise<void> {
    if (event.type !== 'error') return;
    const outcome = await ui.present<ViewOutcome>(
      'error',
      { code: event.data.code, message: event.data.message },
      { variant: 'sheet', signal },
    );
    if (outcome?.decision && !signal.aborted) await decide(outcome.decision, 'error');
  }

  async function decide(decision: Decision, source: string): Promise<void> {
    analytics('decision_made', { type: source, decision });
    if (decision === 'continue') {
      if (engine.getState().status === 'paused') engine.resume('user');
      return;
    }
    if (decision === 'pause') {
      engine.pause('user');
      return;
    }
    // Ending is destructive: always confirm first (S09).
    const confirmed = await ui.confirm({
      title: { key: 'end.confirm.title' },
      body: { key: 'end.confirm.body' },
      confirmLabel: { key: 'end.confirm.yes' },
      cancelLabel: { key: 'end.confirm.no' },
      destructive: true,
    });
    if (confirmed) engine.cancel('user');
  }

  function abortAll(): void {
    running?.controller.abort();
    pending = [];
  }

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = engine.on('*', onEvent);
      resumeArrivals();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      abortAll();
    },
    get busy() {
      return running !== null;
    },
  };
}
