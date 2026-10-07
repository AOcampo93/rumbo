import { describe, expect, it } from 'vitest';
import { type AnyActionHandler, builtinHandlers, infoSheetHandler } from '../src/index.ts';
import { answerAll, ARRIVAL, baseState, flush, P1, P2, route, setupFake } from './harness.ts';

const OFF_ROUTE = { offRoute: true, idle: false, overtime: false };
const IDLE = { offRoute: false, idle: true, overtime: false };
const CLEAR = { offRoute: false, idle: false, overtime: false };
const DEVIATION = { distanceToRoute: 200, sinceMs: 30_000 };
const SUMMARY = { elapsedMs: 1000, distanceMeters: 500, completed: 2, total: 2, score: 0 };

const boom: AnyActionHandler = {
  type: 'boom',
  run: async () => {
    throw new Error('kaput');
  },
};
const flaky: AnyActionHandler = { type: 'flaky', run: async () => ({ status: 'failed' }) };

describe('the queue', () => {
  it('runs blocking actions one at a time, in arrival order', async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    await flush();
    expect(t.open.map((v) => v.props.pointId)).toEqual(['p1']);
    expect(t.events.busy).toBe(true);

    t.current()?.answer({});
    await flush();
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
    expect(t.open.map((v) => v.props.pointId)).toEqual(['p2']);

    t.current()?.answer({ status: 'dismissed' });
    await flush();
    expect(t.engine.complete).toHaveBeenLastCalledWith('p2', {});
    expect(t.events.busy).toBe(false);
  });

  it('puts errors first, then interruptions, then content, without cutting the open card', async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    t.setState({ flags: OFF_ROUTE });
    t.emit('deviation', DEVIATION);
    t.emit('error', { code: 'POSITION_UNAVAILABLE', message: 'no fix' });
    await flush();
    expect(t.open.map((v) => v.view)).toEqual(['info_sheet']);

    await answerAll(t);
    expect(t.opened.map((v) => `${v.view}:${String(v.props.pointId)}`)).toEqual([
      'info_sheet:p1',
      'error:undefined',
      'decision:null',
      'info_sheet:p2',
    ]);
    expect(t.analytics).toHaveBeenCalledWith('interruption_shown', { type: 'deviation' });
  });

  it('queues the same action for the same point only once', async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.setState({ flags: OFF_ROUTE });
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' }); // the card already open
    t.emit('deviation', DEVIATION);
    t.emit('deviation', DEVIATION); // one is already waiting
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' }); // same action, other point

    await answerAll(t);
    expect(t.opened.map((v) => `${v.view}:${String(v.props.pointId)}`)).toEqual([
      'info_sheet:p1',
      'decision:null',
      'info_sheet:p2',
    ]);
  });
});

describe('stale items', () => {
  it('drop a deviation the user fixed while a card was open', async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.setState({ flags: OFF_ROUTE });
    t.emit('deviation', DEVIATION);
    t.setState({ flags: CLEAR });
    t.emit('back_on_track', { distanceToRoute: 100 });
    await flush();
    expect(t.toasts).toEqual([{ key: 'run.backOnTrack', params: {} }]);

    await answerAll(t);
    expect(t.opened.map((v) => v.view)).toEqual(['info_sheet']);
    expect(t.analytics).not.toHaveBeenCalledWith('interruption_shown', expect.anything());
  });

  it('drop idleness once the user moves again', async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.setState({ flags: IDLE });
    t.emit('idle', { idleSeconds: 600 });
    t.setState({ flags: CLEAR });
    await answerAll(t);
    expect(t.opened.map((v) => v.view)).toEqual(['info_sheet']);
  });

  it('show out_of_order only while the user is still at that point', async () => {
    const t = setupFake(route({ mode: 'challenge' }));
    t.setPoint('p2', { state: 'locked', distance: 10 });
    t.emit('out_of_order', { expectedPointId: 'p1', actualPointId: 'p2' }, { pointId: 'p2' });
    await flush();
    expect(t.current()?.props).toMatchObject({
      preset: 'out_of_order',
      body: { key: 'decision.outOfOrder.body', params: { name: 'P1' } },
    });
    await answerAll(t);

    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('out_of_order', { expectedPointId: 'p1', actualPointId: 'p2' }, { pointId: 'p2' });
    t.setPoint('p2', { distance: 120 }); // gone before the card closed
    await answerAll(t);
    expect(t.opened.map((v) => v.view)).toEqual(['decision', 'info_sheet']);
  });

  it("skip the card of a point that's no longer reached", async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    await flush();
    t.setPoint('p2', { state: 'completed' });
    await answerAll(t);
    expect(t.opened.map((v) => v.props.pointId)).toEqual(['p1']);
  });

  it('are dropped once the run is over, but the summary still opens', async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.setState({ flags: OFF_ROUTE });
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    t.emit('deviation', DEVIATION);
    t.setState({ status: 'finished' });
    t.emit('finished', { summary: SUMMARY });

    await answerAll(t);
    expect(t.opened.map((v) => v.props.pointId)).toEqual(['p1']);
    expect(t.navigations).toEqual(['summary']);
    expect(t.analytics).not.toHaveBeenCalledWith('point_completed', expect.anything());
  });
});

