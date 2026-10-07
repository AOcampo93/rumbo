import { intervalScheduler, systemClock } from '../runtime.ts';
import type { Clock, PositionSample, PositionSource, Scheduler } from '../types.ts';

export interface ReplaySourceOptions {
  /** 2 plays twice as fast. Default 1. */
  timeScale?: number;
  clock?: Clock;
  scheduler?: Scheduler;
  /** How often due readings are released, in ms. Default 100. */
  pollMs?: number;
  /** Called once every reading has been played. */
  onEnd?: () => void;
}

export interface ReplaySource extends PositionSource {
  readonly kind: 'replay';
  readonly done: boolean;
}

/**
 * Plays a recorded track (see createTrackRecorder) with its original rhythm,
 * optionally sped up. Timestamps are shifted to "now" so the engine sees a
 * live run. Trusted: a recording is replayed exactly as captured.
 */
export function createReplaySource(
  samples: readonly PositionSample[],
  options: ReplaySourceOptions = {},
): ReplaySource {
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? intervalScheduler;
  const timeScale = options.timeScale ?? 1;
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const firstTimestamp = ordered[0]?.timestamp ?? 0;

  let index = 0;
  let startedMono = 0;
  let startedEpoch = 0;
  let done = ordered.length === 0;
  let onSample: ((sample: PositionSample) => void) | null = null;
  let cancel: (() => void) | null = null;

  function release(): void {
    const playedMs = (clock.monotonic() - startedMono) * timeScale;
    let next = ordered[index];
    while (onSample && next && next.timestamp - firstTimestamp <= playedMs) {
      index += 1;
      onSample({
        ...next,
        timestamp: startedEpoch + (next.timestamp - firstTimestamp) / timeScale,
      });
      next = ordered[index];
    }
    if (!done && index >= ordered.length) {
      done = true;
      options.onEnd?.();
    }
  }

  return {
    kind: 'replay',
    trusted: true,
    get done() {
      return done;
    },
    start(sample) {
      onSample = sample;
      index = 0;
      done = ordered.length === 0;
      startedMono = clock.monotonic();
      startedEpoch = clock.now();
      cancel ??= scheduler.every(options.pollMs ?? 100, release);
      release();
    },
    stop() {
      cancel?.();
      cancel = null;
      onSample = null;
    },
  };
}
