import type { Clock, Scheduler } from './types.ts';

// The engine never touches the DOM. These defaults only reach the timers that
// browsers and Node both put on globalThis, typed by hand so the package can
// keep `lib: ES2023` without DOM types.
const host = globalThis as unknown as {
  performance?: { now(): number };
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
};

/** Real time: Date.now for timestamps, performance.now for durations. */
export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => host.performance?.now() ?? Date.now(),
};

/** setInterval-based scheduler. */
export const intervalScheduler: Scheduler = {
  every(ms, fn) {
    const id = host.setInterval(fn, ms);
    return () => host.clearInterval(id);
  },
};