describe('decisions', () => {
  it('pause from a card menu, after completing the point', async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.current()?.answer({ decision: 'pause' });
    await flush();
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
    expect(t.engine.pause).toHaveBeenCalledWith('user');
    expect(t.state().status).toBe('paused');
    expect(t.analytics).toHaveBeenCalledWith('decision_made', { type: 'enter', decision: 'pause' });
    expect(t.analytics).toHaveBeenCalledWith('run_paused', { reason: 'user' });
  });

  it('continue resumes a paused run and leaves a running one alone', async () => {
    const t = setupFake();
    t.setState({ flags: OFF_ROUTE });
    t.emit('deviation', DEVIATION);
    await flush();
    t.current()?.answer({ decision: 'continue' });
    await flush();
    expect(t.engine.resume).not.toHaveBeenCalled();

    t.setState({ status: 'paused', flags: IDLE });
    t.emit('idle', { idleSeconds: 600 });
    await flush();
    t.current()?.answer({ decision: 'continue' });
    await flush();
    expect(t.engine.resume).toHaveBeenCalledWith('user');
    expect(t.state().status).toBe('running');
  });

  it('end the run only after a destructive confirmation', async () => {
    const t = setupFake();
    t.setState({ flags: OFF_ROUTE });
    t.setConfirm(false);
    t.emit('deviation', DEVIATION);
    await flush();
    t.current()?.answer({ decision: 'cancel' });
    await flush();
    expect(t.confirms).toEqual([
      {
        title: { key: 'end.confirm.title' },
        body: { key: 'end.confirm.body' },
        confirmLabel: { key: 'end.confirm.yes' },
        cancelLabel: { key: 'end.confirm.no' },
        destructive: true,
      },
    ]);
    expect(t.engine.cancel).not.toHaveBeenCalled();

    t.setConfirm(true);
    t.emit('deviation', DEVIATION);
    await flush();
    t.current()?.answer({ decision: 'cancel' });
    await flush();
    expect(t.engine.cancel).toHaveBeenCalledWith('user');
    expect(t.navigations).toEqual(['summary']);
  });
});

