import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../src/stores/ui.ts';

// The overlay stack behind the event system's UiAdapter (PROJECT_PLAN §10.2).

beforeEach(() => setActivePinia(createPinia()));

describe('the overlay stack', () => {
  it('opens sheets on top and resolves each with its outcome', async () => {
    const ui = useUiStore();
    const first = ui.present('info_sheet', { title: 'A' });
    const second = ui.present('quiz', {});
    expect(ui.sheets.map((s) => s.view)).toEqual(['info_sheet', 'quiz']);
    expect(ui.dismissTop()).toBe(true);
    expect(await second).toEqual({ status: 'dismissed' });
    ui.topSheet?.close({ status: 'done', decision: 'pause' });
    expect(await first).toEqual({ status: 'done', decision: 'pause' });
    expect(ui.dismissTop()).toBe(false);
  });

  it('closes a sheet when the run is cancelled (abort signal)', async () => {
    const ui = useUiStore();
    const controller = new AbortController();
    const open = ui.present('info_sheet', {}, { signal: controller.signal });
    controller.abort();
    expect(await open).toBe(undefined);
    expect(ui.sheets).toEqual([]);
    expect(await ui.present('x', {}, { signal: controller.signal })).toBe(undefined);
  });

  it('answers confirmations and keeps at most three toasts', async () => {
    vi.useFakeTimers();
    const ui = useUiStore();
    const answer = ui.confirm({
      title: { key: 'end.confirm.title' },
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      destructive: true,
    });
    ui.confirms[0]?.answer(true);
    expect(await answer).toBe(true);
    for (let i = 0; i < 5; i++) ui.toast({ key: 'run.backOnTrack' });
    expect(ui.toasts).toHaveLength(3);
    vi.advanceTimersByTime(4000);
    expect(ui.toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('runs a toast action once ("Deshacer") and keeps such toasts longer', () => {
    vi.useFakeTimers();
    const ui = useUiStore();
    const run = vi.fn();
    ui.toast(
      { key: 'create.places.removed', params: { name: 'Sé' } },
      { action: { label: { key: 'create.places.undo' }, run } },
    );
    vi.advanceTimersByTime(4000);
    const [toast] = ui.toasts;
    expect(toast?.action?.label).toEqual({ key: 'create.places.undo' });
    ui.runToastAction(toast?.id ?? 0);
    ui.runToastAction(toast?.id ?? 0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(ui.toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
