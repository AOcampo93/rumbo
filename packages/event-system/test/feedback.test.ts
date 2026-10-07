import type { AnyEngineEvent, EngineEventType } from '@rumbo/geo-engine';
import type { ActionDef } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  defaultActionFor,
  INTERRUPTIONS,
  isInterruption,
  planFeedback,
  UI_TEXT_KEYS,
} from '../src/index.ts';
import defaultsSource from '../src/defaults.ts?raw';
import dispatcherSource from '../src/dispatcher.ts?raw';
import feedbackSource from '../src/feedback.ts?raw';
import cardsSource from '../src/handlers/cards.ts?raw';
import mediaSource from '../src/handlers/media.ts?raw';
import noticesSource from '../src/handlers/notices.ts?raw';
import { baseState, route } from './harness.ts';

const spec = route();

function event(type: EngineEventType, pointId: string | null = null): AnyEngineEvent {
  return {
    id: 'e1',
    type,
    trigger: null,
    pointId,
    timestamp: 0,
    data: {},
    state: baseState(),
  } as AnyEngineEvent;
}

const action = (feedback: ActionDef['feedback']): ActionDef => ({ type: 'info_sheet', feedback });

describe('planFeedback', () => {
  it('follows the table of §9.4', () => {
    expect(planFeedback(event('approach', 'p1'), null, spec)).toEqual({
      vibrate: [80],
      sound: 'approach',
    });
    expect(planFeedback(event('enter', 'p1'), null, spec)).toEqual({
      vibrate: [200, 100, 200],
      sound: 'arrive',
      notify: {
        title: { key: 'notify.arrive', params: { name: 'P1' } },
        body: { key: 'notify.tapToOpen' },
        tag: 'enter:p1',
        url: '/run?point=p1',
      },
    });
    expect(planFeedback(event('finished'), null, spec)).toMatchObject({
      vibrate: [100, 50, 100, 50, 300],
      sound: 'finish',
      notify: {
        title: { key: 'notify.finish', params: {} },
        tag: 'finished:events-test',
        url: '/run',
      },
    });
    for (const type of ['gps_weak', 'exit', 'started', 'paused', 'completed'] as const) {
      expect(planFeedback(event(type, 'p1'), null, spec)).toEqual({});
    }
  });

  it("lets an action silence its event's defaults", () => {
    const quiet = action({ vibrate: false, sound: null, notify: false });
    expect(planFeedback(event('enter', 'p1'), quiet, spec)).toEqual({});
    expect(planFeedback(event('enter', 'p1'), action({ sound: 'soft' }), spec).sound).toBe('soft');
  });

  it('lets an action add feedback to an event that has none', () => {
    const loud = action({ vibrate: true, sound: 'alert', notify: true });
    expect(planFeedback(event('exit', 'p2'), loud, spec)).toEqual({
      vibrate: [150],
      sound: 'alert',
      notify: {
        title: { key: 'notify.generic', params: { name: 'P2' } },
        body: { key: 'notify.tapToOpen' },
        tag: 'exit:p2',
        url: '/run?point=p2',
      },
    });
  });

  it('ignores sounds the app does not have', () => {
    expect(planFeedback(event('enter', 'p1'), action({ sound: 'trumpet' }), spec).sound).toBe(
      undefined,
    );
  });
});

describe('defaults', () => {
  it('give each interruption its decision preset', () => {
    for (const type of INTERRUPTIONS) {
      expect(isInterruption(type)).toBe(true);
      expect(defaultActionFor(event(type))).toEqual({
        id: `default:${type}`,
        type: 'decision',
        params: { preset: type },
      });
    }
    expect(isInterruption('enter')).toBe(false);
  });

  it('toast when approaching or back on track, and nothing else', () => {
    expect(defaultActionFor(event('approach', 'p1'))).toMatchObject({
      type: 'toast',
      presentation: 'toast',
      params: { messageKey: 'run.approaching' },
    });
    expect(defaultActionFor(event('back_on_track'))).toMatchObject({
      params: { messageKey: 'run.backOnTrack' },
    });
    for (const type of ['enter', 'finished', 'cancelled', 'error'] as const) {
      expect(defaultActionFor(event(type, 'p1'))).toBe(null);
    }
  });
});

describe('UI_TEXT_KEYS', () => {
  it('lists every i18n key in the sources, so the catalogs can be checked against it', () => {
    const sources = [
      defaultsSource,
      dispatcherSource,
      feedbackSource,
      cardsSource,
      mediaSource,
      noticesSource,
    ].join('\n');
    // i18n keys are the only quoted `namespace.name` strings in the code.
    const used = new Set([...sources.matchAll(/'([a-z]+(?:\.[a-zA-Z]+)+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(20);
    expect(
      [...used].filter((key) => !(UI_TEXT_KEYS as readonly string[]).includes(key ?? '')),
    ).toEqual([]);
    expect(new Set(UI_TEXT_KEYS).size).toBe(UI_TEXT_KEYS.length);
  });
});