describe('a failing action', () => {
  it('is replaced by the basic sheet, and the point is completed anyway', async () => {
    const t = setupFake(route({ actions: { card: { type: 'boom' } } }), [...builtinHandlers, boom]);
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.current()).toMatchObject({
      view: 'info_sheet',
      props: { pointId: 'p1', title: 'P1' },
    });

    t.current()?.answer({});
    await flush();
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
    expect(t.logger.warn).toHaveBeenCalledWith(
      'event-system: action "card" threw',
      expect.any(Error),
    );
    expect(t.analytics).toHaveBeenCalledWith('error', { code: 'action_failed', type: 'boom' });
    expect(t.analytics).toHaveBeenCalledWith(
      'point_completed',
      expect.objectContaining({ pointId: 'p1', handlerType: 'boom', status: 'failed' }),
    );
  });

  it.each([
    {
      why: 'reports a failure',
      spec: route({ actions: { card: { type: 'flaky' } } }),
      handlers: [...builtinHandlers, flaky],
      warning: null,
    },
    {
      why: 'has invalid params',
      spec: route({
        actions: {
          card: {
            type: 'quiz',
            params: { question: '?', options: ['a', 'b'], correctIndex: 5, points: 10 },
          },
        },
      }),
      handlers: builtinHandlers,
      warning: 'event-system: invalid params for action "card"',
    },
    {
      why: 'has no handler',
      spec: route({ actions: { card: { type: 'hologram' } } }),
      handlers: builtinHandlers,
      warning: 'event-system: no handler for action type "hologram"',
    },
  ])('falls back the same way when it $why', async ({ spec, handlers, warning }) => {
    const t = setupFake(spec, handlers);
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.current()?.view).toBe('info_sheet');
    await answerAll(t);
    expect(t.state().points[0]?.state).toBe('completed');
    if (warning) expect(t.logger.warn.mock.calls[0]?.[0]).toBe(warning);
  });

  it('still completes the point when even the basic sheet fails', async () => {
    const t = setupFake(route({ actions: { card: { type: 'boom' } } }), [boom]);
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.opened).toEqual([]);
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
  });

  it('a trigger without its action shows the basic sheet', async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'ghost' });
    await flush();
    expect(t.current()?.props).toMatchObject({ pointId: 'p1', title: 'P1' });
    expect(t.logger.warn).toHaveBeenCalledWith('event-system: trigger "ghost" has no action');
    await answerAll(t);
    expect(t.state().points[0]?.state).toBe('completed');
  });

  it('a broken interruption is skipped and the queue goes on', async () => {
    const broken: AnyActionHandler = { type: 'decision', run: boom.run };
    const t = setupFake(route(), [infoSheetHandler, broken]);
    t.reach('p1');
    t.setState({ flags: OFF_ROUTE });
    t.emit('deviation', DEVIATION);
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.opened.map((v) => v.view)).toEqual(['info_sheet']);
    expect(t.analytics).toHaveBeenCalledWith('error', { code: 'action_failed', type: 'decision' });
  });
});

describe('toasts', () => {
  it("don't wait for the open card", async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('approach', { distance: 90 }, { pointId: 'p2' });
    await flush();
    expect(t.toasts).toEqual([{ key: 'run.approaching', params: { name: 'P2' } }]);
    expect(t.open).toHaveLength(1);
  });

  it('complete an arrival whose action is a toast', async () => {
    const message = { es: 'Hola', en: 'Hello', pt: 'Olá' };
    const t = setupFake(route({ actions: { card: { type: 'toast', params: { message } } } }));
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.toasts).toEqual([message]);
    expect(t.opened).toEqual([]);
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
  });

  it('report a broken toast and still complete the point', async () => {
    const t = setupFake(route({ actions: { card: { type: 'toast', params: {} } } }));
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.toasts).toEqual([]);
    expect(t.analytics).toHaveBeenCalledWith('error', { code: 'action_failed', type: 'toast' });
    expect(t.state().points[0]?.state).toBe('completed');
  });
});

