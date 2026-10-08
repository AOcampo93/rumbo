import { LOCALES, type Locale, type LocalizedText } from '@rumbo/route-spec';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { deleteMyRoute, retryMyRoute } from '../services/myRoutes.ts';
import { useCreatorStore } from '../stores/creator.ts';
import { useRunStore } from '../stores/run.ts';
import { useUiStore } from '../stores/ui.ts';

// What Edit, Delete and Retry do to a route made with the creator. My routes
// (S02) and the route detail (S03) both offer them, so the confirmations, the
// warnings about a run in progress and the clean-up after a delete live here.
// Call it from a component's setup: it needs the router, the stores and i18n.

/** The route an action is about, as its dialogs need it. */
export interface MyRouteTarget {
  id: string;
  /** The name as stored (the dialog resolves it in the active language); null when it can't be read. */
  name: LocalizedText | null;
  /** Language of `name`. */
  sourceLocale: Locale;
}

export function useMyRouteActions() {
  const { t } = useI18n();
  const router = useRouter();
  const creator = useCreatorStore();
  const run = useRunStore();
  const ui = useUiStore();

  /** The route an action is running for: one at a time, so a double tap does nothing. */
  const busy = ref<string | null>(null);

  /** The route has a run in progress (a creator trial belongs to the draft, not to the route). */
  const isActiveRun = (id: string): boolean => run.active && !run.trial && run.routeId === id;

  /** Several catalog texts as one dialog body, in every language (the dialog shows the active one). */
  function paragraphs(keys: readonly string[]): LocalizedText {
    const text: Partial<Record<Locale, string>> = {};
    for (const lang of LOCALES)
      text[lang] = keys.map((key) => t(key, {}, { locale: lang })).join('\n\n');
    return text as LocalizedText;
  }

  /**
   * Opens the creator on the route. Another route's draft (or a new one) would
   * be replaced, so that is confirmed first. Resolves true once the creator is
   * open on the route, false when nothing happened (busy, declined, unreadable).
   */
  async function edit(id: string): Promise<boolean> {
    if (busy.value) return false;
    busy.value = id;
    try {
      await creator.ready;
      if (creator.hasContent && creator.draft?.editingId !== id) {
        const replace = await ui.confirm({
          title: { key: 'create.draft.replaceTitle' },
          body: { key: 'create.draft.replaceBody' },
          confirmLabel: { key: 'create.draft.replace' },
          cancelLabel: { key: 'common.cancel' },
          destructive: true,
        });
        if (!replace) return false;
      }
      // Unknown or unreadable: loadForEdit says so with a toast.
      if (!(await creator.loadForEdit(id))) return false;
      if (isActiveRun(id)) ui.toast({ key: 'myRoutes.activeRunEdit' }, { tone: 'warning' });
      await router.push({ name: 'create-details' });
      return true;
    } finally {
      busy.value = null;
    }
  }

  /**
   * Deletes the route after a destructive confirmation: its run ends (without
   * a summary), the route goes from the device (and the server, once online),
   * and so does a draft that was editing it. Resolves true when it was deleted;
   * the caller decides where to go next.
   */
  async function remove(target: MyRouteTarget): Promise<boolean> {
    if (busy.value) return false;
    const { id } = target;
    const confirmed = await ui.confirm({
      title: target.name
        ? { key: 'myRoutes.deleteTitle', params: { name: target.name } }
        : { key: 'myRoutes.deleteThisTitle' },
      body: isActiveRun(id)
        ? paragraphs(['myRoutes.activeRunDelete', 'myRoutes.deleteBody'])
        : { key: 'myRoutes.deleteBody' },
      confirmLabel: { key: 'myRoutes.delete' },
      cancelLabel: { key: 'common.cancel' },
      destructive: true,
      sourceLocale: target.sourceLocale,
    });
    if (!confirmed || busy.value) return false;
    busy.value = id;
    try {
      // A route's run can't outlive it: it ends here, without a summary.
      if (isActiveRun(id)) run.reset();
      await deleteMyRoute(id);
      await creator.discardIfEditing(id);
      ui.toast({ key: 'myRoutes.deleted' }, { tone: 'success' });
      return true;
    } catch (error) {
      console.warn('my routes: the route could not be deleted', error);
      ui.toast({ key: 'errors.generic' }, { tone: 'warning' });
      return false;
    } finally {
      busy.value = null;
    }
  }

  /** "Reintentar" on a route whose upload failed: back to pending, and uploads it now. */
  async function retry(id: string): Promise<void> {
    if (busy.value) return;
    busy.value = id;
    try {
      await retryMyRoute(id);
    } catch (error) {
      console.warn('my routes: the upload could not be retried', error);
      ui.toast({ key: 'errors.generic' }, { tone: 'warning' });
    } finally {
      busy.value = null;
    }
  }

  return { busy, edit, remove, retry };
}
