import type { AnyEngineEvent, EngineEventType } from '@rumbo/geo-engine';
import { type ActionDef, INTERRUPTIONS, type Interruption } from '@rumbo/route-spec';

// Defined in route-spec, next to the decision params, so the API checks user
// routes with the same list; re-exported to keep this package's API.
export { INTERRUPTIONS, type Interruption };

export function isInterruption(type: EngineEventType): type is Interruption {
  return (INTERRUPTIONS as readonly string[]).includes(type);
}

/**
 * What runs when an event carries no trigger (docs/PROJECT_PLAN.md §9.3):
 * a short toast when approaching a point or getting back on track, and the
 * decision sheet with its preset for every interruption. Arrivals without an
 * action are completed by the engine itself.
 */
export function defaultActionFor(event: AnyEngineEvent): (ActionDef & { id: string }) | null {
  switch (event.type) {
    case 'approach':
      return {
        id: 'default:approach',
        type: 'toast',
        presentation: 'toast',
        params: { messageKey: 'run.approaching', icon: 'map-pin' },
      };
    case 'back_on_track':
      return {
        id: 'default:back_on_track',
        type: 'toast',
        presentation: 'toast',
        params: { messageKey: 'run.backOnTrack', icon: 'circle-check' },
      };
    case 'deviation':
    case 'idle':
    case 'out_of_order':
    case 'timeout':
      return { id: `default:${event.type}`, type: 'decision', params: { preset: event.type } };
    default:
      return null;
  }
}