describe('the end of the run', () => {
  it('cancelling closes the open card, forgets the queue and opens the summary', async () => {
    const t = setupFake();
    t.reach('p1', 'p2');
    t.setState({ flags: OFF_ROUTE });
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    t.emit('deviation', DEVIATION);
    const card = t.current();

    t.engine.cancel('gps');
    await answerAll(t);
    expect(card?.signal?.aborted).toBe(true);
    expect(t.opened).toHaveLength(1);
    expect(t.engine.complete).not.toHaveBeenCalled();
    expect(t.navigations).toEqual(['summary']);
    expect(t.events.busy).toBe(false);
  });

  it("shows the route's onCancel action before leaving", async () => {
    const bye = { es: 'Hasta pronto', en: 'See you soon', pt: 'Até breve' };
    const t = setupFake(
      route({
        triggers: { onCancel: 'bye' },
        actions: {
          card: { type: 'info_sheet' },
          bye: { type: 'info_sheet', params: { title: bye } },
        },
      }),
    );
    t.setState({ status: 'cancelled' });
    t.emit('cancelled', { reason: 'user' }, { trigger: 'bye' });
    await flush();
    expect(t.current()?.props).toMatchObject({ title: bye });
    expect(t.navigations).toEqual([]);
    await answerAll(t);
    expect(t.navigations).toEqual(['summary']);
  });

  it('finishing opens the summary after the onFinish action', async () => {
    const t = setupFake(
      route({
        triggers: { onFinish: 'congrats' },
        actions: { card: { type: 'info_sheet' }, congrats: { type: 'info_sheet' } },
      }),
    );
    t.setState({ status: 'finished' });
    t.emit('finished', { summary: SUMMARY }, { trigger: 'congrats' });
    await flush();
    expect(t.current()?.view).toBe('info_sheet');
    expect(t.navigations).toEqual([]);
    await answerAll(t);
    expect(t.navigations).toEqual(['summary']);
  });
});

describe('errors', () => {
  it('open the error sheet once per code; Retry resumes the run', async () => {
    const t = setupFake();
    t.setState({ status: 'paused', gps: 'denied' });
    t.emit('error', { code: 'PERMISSION_DENIED', message: 'denied' });
    t.emit('error', { code: 'PERMISSION_DENIED', message: 'denied' });
    await flush();
    expect(t.current()).toMatchObject({
      view: 'error',
      variant: 'sheet',
      props: { code: 'PERMISSION_DENIED', message: 'denied' },
    });
    t.current()?.answer({ decision: 'continue' });
    await flush();
    expect(t.engine.resume).toHaveBeenCalledWith('user');
    expect(t.opened).toHaveLength(1);
    expect(t.analytics).toHaveBeenCalledWith('decision_made', {
      type: 'error',
      decision: 'continue',
    });
  });

  it('closing the error sheet without choosing changes nothing', async () => {
    const t = setupFake();
    t.setState({ status: 'paused' });
    t.emit('error', { code: 'TIMEOUT', message: 'slow' });
    await flush();
    t.current()?.answer(undefined);
    await flush();
    expect(t.engine.resume).not.toHaveBeenCalled();
    expect(t.events.busy).toBe(false);
  });
});

describe('feedback', () => {
  it('vibrates, plays and notifies on arrival', () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    expect(t.feedback.vibrate).toHaveBeenCalledWith([200, 100, 200]);
    expect(t.feedback.play).toHaveBeenCalledWith('arrive');
    expect(t.feedback.notify).toHaveBeenCalledWith({
      title: { key: 'notify.arrive', params: { name: 'P1' } },
      body: { key: 'notify.tapToOpen' },
      tag: 'enter:p1',
      url: '/run?point=p1',
    });
  });

  it("follows the action's own feedback", () => {
    const t = setupFake(
      route({
        actions: {
          card: { type: 'info_sheet', feedback: { vibrate: false, sound: null, notify: false } },
        },
      }),
    );
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    expect(t.feedback.vibrate).not.toHaveBeenCalled();
    expect(t.feedback.play).not.toHaveBeenCalled();
    expect(t.feedback.notify).not.toHaveBeenCalled();
  });

  it('keeps going when an adapter throws', async () => {
    const t = setupFake();
    t.feedback.vibrate.mockImplementation(() => {
      throw new Error('no vibration motor');
    });
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    expect(t.logger.warn).toHaveBeenCalledWith('event-system: vibrate failed', expect.any(Error));
    expect(t.feedback.play).toHaveBeenCalledWith('arrive');
    expect(t.current()?.view).toBe('info_sheet');
  });

  it('ignores position updates', async () => {
    const t = setupFake();
    t.emit('position', { sample: { ...P1, accuracy: 5, timestamp: 0 } });
    await flush();
    expect(t.feedback.vibrate).not.toHaveBeenCalled();
    expect(t.analytics).not.toHaveBeenCalled();
  });
});

