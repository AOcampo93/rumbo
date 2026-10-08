import { createSimulatedSource, type EngineSnapshot, restoreGeoEngine } from '@rumbo/geo-engine';
import { validateRouteBundle } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import leiria from '../../../data/routes/leiria-historica.json' with { type: 'json' };
import { type AnyActionHandler, builtinHandlers } from '../src/index.ts';
import {
  answerAll,
  createFakeTime,
  east,
  flush,
  north,
  ORIGIN,
  P1,
  P2,
  route,
  setupReal,
} from './harness.ts';

// The DoD of phase 3 (docs/PROJECT_PLAN.md §16): the queue, the decisions and
// the fallback, driven by the real engine instead of a stand-in.

const challenge = () =>
  route({ id: 'events-challenge', mode: 'challenge', path: [ORIGIN, P1, P2] });

describe('with the real engine', () => {
  it('walks the curated Leiria route in simulation, card by card', async () => {
    const spec = validateRouteBundle(leiria).bundle?.spec;
    if (!spec) throw new Error('the curated route must be valid');
    const time = createFakeTime();
    const simulation = createSimulatedSource({
      start: spec.points[0]?.position,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    // Every card is read and closed as soon as it opens.
    const t = setupReal(spec, { time, source: simulation, autoAnswer: () => ({}) });

    t.engine.start();
    simulation.setTimeScale(20);
    for (const point of spec.points) {
      simulation.walkTo(point.position);
      for (let second = 0; second < 600 && t.point(point.id)?.state !== 'completed'; second++) {
        time.advance(1000);
        await flush(1);
      }
    }
    await flush();

    const cards = t.opened.filter((v) => v.view === 'info_sheet');
    expect(cards.map((v) => v.props.pointId)).toEqual(spec.points.map((p) => p.id));
    // Our own texts travel in the three languages; the UI picks the active one.
    for (const card of cards)
      expect(Object.keys(card.props.body as object).sort()).toEqual(['en', 'es', 'pt']);
    expect(t.engine.getState()).toMatchObject({
      status: 'finished',
      progress: { completed: 12, total: 12 },
    });
    expect(t.navigations).toEqual(['summary']);
    expect(t.analytics.mock.calls.filter(([name]) => name === 'point_completed')).toHaveLength(12);
    expect(t.feedback.notify).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'enter:castelo-de-leiria' }),
    );
    expect(t.logger.warn).not.toHaveBeenCalled();
  });

  it('a deviation asks what to do: Pause pauses the run', async () => {
    const t = setupReal(challenge());
    t.engine.start();
    await t.stay(ORIGIN, 1);
    await t.stay(north(east(ORIGIN, 150), 200), 31);
    expect(t.current()).toMatchObject({ view: 'decision', props: { preset: 'deviation' } });
    expect(t.feedback.play).toHaveBeenCalledWith('alert');

    t.current()?.answer({ decision: 'pause' });
    await flush();
    expect(t.engine.getState().status).toBe('paused');

    t.engine.resume('user'); // the HUD's Resume button
    await t.stay(north(east(ORIGIN, 150), 50), 2);
    expect(t.toasts).toContainEqual({ key: 'run.backOnTrack', params: {} });
  });

  it('out of order: the sheet names the point the challenge expects', async () => {
    const t = setupReal(challenge());
    t.engine.start();
    await t.stay(ORIGIN, 1);
    await t.stay(P2, 6);
    expect(t.current()).toMatchObject({
      view: 'decision',
      props: { preset: 'out_of_order', primary: { params: { name: 'P1' } } },
    });
    t.current()?.answer({ decision: 'continue' });

    await t.stay(P1, 6);
    expect(t.current()?.props.pointId).toBe('p1');
    t.current()?.answer({});
    await t.stay(P1, 1);
    await t.stay(P2, 6);
    await answerAll(t);
    expect(t.engine.getState().status).toBe('finished');
    expect(t.navigations).toEqual(['summary']);
  });

  it('an interruption that comes while a card is open waits for it', async () => {
    const t = setupReal(route({ settings: { timeLimit: 20 } }));
    t.engine.start();
    await t.stay(ORIGIN, 1);
    await t.stay(P1, 6);
    expect(t.current()?.props.pointId).toBe('p1');

    await t.stay(P1, 14); // still reading the card when the time limit passes
    expect(t.engine.getState().flags.overtime).toBe(true);
    expect(t.open.map((v) => v.view)).toEqual(['info_sheet']);

    t.current()?.answer({});
    await flush();
    expect(t.current()).toMatchObject({ view: 'decision', props: { preset: 'timeout' } });
    expect(t.point('p1')?.state).toBe('completed');
  });

  describe('walking out of the zone with the card open', () => {
    it('closes the card by itself, and the point counts as visited', async () => {
      const t = setupReal(route());
      t.engine.start();
      await t.stay(ORIGIN, 1);
      await t.stay(P1, 6);
      const card = t.current();
      expect(card?.props.pointId).toBe('p1');
      expect(t.point('p1')?.state).toBe('reached');

      // Radius 40 m + 10 m of hysteresis: still inside until farther than 50 m.
      await t.stay(east(P1, 30), 1);
      await t.stay(east(P1, 48), 1);
      expect(card?.signal?.aborted).toBe(false);
      expect(t.current()).toBe(card);

      await t.stay(east(P1, 60), 1);
      expect(card?.signal?.aborted).toBe(true);
      expect(t.open).toEqual([]);
      expect(t.point('p1')?.state).toBe('completed');
      expect(t.engine.getState().progress.completed).toBe(1);
      expect(t.engine.getState().status).toBe('running');
      expect(t.analytics.mock.calls.filter(([name]) => name === 'point_completed')).toEqual([
        ['point_completed', expect.objectContaining({ pointId: 'p1', status: 'dismissed' })],
      ]);

      // The route goes on as usual: the next card, closed by hand, ends it.
      await t.stay(P2, 6);
      expect(t.current()?.props.pointId).toBe('p2');
      t.current()?.answer({});
      await flush();
      expect(t.engine.getState().status).toBe('finished');
      expect(t.navigations).toEqual(['summary']);
      expect(t.logger.warn).not.toHaveBeenCalled();
    });

    it('does nothing once the card was closed', async () => {
      const t = setupReal(route());
      t.engine.start();
      await t.stay(ORIGIN, 1);
      await t.stay(P1, 6);
      t.current()?.answer({});
      await flush();
      expect(t.point('p1')?.state).toBe('completed');

      await t.stay(east(P1, 100), 2);
      expect(t.opened).toHaveLength(1);
      expect(t.analytics.mock.calls.filter(([name]) => name === 'point_completed')).toHaveLength(1);
      expect(t.engine.getState().progress.completed).toBe(1);
    });

    it("doesn't close the card for another point's exit", async () => {
      // Two zones overlap: the user stands in both. Only p1 has a card.
      const near = east(P1, 60);
      const t = setupReal(
        route({
          points: [
            { id: 'p1', name: 'P1', position: P1, order: 1, triggers: { onEnter: 'card' } },
            { id: 'p2', name: 'P2', position: near, order: 2 },
          ],
        }),
      );
      const exits: Array<string | null> = [];
      t.engine.on('exit', (event) => exits.push(event.pointId));
      t.engine.start();
      await t.stay(east(P1, -80), 1);
      await t.stay(east(P1, 30), 6);
      const card = t.current();
      expect(card?.props.pointId).toBe('p1');
      expect(t.point('p2')?.state).toBe('completed'); // nothing to show: the engine did it

      // Out of p2's zone, still in p1's: p2's exit changes nothing.
      await t.stay(east(P1, -20), 2);
      expect(exits).toEqual(['p2']);
      expect(card?.signal?.aborted).toBe(false);
      expect(t.current()).toBe(card);
      expect(t.point('p1')?.state).toBe('reached');

      await t.stay(east(P1, -60), 1);
      expect(exits).toEqual(['p2', 'p1']);
      expect(card?.signal?.aborted).toBe(true);
      expect(t.point('p1')?.state).toBe('completed');
      expect(t.engine.getState().status).toBe('finished');
    });

    it('lets a queued interruption have its turn', async () => {
      const t = setupReal(route({ settings: { timeLimit: 20 } }));
      t.engine.start();
      await t.stay(ORIGIN, 1);
      await t.stay(P1, 6);
      await t.stay(P1, 14); // the time limit passes behind the open card
      expect(t.open.map((v) => v.view)).toEqual(['info_sheet']);

      await t.stay(east(P1, 60), 1);
      expect(t.point('p1')?.state).toBe('completed');
      expect(t.opened.map((v) => v.view)).toEqual(['info_sheet', 'decision']);
      expect(t.current()).toMatchObject({ view: 'decision', props: { preset: 'timeout' } });
      expect(t.analytics).toHaveBeenCalledWith('interruption_shown', { type: 'timeout' });
    });
  });

  it('a broken action falls back to the basic sheet and the run goes on', async () => {
    const boom: AnyActionHandler = {
      type: 'boom',
      run: async () => {
        throw new Error('kaput');
      },
    };
    const spec = route({ actions: { card: { type: 'boom' } } });
    const t = setupReal(spec, { handlers: [...builtinHandlers, boom] });
    t.engine.start();
    await t.stay(ORIGIN, 1);
    await t.stay(P1, 6);
    expect(t.current()).toMatchObject({ view: 'info_sheet', props: { title: 'P1' } });
    t.current()?.answer({});
    await flush();
    expect(t.point('p1')?.state).toBe('completed');
    expect(t.engine.getState().status).toBe('running');
  });

  it("End from a card's menu cancels the run after confirming", async () => {
    const t = setupReal(route());
    t.engine.start();
    await t.stay(ORIGIN, 1);
    await t.stay(P1, 6);
    t.current()?.answer({ decision: 'cancel' });
    await flush();
    expect(t.confirms).toHaveLength(1);
    expect(t.engine.getState().status).toBe('cancelled');
    expect(t.navigations).toEqual(['summary']);
    expect(t.analytics).toHaveBeenCalledWith(
      'run_cancelled',
      expect.objectContaining({ reason: 'user' }),
    );
  });

  it('after a reload with a card open, the card comes back and completes the point', async () => {
    const spec = route();
    const before = setupReal(spec);
    before.engine.start();
    await before.stay(ORIGIN, 1);
    await before.stay(P1, 6);
    expect(before.current()?.props.pointId).toBe('p1');
    // The tab dies with the card open; the snapshot was saved as JSON.
    const snapshot = JSON.parse(JSON.stringify(before.engine.serialize())) as EngineSnapshot;
    before.events.stop();
    before.engine.destroy();

    const after = setupReal(spec, {
      time: before.time,
      engine: (options) => restoreGeoEngine(spec, snapshot, options),
    });
    await flush();
    expect(after.engine.getState().status).toBe('paused');
    expect(after.current()?.props.pointId).toBe('p1');
    after.current()?.answer({});
    await flush();
    expect(after.point('p1')?.state).toBe('completed');
    expect(after.engine.resume()).toBe(true);
  });
});
