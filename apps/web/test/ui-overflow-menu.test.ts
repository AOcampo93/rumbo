import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import OverflowMenu, { type OverflowMenuItem } from '../src/components/OverflowMenu.vue';

// The ⋯ menu of place rows and My routes (WAI-ARIA menu button): a labelled
// trigger, a teleported role=menu with roving focus, and every way of closing
// it gives the focus back to the trigger.

const ITEMS: OverflowMenuItem[] = [
  { id: 'edit', label: 'Editar' },
  { id: 'up', label: 'Subir', disabled: true },
  { id: 'down', label: 'Bajar' },
  { id: 'delete', label: 'Eliminar', danger: true },
];

let wrapper: VueWrapper | null = null;

function mountMenu(items: OverflowMenuItem[] = ITEMS, attrs: Record<string, unknown> = {}) {
  wrapper = mount(OverflowMenu, {
    props: { items, label: 'Opciones de Castelo' },
    attrs,
    attachTo: document.body,
  });
  return wrapper;
}

const trigger = () => document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const focused = () => document.activeElement;
/** Opening places the menu, then focuses an item: a few ticks. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick();
};

function press(target: Element | null, key: string): void {
  target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('OverflowMenu', () => {
  it('is a labelled menu button whose click opens the menu on its first item', async () => {
    mountMenu();
    const button = trigger();
    expect(button?.getAttribute('aria-label')).toBe('Opciones de Castelo');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.hasAttribute('aria-controls')).toBe(false);
    expect(menu()).toBeNull();

    button?.click();
    await settle();
    const list = menu();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.getAttribute('aria-controls')).toBe(list?.id);
    expect(list?.getAttribute('aria-labelledby')).toBe(button?.id);
    // Teleported: a scrolling list or a sheet never clips it.
    expect(list?.parentElement).toBe(document.body);
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      'Editar',
      'Subir',
      'Bajar',
      'Eliminar',
    ]);
    expect(focused()).toBe(menuItems()[0]);
    expect(menuItems().map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('moves the focus with the arrows (wrapping), Home and End, disabled items included', async () => {
    mountMenu();
    trigger()?.click();
    await settle();
    const items = menuItems();
    const order: number[] = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) {
      press(focused(), key);
      order.push(items.indexOf(focused() as HTMLButtonElement));
    }
    expect(order).toEqual([1, 2, 3, 0, 3]);
    expect(items[1]?.getAttribute('aria-disabled')).toBe('true');
    press(focused(), 'Home');
    expect(focused()).toBe(items[0]);
    press(focused(), 'End');
    expect(focused()).toBe(items[3]);
    await nextTick();
    // Roving tabindex: only the focused item is in the tab order.
    expect(items.map((item) => item.tabIndex)).toEqual([-1, -1, -1, 0]);
    // Type-ahead: the next item starting with the letter.
    press(focused(), 'b');
    expect(focused()).toBe(items[2]);
  });

  it('selects an item (Enter/Space click it), closes and gives the focus back', async () => {
    const view = mountMenu();
    trigger()?.click();
    await settle();
    menuItems()[2]?.click();
    await settle();
    expect(view.emitted('select')).toEqual([['down']]);
    expect(menu()).toBeNull();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(trigger());
  });

  it('ignores a disabled item', async () => {
    const view = mountMenu();
    trigger()?.click();
    await settle();
    menuItems()[1]?.click();
    await settle();
    expect(view.emitted('select')).toBeUndefined();
    expect(menu()).not.toBeNull();
  });

  it('closes with Escape, Tab, an outside click or the trigger, focusing the trigger', async () => {
    const view = mountMenu();
    const outside = document.createElement('button');
    document.body.append(outside);

    trigger()?.click();
    await settle();
    press(focused(), 'Escape');
    await settle();
    expect(menu()).toBeNull();
    expect(focused()).toBe(trigger());

    trigger()?.click();
    await settle();
    press(focused(), 'Tab');
    await settle();
    expect(menu()).toBeNull();
    expect(focused()).toBe(trigger());

    trigger()?.click();
    await settle();
    // A press inside the menu keeps it open; one outside closes it.
    menu()?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu()).not.toBeNull();
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(menu()).toBeNull();
    expect(focused()).toBe(trigger());

    trigger()?.click();
    await settle();
    trigger()?.click();
    await settle();
    expect(menu()).toBeNull();
    expect(view.emitted('select')).toBeUndefined();
    outside.remove();
  });

  it('opens from the keyboard: ArrowDown on the first item, ArrowUp on the last', async () => {
    mountMenu();
    press(trigger(), 'ArrowUp');
    await settle();
    expect(focused()).toBe(menuItems()[3]);
    press(focused(), 'Escape');
    await settle();
    press(trigger(), 'ArrowDown');
    await settle();
    expect(focused()).toBe(menuItems()[0]);
  });

  it('marks danger items and separates them from the others', async () => {
    mountMenu();
    trigger()?.click();
    await settle();
    const danger = menuItems()[3];
    expect(danger?.classList.contains('is-danger')).toBe(true);
    expect(danger?.parentElement?.classList.contains('overflow__sep')).toBe(true);
    expect(menuItems()[0]?.classList.contains('is-danger')).toBe(false);
  });

  it('passes class and other attributes to the trigger', () => {
    mountMenu(ITEMS, { class: 'row__menu', 'data-testid': 'place-menu' });
    expect(trigger()?.classList.contains('row__menu')).toBe(true);
    expect(trigger()?.dataset.testid).toBe('place-menu');
  });

  it('sits under the trigger, or above it near the bottom of the viewport', async () => {
    const height = window.innerHeight;
    const rect = (top: number) =>
      ({ top, bottom: top + 48, left: 300, right: 348, width: 48, height: 48 }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(220);

    mountMenu();
    const button = trigger() as HTMLButtonElement;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(100));
    button.click();
    await settle();
    expect(menu()?.classList.contains('overflow__menu--down')).toBe(true);
    expect(menu()?.style.top).toBe('152px');
    // Right edges aligned: 348 - 220.
    expect(menu()?.style.left).toBe('128px');

    press(focused(), 'Escape');
    await settle();
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(height - 60));
    button.click();
    await settle();
    expect(menu()?.classList.contains('overflow__menu--up')).toBe(true);
    expect(menu()?.style.bottom).toBe(`${60 + 4}px`);
    expect(menu()?.style.top).toBe('');
  });

  it('closes when its items go away (the row was removed)', async () => {
    const view = mountMenu();
    trigger()?.click();
    await settle();
    await view.setProps({ items: [] });
    await settle();
    expect(menu()).toBeNull();
  });
});