describe('analytics', () => {
  it('tracks the run, never with coordinates', () => {
    const t = setupFake();
    t.emit('started', {});
    t.engine.pause('user');
    t.engine.resume();
    t.emit('gps_weak', { reason: 'accuracy', accuracy: 80 });
    t.reach('p1');
    t.emit('enter', { ...ARRIVAL, manual: true }, { pointId: 'p1', trigger: 'card' });
    t.emit('error', { code: 'TIMEOUT', message: 'slow' });
    t.setState({ elapsedMs: 60_000 });
    t.emit('finished', { summary: SUMMARY });
    t.emit('cancelled', { reason: 'user' });
    expect(t.analytics.mock.calls).toEqual([
      ['run_started', { routeId: 'events-test', mode: 'free' }],
      ['run_paused', { reason: 'user' }],
      ['run_resumed', {}],
      ['gps_weak', { reason: 'accuracy' }],
      ['point_reached', { pointId: 'p1', manual: true }],
      ['error', { code: 'TIMEOUT' }],
      ['run_finished', { elapsedMs: 60_000, completed: 0, total: 2 }],
      ['run_cancelled', { reason: 'user', elapsedMs: 60_000 }],
    ]);
    expect(JSON.stringify(t.analytics.mock.calls)).not.toMatch(/lat|lng/);
  });
});

describe('lifecycle', () => {
  it('subscribes once, and stop() lets go and closes the open card', async () => {
    const t = setupFake();
    t.events.start();
    expect(t.engine.on).toHaveBeenCalledTimes(1);
    t.reach('p1', 'p2');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    const card = t.current();

    t.events.stop();
    await flush();
    expect(t.listenerCount()).toBe(0);
    expect(card?.signal?.aborted).toBe(true);
    expect(t.events.busy).toBe(false);
    expect(t.engine.complete).not.toHaveBeenCalled(); // reached, for later
    t.emit('enter', ARRIVAL, { pointId: 'p2', trigger: 'card' });
    expect(t.feedback.vibrate).toHaveBeenCalledTimes(1);
  });

  it('shows again a card that stop() closed, once started again', async () => {
    const t = setupFake();
    t.reach('p1');
    t.emit('enter', ARRIVAL, { pointId: 'p1', trigger: 'card' });
    await flush();
    t.events.stop();
    t.events.start();
    await flush();
    expect(t.opened.map((v) => v.props.pointId)).toEqual(['p1', 'p1']);
    expect(t.opened[0]?.signal?.aborted).toBe(true);
    await answerAll(t);
    expect(t.state().points[0]?.state).toBe('completed');
  });

  it('shows the cards of points reached before a reload, without feedback', async () => {
    const spec = route({
      points: [
        { id: 'p1', name: 'P1', position: P1, order: 1, triggers: { onEnter: 'card' } },
        { id: 'p2', name: 'P2', position: P2, order: 2 },
      ],
    });
    const restored = baseState({ status: 'paused' });
    const t = setupFake(spec, builtinHandlers, {
      ...restored,
      points: restored.points.map((p) => ({ ...p, state: 'reached', reachedAt: 1 })),
    });
    await flush();
    expect(t.opened.map((v) => v.props.pointId)).toEqual(['p1']);
    expect(t.feedback.vibrate).not.toHaveBeenCalled();
    await answerAll(t);
    expect(t.engine.complete).toHaveBeenCalledWith('p1', {});
  });

  it('resumes nothing once the run is over', async () => {
    const over = baseState({ status: 'finished' });
    const t = setupFake(route(), builtinHandlers, {
      ...over,
      points: over.points.map((p) => ({ ...p, state: 'reached' })),
    });
    await flush();
    expect(t.opened).toEqual([]);
  });
});
