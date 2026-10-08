import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverlayHost from '../src/components/OverlayHost.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { useUiStore } from '../src/stores/ui.ts';

// The overlay stack's toasts and dialogs (DESIGN §7): a toast's action is its
// own button next to the message (never inside the dismiss button), and a
// confirmation is an alertdialog named by its title and described by its body.

let wrapper: VueWrapper | null = null;

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  wrapper = mount(OverlayHost, { global: { plugins: [pinia, i18n] }, attachTo: document.body });
  return { ui: useUiStore(), view: wrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
  applyLocale('es');
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe('OverlayHost toasts', () => {
  it('shows a plain toast as one button that dismisses it', async () => {
    const { ui, view } = setup();
    ui.toast({ key: 'myRoutes.deleted' }, { tone: 'success' });
    await flushPromises();
    const toast = view.get('.toast');
    expect(toast.findAll('button')).toHaveLength(1);
    expect(toast.text()).toBe('Ruta eliminada');
    await toast.get('.toast__body').trigger('click');
    expect(ui.toasts).toEqual([]);
  });

  it('renders the action as its own button and runs it once', async () => {
    const { ui, view } = setup();
    const run = vi.fn();
    ui.toast(
      { key: 'create.places.removed', params: { name: 'Castelo' } },
      { action: { label: { key: 'create.places.undo' }, run } },
    );
    await flushPromises();
    const action = view.get('.toast__action');
    expect(action.element.tagName).toBe('BUTTON');
    expect(action.text()).toBe('Deshacer');
    // Not nested in the dismiss button (interactive content can't nest).
    expect(action.element.closest('.toast__body')).toBeNull();
    expect(view.get('.toast__body').text()).toBe('Castelo eliminado');

    await action.trigger('click');
    expect(run).toHaveBeenCalledTimes(1);
    expect(ui.toasts).toEqual([]);
  });

  it('dismissing a toast with an action does not run it', async () => {
    const { ui, view } = setup();
    const run = vi.fn();
    ui.toast(
      { key: 'myRoutes.deleted' },
      { action: { label: { key: 'create.places.undo' }, run } },
    );
    await flushPromises();
    await view.get('.toast__body').trigger('click');
    expect(run).not.toHaveBeenCalled();
    expect(ui.toasts).toEqual([]);
  });

  it('switches the action label with the language', async () => {
    const { ui, view } = setup();
    ui.toast(
      { key: 'myRoutes.deleted' },
      { action: { label: { key: 'create.places.undo' }, run() {} } },
    );
    await flushPromises();
    applyLocale('pt');
    await flushPromises();
    expect(view.get('.toast__action').text()).toBe('Anular');
  });
});

describe('OverlayHost confirmations', () => {
  it('names the dialog by its title and describes it by its body', async () => {
    const { ui } = setup();
    const answer = ui.confirm({
      title: { key: 'myRoutes.deleteTitle', params: { name: 'Mi ruta' } },
      body: { es: 'Primero.\n\nSegundo.', en: 'First.\n\nSecond.' },
      confirmLabel: { key: 'myRoutes.delete' },
      cancelLabel: { key: 'common.cancel' },
      destructive: true,
    });
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
    const body = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');
    expect(title?.textContent?.trim()).toBe('¿Eliminar «Mi ruta»?');
    // Paragraphs joined with blank lines stay apart (white-space: pre-line).
    expect(body?.textContent?.trim()).toBe('Primero.\n\nSegundo.');
    expect(body?.classList.contains('dialog__body')).toBe(true);

    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Eliminar',
    );
    confirm?.click();
    expect(await answer).toBe(true);
  });
});
