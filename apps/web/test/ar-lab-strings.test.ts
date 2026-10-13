import { describe, expect, it } from 'vitest';
import {
  LANGS,
  overallHealth,
  resolveLang,
  rowHealth,
  type SetupChecks,
  STRINGS,
} from '../src/ar-lab/strings.ts';
import { describeVoiceError, fetchVoiceStatus } from '../src/ar/voice.ts';

// The AR lab page (/ra_test/): its language, its setup box and the voice status check.

describe('the page language', () => {
  it('takes the link first, then the page choice, then the app, then the browser', () => {
    const app = JSON.stringify({ locale: 'pt', theme: 'dark' });
    expect(resolveLang({ linkLang: 'en', pageLang: 'pt', appSettings: app })).toBe('en');
    expect(resolveLang({ linkLang: 'xx', pageLang: 'pt', appSettings: app })).toBe('pt');
    expect(resolveLang({ appSettings: app, browserLanguages: ['en-GB'] })).toBe('pt');
    expect(resolveLang({ appSettings: '{', browserLanguages: ['de-DE', 'en-US'] })).toBe('en');
    expect(resolveLang({ appSettings: JSON.stringify({ locale: null }) })).toBe('es');
    expect(resolveLang({})).toBe('es');
  });

  it('has every text in the three languages', () => {
    const shape = (value: unknown): unknown =>
      typeof value === 'object' && value
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
        : typeof value;
    for (const lang of LANGS) expect(shape(STRINGS[lang])).toEqual(shape(STRINGS.es));
    expect(STRINGS.en.setup.ok).toBe('All set');
    expect(STRINGS.pt.setup.ok).toBe('Tudo pronto');
  });

  it('describes the voice errors in each language', () => {
    expect(describeVoiceError('mic_denied')).toMatch(/micrófono/);
    expect(describeVoiceError('mic_denied', 'en')).toMatch(/microphone/);
    expect(describeVoiceError('mic_denied', 'pt')).toMatch(/microfone/);
  });
});

describe('the setup box', () => {
  const allGood: SetupChecks = { model: 'ok', voice: 'ok', mic: 'granted', xr: 'ok' };

  it('is green when nothing is misconfigured, also with neutral notes', () => {
    expect(overallHealth(allGood)).toBe('ok');
    // The mic will be asked for and AR isn't in this browser: notes, not problems.
    expect(overallHealth({ ...allGood, mic: 'prompt', xr: 'none' })).toBe('ok');
    expect(rowHealth({ ...allGood, mic: 'prompt', xr: 'appclip' })).toMatchObject({
      mic: 'note',
      xr: 'note',
    });
  });

  it('turns yellow for a missing or wrong code, a blocked mic, no voice, no model or no HTTPS', () => {
    for (const bad of [
      { voice: 'code_required' },
      { voice: 'code_invalid' },
      { voice: 'unavailable' },
      { voice: 'unknown' },
      { mic: 'denied' },
      { model: 'failed' },
      { xr: 'https' },
    ] as const) {
      expect(overallHealth({ ...allGood, ...bad })).toBe('warn');
    }
  });

  it('waits while something is still being checked', () => {
    expect(overallHealth({ ...allGood, voice: 'checking' })).toBe('pending');
    expect(overallHealth({ ...allGood, model: 'loading' })).toBe('pending');
    expect(overallHealth({ ...allGood, voice: 'checking', mic: 'denied' })).toBe('warn');
  });
});

describe('the voice status check', () => {
  const answer = (ok: boolean, body: unknown) => async (url: string) => {
    calls.push(url);
    return { ok, json: async () => body };
  };
  let calls: string[] = [];

  it('asks the API with the code and returns what it says', async () => {
    calls = [];
    expect(await fetchVoiceStatus(answer(true, { voice: 'ok' }), 'a b')).toBe('ok');
    expect(calls).toEqual(['/api/v1/ra-test/status?code=a%20b']);
    expect(await fetchVoiceStatus(answer(true, { voice: 'code_required' }), undefined)).toBe(
      'code_required',
    );
    expect(calls[1]).toBe('/api/v1/ra-test/status');
  });

  it('is unknown on an error, a strange answer or no network', async () => {
    expect(await fetchVoiceStatus(answer(false, { code: 'rate_limited' }), 'x')).toBe('unknown');
    expect(await fetchVoiceStatus(answer(true, { voice: 'maybe' }), 'x')).toBe('unknown');
    expect(await fetchVoiceStatus(() => Promise.reject(new Error('offline')), 'x')).toBe('unknown');
  });
});
