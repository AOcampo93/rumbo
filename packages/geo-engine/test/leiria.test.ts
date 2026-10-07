import { validateRouteBundle } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import route from '../../../data/routes/leiria-historica.json' with { type: 'json' };
import { createGeoEngine, createSimulatedSource } from '../src/index.ts';
import { createFakeTime } from './harness.ts';

describe('the curated Leiria route', () => {
  it('can be walked end to end in simulation, like the demo', () => {
    const spec = validateRouteBundle(route).bundle?.spec;
    if (!spec) throw new Error('the curated route must be valid');
    const time = createFakeTime();
    const simulation = createSimulatedSource({
      start: spec.points[0]?.position,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const engine = createGeoEngine(spec, {
      source: simulation,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    // Stand-in for the event system (phase 3): every card is read and closed.
    const visited: string[] = [];
    engine.on('enter', (event) => {
      if (!event.pointId) return;
      visited.push(event.pointId);
      engine.complete(event.pointId, { score: 10 });
    });

    engine.start();
    simulation.setTimeScale(20);
    for (const point of spec.points) {
      simulation.walkTo(point.position);
      const done = () =>
        engine.getState().points.find((p) => p.id === point.id)?.state === 'completed';
      for (let second = 0; second < 600 && !done(); second++) time.advance(1000);
    }

    const state = engine.getState();
    expect(visited).toEqual(spec.points.map((p) => p.id));
    expect(state.status).toBe('finished');
    expect(state.progress).toMatchObject({ completed: 12, total: 12, percent: 100, score: 120 });
    expect(state.stats.distanceMeters).toBeGreaterThan(2_000);
  });
});
