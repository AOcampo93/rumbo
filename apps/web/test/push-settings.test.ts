import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import type { PushState } from '../src/services/push.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import SettingsView from '../src/views/SettingsView.vue';

// S12 · the Avisos section: the push switch with one line of text per state,
// next to the sound, vibration and notification rows that were already there.

const push = vi.hoisted(() => ({
  pushState: vi.fn<() => Promise<PushState>>(),
  enablePush: vi.fn<() => Promise<PushState>>(),
  disablePush: vi.fn<() => Promise<PushState>>(),
}));
vi.mock('../src/services/push.ts', () => push);

let wrapper: VueWrapper | null = null;

/** A promise settled by hand, to hold a request in flight. */
function deferred() {
  let settle!: (state: PushState) => void;
  const promise = new Promise<PushState>((resolve) => (settle = resolve));
  return { promise, settle };
}

async function open(state: PushState | Promise<PushState> = 'off') {
  push.pushState.mockReturnValueOnce(Promise.resolve(state));
  const pinia = createPinia();
  setActivePinia(pinia);
  wrapper = mount(SettingsView, { global: { plugins: [pinia, i18n] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const text = (key: string) => i18n.global.t(key);
const pushSwitch = () => {
  const found = wrapper?.get(`[role="switch"][aria-label="${text('settings.push.label')}"]`);
  if (!found) throw new Error('the push switch is not on screen');
  return found;
};
const isDisabled = () => (pushSwitch().element as HTMLButtonElement).disabled;
const isOn = () => pushSwitch().attributes('aria-checked') === 'true';
const hint = () => wrapper?.get('#s-push-hint').text();

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  applyLocale('es');
  localStorage.clear();
  push.pushState.mockReset();
  push.enablePush.mockReset();
  push.disablePush.mockReset();
  // The version file the About section reads: none, offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(navigator, 'vibrate');
  vi.unstubAllGlobals();
});

describe('the push switch', () => {
  it.each([
    ['off', 'settings.push.off', false, false],
    ['on', 'settings.push.on', true, false],
    ['needs-install', 'settings.push.needsInstall', false, true],
    ['denied', 'settings.push.denied', false, true],
    ['unavailable', 'settings.push.unavailable', false, true],
    ['unsupported', 'settings.push.unsupported', false, true],
  ] as const)(
    'says what %s means and is only a choice when there is one',
    async (state, key, on, locked) => {
      await open(state);
      expect(hint()).toBe(text(key));
      expect(isOn()).toBe(on);
      expect(isDisabled()).toBe(locked);
    },
  );

  it('tells an iPhone user how to add the app to the home screen', async () => {
    await open('needs-install');
    expect(hint()).toContain('pantalla de inicio');
    expect(hint()).toContain('Compartir');
  });

  it('follows the language', async () => {
    await open('denied');
    expect(hint()).toContain('ajustes del navegador');
    applyLocale('pt');
    await flushPromises();
    expect(hint()).toContain('definições do navegador');
    applyLocale('en');
    await flushPromises();
    expect(hint()).toContain('browser or device settings');
    expect(pushSwitch().attributes('aria-label')).toBe('Push notifications');
  });

  it('is locked, and says nothing, until the state is known', async () => {
    const reading = deferred();
    await open(reading.promise);
    expect(isDisabled()).toBe(true);
    expect(isOn()).toBe(false);
    expect(hint()).toBe('');
    reading.settle('off');
    await flushPromises();
    expect(isDisabled()).toBe(false);
    expect(hint()).toBe(text('settings.push.off'));
  });

  it('is described by its text, for screen readers', async () => {
    await open('off');
    expect(pushSwitch().attributes('aria-describedby')).toBe('s-push-hint');
  });
});

describe('turning push on and off', () => {
  it('turns it on from the tap itself, locked while it works', async () => {
    const enabling = deferred();
    push.enablePush.mockReturnValue(enabling.promise);
    await open('off');

    // Safari only shows the permission prompt to code in the tap's own turn.
    (pushSwitch().element as HTMLButtonElement).click();
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(isDisabled()).toBe(true);
    // A second tap while it works does nothing.
    (pushSwitch().element as HTMLButtonElement).click();
    expect(push.enablePush).toHaveBeenCalledTimes(1);

    enabling.settle('on');
    await flushPromises();
    expect(push.disablePush).not.toHaveBeenCalled();
    expect(isOn()).toBe(true);
    expect(isDisabled()).toBe(false);
    expect(hint()).toBe(text('settings.push.on'));
  });

  it('turns it off', async () => {
    push.disablePush.mockResolvedValue('off');
    await open('on');
    await pushSwitch().trigger('click');
    await flushPromises();
    expect(push.disablePush).toHaveBeenCalledTimes(1);
    expect(push.enablePush).not.toHaveBeenCalled();
    expect(isOn()).toBe(false);
    expect(hint()).toBe(text('settings.push.off'));
  });

  it.each([
    ['refuses the prompt', 'denied', 'settings.push.denied'],
    ['finds the server has push off', 'unavailable', 'settings.push.unavailable'],
    ['dismisses the prompt', 'off', 'settings.push.off'],
  ] as const)('shows what happened when the user %s', async (_what, state, key) => {
    push.enablePush.mockResolvedValue(state);
    await open('off');
    await pushSwitch().trigger('click');
    await flushPromises();
    expect(isOn()).toBe(false);
    expect(hint()).toBe(text(key));
    expect(isDisabled()).toBe(state !== 'off');
  });

  it('stays on when turning it off fails', async () => {
    push.disablePush.mockResolvedValue('on');
    await open('on');
    await pushSwitch().trigger('click');
    await flushPromises();
    expect(isOn()).toBe(true);
    expect(isDisabled()).toBe(false);
  });
});

describe('reading the state again', () => {
  it('does it when the user comes back, e.g. from the browser settings', async () => {
    await open('denied');
    expect(hint()).toBe(text('settings.push.denied'));
    push.pushState.mockResolvedValueOnce('on');
    setVisibility('visible');
    await flushPromises();
    expect(push.pushState).toHaveBeenCalledTimes(2);
    expect(isOn()).toBe(true);
    expect(isDisabled()).toBe(false);
  });

  it('does not while the page is hidden, nor after leaving the screen', async () => {
    await open('off');
    setVisibility('hidden');
    await flushPromises();
    expect(push.pushState).toHaveBeenCalledTimes(1);
    wrapper?.unmount();
    wrapper = null;
    setVisibility('visible');
    await flushPromises();
    expect(push.pushState).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt a tap that is working', async () => {
    const enabling = deferred();
    push.enablePush.mockReturnValue(enabling.promise);
    await open('off');
    await pushSwitch().trigger('click');
    setVisibility('visible');
    await flushPromises();
    expect(push.pushState).toHaveBeenCalledTimes(1);
    enabling.settle('on');
    await flushPromises();
    expect(isOn()).toBe(true);
  });

  it('drops a read that a tap has made out of date', async () => {
    await open('off');
    const late = deferred();
    push.pushState.mockReturnValueOnce(late.promise);
    setVisibility('visible');
    push.enablePush.mockResolvedValue('on');
    await pushSwitch().trigger('click');
    await flushPromises();
    expect(isOn()).toBe(true);
    // The read started before the tap comes back with the old answer.
    late.settle('off');
    await flushPromises();
    expect(isOn()).toBe(true);
  });
});

describe('the rows that were already there', () => {
  it('keep working next to the push switch', async () => {
    Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true });
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
    });
    await open('off');
    const settings = useSettingsStore();

    const alerts = wrapper?.get('section[aria-labelledby="s-alerts"]');
    const switches = alerts
      ?.findAll('[role="switch"]')
      .map((found) => found.attributes('aria-label'));
    expect(switches).toEqual([
      text('settings.sound'),
      text('settings.vibration'),
      text('settings.push.label'),
    ]);

    const sound = alerts?.get(`[aria-label="${text('settings.sound')}"]`);
    expect(settings.sound).toBe(true);
    await sound?.trigger('click');
    expect(settings.sound).toBe(false);
    const vibration = alerts?.get(`[aria-label="${text('settings.vibration')}"]`);
    await vibration?.trigger('click');
    expect(settings.vibration).toBe(false);

    // The local notifications row: its own button and its own text.
    expect(alerts?.text()).toContain(text('settings.notifications.label'));
    const enable = alerts?.findAll('button').find((button) => button.text() === 'Activar');
    expect(enable).toBeDefined();
    await enable?.trigger('click');
    await flushPromises();
    expect(alerts?.text()).toContain(text('settings.notifications.granted'));
    // Push is its own choice: allowing notifications did not turn it on.
    expect(isOn()).toBe(false);
  });
});
