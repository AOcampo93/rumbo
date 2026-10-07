import { type Component, defineAsyncComponent } from 'vue';

// The views the event system asks for by name (event-system builtinHandlers,
// PROJECT_PLAN §9.7). Adding an action type = a handler in the package plus
// one entry here with its component.
const VIEWS: Record<string, () => Promise<{ default: Component }>> = {
  info_sheet: () => import('./ContentSheet.vue'),
  ai_template: () => import('./ContentSheet.vue'),
  quiz: () => import('./QuizSheet.vue'),
  video: () => import('./VideoSheet.vue'),
  decision: () => import('./DecisionSheet.vue'),
  coming_soon: () => import('./ComingSoonView.vue'),
  error: () => import('./ErrorSheet.vue'),
};

const cache = new Map<string, Component>();

/** The component of a view; unknown names get the basic content sheet. */
export function sheetComponent(view: string): Component {
  const name = view in VIEWS ? view : 'info_sheet';
  let component = cache.get(name);
  if (!component) {
    component = defineAsyncComponent(VIEWS[name] as () => Promise<{ default: Component }>);
    cache.set(name, component);
  }
  return component;
}

export const KNOWN_VIEWS = Object.keys(VIEWS);
