import {
  type DecisionParams,
  DecisionParamsSchema,
  type Interruption,
  type ToastParams,
  ToastParamsSchema,
} from '@rumbo/route-spec';
import type { ActionHandler, HandlerContext, UiText, ViewOutcome } from '../types.ts';
import { fromOutcome, pointProps } from './shared.ts';

// The params schemas live in route-spec: the API checks user routes with them.

/** A short notice that never blocks the run (e.g. "You're near the castle"). */
export const toastHandler: ActionHandler<ToastParams> = {
  type: 'toast',
  paramsSchema: ToastParamsSchema,
  presentation: 'toast',
  async run(params, context) {
    const message: UiText = params.message ?? {
      key: params.messageKey as string,
      params: context.point ? { name: context.point.name } : {},
    };
    context.ui.toast(message, {
      ...(params.icon ? { icon: params.icon } : {}),
      ...(params.durationMs ? { durationMs: params.durationMs } : {}),
    });
    return { status: 'done' };
  },
};

/** Name of a point of the route, if it exists. */
function nameOf(context: HandlerContext, pointId: string | null | undefined) {
  return context.route.points.find((p) => p.id === pointId)?.name ?? '';
}

/** Texts of the interruption sheets (S07), filled with the event's data. */
function presetTexts(preset: Interruption, context: HandlerContext) {
  const { event } = context;
  const target = nameOf(context, event.state.target?.pointId);
  switch (preset) {
    case 'deviation': {
      const distance = event.type === 'deviation' ? event.data.distanceToRoute : 0;
      return {
        icon: 'route-off',
        title: { key: 'decision.deviation.title' },
        body: { key: 'decision.deviation.body', params: { distance, name: target } },
        primary: { key: 'decision.deviation.primary' },
      };
    }
    case 'idle': {
      const minutes = event.type === 'idle' ? Math.round(event.data.idleSeconds / 60) : 0;
      return {
        icon: 'hourglass',
        title: { key: 'decision.idle.title' },
        body: { key: 'decision.idle.body', params: { minutes } },
        primary: { key: 'decision.idle.primary' },
      };
    }
    case 'out_of_order': {
      const expected = nameOf(
        context,
        event.type === 'out_of_order' ? event.data.expectedPointId : null,
      );
      return {
        icon: 'list-ordered',
        title: { key: 'decision.outOfOrder.title' },
        body: { key: 'decision.outOfOrder.body', params: { name: expected } },
        primary: { key: 'decision.outOfOrder.primary', params: { name: expected } },
      };
    }
    case 'timeout':
      return {
        icon: 'timer-off',
        title: { key: 'decision.timeout.title' },
        body: { key: 'decision.timeout.body' },
        primary: { key: 'decision.timeout.primary' },
      };
  }
}

/**
 * Interruption sheet with three choices (S07): the primary action resolves
 * as 'continue', then Pause and End the run. Swiping it away dismisses it.
 */
export const decisionHandler: ActionHandler<DecisionParams> = {
  type: 'decision',
  paramsSchema: DecisionParamsSchema,
  async run(params, context) {
    const texts =
      'preset' in params
        ? { preset: params.preset, ...presetTexts(params.preset, context) }
        : {
            preset: null,
            icon: null,
            title: params.title,
            body: params.body ?? null,
            primary: params.primaryLabel ?? ({ key: 'decision.continue' } satisfies UiText),
          };
    const outcome = await context.ui.present<ViewOutcome>(
      'decision',
      { ...pointProps(context), ...texts },
      { variant: 'sheet', signal: context.signal },
    );
    return fromOutcome(outcome);
  },
};
