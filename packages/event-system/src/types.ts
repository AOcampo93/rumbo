import type { AnyEngineEvent, GeoEngine } from '@rumbo/geo-engine';
import type {
  ActionDef,
  LocalizedContent,
  LocalizedText,
  NormalizedRoutePoint,
  NormalizedRouteSpec,
} from '@rumbo/route-spec';
import type { z } from 'zod';

// Contract of docs/PROJECT_PLAN.md §9.2, with ADR 0001: this package never
// produces display text. It hands the UI i18n keys or the route's own texts.

/** An i18n key with its parameters, or a text that comes from the route. */
export type UiText =
  { key: string; params?: Record<string, string | number | LocalizedText> } | LocalizedText;

export type Decision = 'continue' | 'pause' | 'cancel';

/** What a presented view resolves with. Every field is optional. */
export interface ViewOutcome {
  /** 'dismissed' when the user swiped the sheet away. Default 'done'. */
  status?: 'done' | 'dismissed';
  /** From the sheet's menu (Pause / End) or a decision sheet. */
  decision?: Decision;
  /** Free data, e.g. the quiz answer. */
  data?: unknown;
}

/** The DOM's AbortSignal, reduced to what handlers need (the package has no DOM types). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** Where the app can be sent; the app maps it to its router. */
export type UiDestination = 'summary';

/** Implemented by the app: it renders views and owns navigation. */
export interface UiAdapter {
  /** Opens a view (sheet, modal, fullscreen) and resolves when the user closes it. */
  present<R = ViewOutcome>(
    view: string,
    props: Record<string, unknown>,
    options?: { variant?: 'sheet' | 'modal' | 'fullscreen'; signal?: AbortSignalLike },
  ): Promise<R | undefined>;
  toast(message: UiText, options?: { icon?: string; durationMs?: number }): void;
  confirm(options: {
    title: UiText;
    body?: UiText;
    confirmLabel: UiText;
    cancelLabel: UiText;
    destructive?: boolean;
    /** Closes the dialog, as if declined, when aborted. */
    signal?: AbortSignalLike;
  }): Promise<boolean>;
  openExternal(url: string): void;
  navigate(to: UiDestination): void;
}

export type Sound = 'approach' | 'arrive' | 'alert' | 'finish' | 'soft';

/** Implemented by the app: vibration, sound and local notifications. */
export interface FeedbackAdapter {
  /** Android only; the adapter ignores it where unsupported. */
  vibrate(pattern: number[]): void;
  play(sound: Sound): void;
  /** The adapter only shows it while the app is in the background. */
  notify(notification: { title: UiText; body: UiText; tag: string; url?: string }): void;
}

export interface HandlerResult {
  status: 'done' | 'dismissed' | 'failed';
  decision?: Decision;
  score?: number;
  data?: unknown;
}

export interface HandlerContext {
  event: AnyEngineEvent;
  route: NormalizedRouteSpec;
  point: NormalizedRoutePoint | null;
  /** The action being run, with its id. */
  action: ActionDef & { id: string };
  /** A card in every language available (from the offline bundle or the API). */
  content(ref: string): Promise<LocalizedContent | null>;
  ui: UiAdapter;
  feedback: FeedbackAdapter;
  analytics(name: string, props?: Record<string, unknown>): void;
  /**
   * Aborted when the run is cancelled or the event system stops, and when the
   * user walks out of the point's zone with its arrival card open: close
   * whatever is open (the card resolves as dismissed).
   */
  signal: AbortSignalLike;
}

/** One action type (`ActionDef.type`). Adding a type never touches the engine. */
export interface ActionHandler<P = Record<string, unknown>> {
  type: string;
  /** Validates `ActionDef.params`; invalid params fall back to a basic sheet. */
  paramsSchema?: z.ZodType<P>;
  /** Default presentation; an action's own `presentation` wins. */
  presentation?: 'blocking' | 'toast';
  /** Lazy preload of heavy dependencies (e.g. Three.js). */
  load?(): Promise<void>;
  run(params: P, context: HandlerContext): Promise<HandlerResult>;
}

/**
 * A handler of any params type, as a registry stores it. Every
 * `ActionHandler<P>` fits: params are only passed after its schema accepted them.
 */
export interface AnyActionHandler {
  type: string;
  paramsSchema?: Pick<z.ZodType<unknown>, 'safeParse'>;
  presentation?: 'blocking' | 'toast';
  load?(): Promise<void>;
  run(params: never, context: HandlerContext): Promise<HandlerResult>;
}

/** The slice of the engine the dispatcher drives. */
export type EngineControls = Pick<
  GeoEngine,
  'on' | 'getState' | 'complete' | 'pause' | 'resume' | 'cancel'
>;

export interface Logger {
  warn(message: string, data?: unknown): void;
}

export interface EventSystemOptions {
  engine: EngineControls;
  route: NormalizedRouteSpec;
  /** Registered handlers; the built-in ones are in `builtinHandlers`. */
  handlers: readonly AnyActionHandler[];
  ui: UiAdapter;
  feedback: FeedbackAdapter;
  content?: (ref: string) => Promise<LocalizedContent | null>;
  analytics?: (name: string, props?: Record<string, unknown>) => void;
  logger?: Logger;
  /** Epoch ms, for measuring how long each action took. */
  now?: () => number;
}

export interface EventSystem {
  /** Subscribes to the engine's events. */
  start(): void;
  /** Unsubscribes, aborts the running action and empties the queue. */
  stop(): void;
  /** True while a blocking action is open. */
  readonly busy: boolean;
}
