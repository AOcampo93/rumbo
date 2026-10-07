import type { AbortSignalLike, UiText, ViewOutcome } from '@rumbo/event-system';
import type { Locale } from '@rumbo/route-spec';
import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';

// The overlay stack: sheets, dialogs and toasts (PROJECT_PLAN §10.2: sheets are
// not routes). The event system's UiAdapter is built on top of this store, and
// screens use it directly for their own confirmations and notices.

export type SheetVariant = 'sheet' | 'modal' | 'fullscreen';

export interface SheetEntry {
  id: number;
  /** Name of the view to render (see handlers/registry.ts). */
  view: string;
  props: Record<string, unknown>;
  variant: SheetVariant;
  /** Language of the route texts inside `props`. */
  sourceLocale: Locale;
  close(outcome?: ViewOutcome): void;
}

export interface ToastEntry {
  id: number;
  message: UiText;
  icon?: string;
  tone: 'info' | 'success' | 'warning';
  sourceLocale: Locale;
}

export interface ConfirmOptions {
  title: UiText;
  body?: UiText;
  confirmLabel: UiText;
  cancelLabel: UiText;
  destructive?: boolean;
  sourceLocale?: Locale;
}

export interface ConfirmEntry extends ConfirmOptions {
  id: number;
  answer(ok: boolean): void;
}

const TOAST_MS = 3500;

export const useUiStore = defineStore('ui', () => {
  const sheets = shallowRef<SheetEntry[]>([]);
  const toasts = shallowRef<ToastEntry[]>([]);
  const confirms = shallowRef<ConfirmEntry[]>([]);
  let nextId = 1;

  /** Opens a view on top of everything; resolves when it closes (undefined: swiped away). */
  function present<R = ViewOutcome>(
    view: string,
    props: Record<string, unknown>,
    options: { variant?: SheetVariant; signal?: AbortSignalLike; sourceLocale?: Locale } = {},
  ): Promise<R | undefined> {
    return new Promise((resolve) => {
      const id = nextId++;
      let done = false;
      const close = (outcome?: ViewOutcome) => {
        if (done) return;
        done = true;
        sheets.value = sheets.value.filter((sheet) => sheet.id !== id);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(outcome as R | undefined);
      };
      // A cancelled run closes whatever it had open (event-system contract).
      const onAbort = () => close(undefined);
      if (options.signal?.aborted) {
        resolve(undefined);
        return;
      }
      options.signal?.addEventListener('abort', onAbort);
      const entry: SheetEntry = {
        id,
        view,
        props,
        variant: options.variant ?? 'sheet',
        sourceLocale: options.sourceLocale ?? 'es',
        close,
      };
      sheets.value = [...sheets.value, entry];
    });
  }

  /** Closes the sheet on top, as a swipe or the back gesture would. */
  function dismissTop(): boolean {
    const top = sheets.value.at(-1);
    if (!top) return false;
    top.close({ status: 'dismissed' });
    return true;
  }

  function toast(
    message: UiText,
    options: {
      icon?: string;
      durationMs?: number;
      tone?: ToastEntry['tone'];
      sourceLocale?: Locale;
    } = {},
  ): void {
    const id = nextId++;
    const entry: ToastEntry = {
      id,
      message,
      tone: options.tone ?? 'info',
      sourceLocale: options.sourceLocale ?? 'es',
      ...(options.icon ? { icon: options.icon } : {}),
    };
    // Newest on top; never more than three at once.
    toasts.value = [entry, ...toasts.value].slice(0, 3);
    setTimeout(() => dismissToast(id), options.durationMs ?? TOAST_MS);
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const id = nextId++;
      const entry: ConfirmEntry = {
        ...options,
        id,
        answer(ok) {
          confirms.value = confirms.value.filter((c) => c.id !== id);
          resolve(ok);
        },
      };
      confirms.value = [...confirms.value, entry];
    });
  }

  /** Closes everything (e.g. when leaving the run). */
  function clear(): void {
    for (const sheet of [...sheets.value]) sheet.close(undefined);
    for (const entry of [...confirms.value]) entry.answer(false);
    toasts.value = [];
  }

  const topSheet = computed(() => sheets.value.at(-1) ?? null);

  return {
    sheets,
    toasts,
    confirms,
    topSheet,
    present,
    dismissTop,
    toast,
    dismissToast,
    confirm,
    clear,
  };
});
