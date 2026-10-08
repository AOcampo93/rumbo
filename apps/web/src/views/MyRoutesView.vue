<script setup lang="ts">
import { CloudOff, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from '@lucide/vue';
import { LOCALES, type Locale, type LocalizedText } from '@rumbo/route-spec';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import OverflowMenu, { type OverflowMenuItem } from '../components/OverflowMenu.vue';
import RouteCard from '../components/RouteCard.vue';
import { useTexts } from '../i18n/text.ts';
import type { CatalogRoute } from '../services/catalog.ts';
import { deleteMyRoute, type MyRouteRecord, retryMyRoute } from '../services/myRoutes.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useCreatorStore } from '../stores/creator.ts';
import { useRunStore } from '../stores/run.ts';
import { useUiStore } from '../stores/ui.ts';

// S02 · My routes: the routes made with the creator on this device, newest
// first. Each one is its RouteCard plus, outside the card's link, a ⋯ menu
// (Edit, Delete) and a line for its upload state. A record whose route no
// longer validates can only be deleted.
const { t } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const creator = useCreatorStore();
const run = useRunStore();
const ui = useUiStore();
const texts = useTexts();

/** Server answers that editing the route can fix; anything else is worth retrying. */
const EDIT_CODES = new Set(['invalid_route', 'validation_failed', 'payload_too_large']);

type Status =
  { tone: 'pending'; text: string } | { tone: 'error'; text: string; action: 'retry' | 'edit' };

interface Row {
  record: MyRouteRecord;
  /** The runnable route; null when the record no longer validates. */
  route: CatalogRoute | null;
  /** The name in the active language ('' when unknown). */
  name: string;
  /** The name as stored, for dialogs (they resolve it in the active language). */
  nameText: LocalizedText | null;
  sourceLocale: Locale;
  status: Status | null;
}

const heading = ref<HTMLElement | null>(null);
/** The route an action is running for: one at a time, so a double tap does nothing. */
const busy = ref<string | null>(null);

/** Best effort: the name of a record whose spec doesn't validate any more. */
function storedName(record: MyRouteRecord): { text: LocalizedText; locale: Locale } | null {
  const spec = record.bundle.spec as { name?: unknown; locale?: unknown };
  const source = LOCALES.includes(spec.locale as Locale) ? (spec.locale as Locale) : 'es';
  if (typeof spec.name === 'string' && spec.name.trim()) return { text: spec.name, locale: source };
  if (!spec.name || typeof spec.name !== 'object') return null;
  const names = spec.name as Record<string, unknown>;
  const text: Partial<Record<Locale, string>> = {};
  for (const lang of LOCALES) {
    const value = names[lang];
    if (typeof value === 'string' && value.trim()) text[lang] = value.trim().slice(0, 80);
  }
  return Object.keys(text).length > 0 ? { text: text as LocalizedText, locale: source } : null;
}

function statusOf(record: MyRouteRecord): Status | null {
  if (record.sync === 'pending') return { tone: 'pending', text: t('myRoutes.sync.pending') };
  if (record.sync !== 'error') return null;
  if (EDIT_CODES.has(record.error ?? ''))
    return { tone: 'error', text: t('myRoutes.sync.invalid'), action: 'edit' };
  if (record.error === 'quota_exceeded')
    return { tone: 'error', text: t('myRoutes.sync.quota'), action: 'retry' };
  return { tone: 'error', text: t('myRoutes.sync.error'), action: 'retry' };
}

const rows = computed<Row[]>(() => {
  const runnable = new Map(catalog.mine.map((route) => [route.id, route]));
  return catalog.myRecords.map((record) => {
    const route = runnable.get(record.id) ?? null;
    const spec = route?.bundle.spec;
    const stored = spec ? { text: spec.name, locale: spec.locale } : storedName(record);
    return {
      record,
      route,
      name: stored ? texts.text(stored.text, stored.locale) : '',
      nameText: stored?.text ?? null,
      sourceLocale: stored?.locale ?? 'es',
      status: route ? statusOf(record) : null,
    };
  });
});

const loading = computed(() => catalog.mineStatus !== 'ready');

const menuItems = computed<OverflowMenuItem[]>(() => [
  { id: 'edit', label: t('myRoutes.edit'), icon: Pencil },
  { id: 'delete', label: t('myRoutes.delete'), icon: Trash2, danger: true },
]);

const isActiveRun = (id: string) => run.active && !run.trial && run.routeId === id;

/** Several catalog texts as one dialog body, in every language (the dialog shows the active one). */
function paragraphs(keys: readonly string[]): LocalizedText {
  const text: Partial<Record<Locale, string>> = {};
  for (const lang of LOCALES)
    text[lang] = keys.map((key) => t(key, {}, { locale: lang })).join('\n\n');
  return text as LocalizedText;
}

async function edit(row: Row): Promise<void> {
  if (busy.value) return;
  busy.value = row.record.id;
  try {
    await creator.ready;
    // Another route's draft (or a new one) would be replaced: ask first.
    if (creator.hasContent && creator.draft?.editingId !== row.record.id) {
      const replace = await ui.confirm({
        title: { key: 'create.draft.replaceTitle' },
        body: { key: 'create.draft.replaceBody' },
        confirmLabel: { key: 'create.draft.replace' },
        cancelLabel: { key: 'common.cancel' },
        destructive: true,
      });
      if (!replace) return;
    }
    // Unknown or unreadable: loadForEdit says so with a toast.
    if (!(await creator.loadForEdit(row.record.id))) return;
    if (isActiveRun(row.record.id))
      ui.toast({ key: 'myRoutes.activeRunEdit' }, { tone: 'warning' });
    await router.push({ name: 'create-details' });
  } finally {
    busy.value = null;
  }
}

async function remove(row: Row): Promise<void> {
  if (busy.value) return;
  const { id } = row.record;
  const confirmed = await ui.confirm({
    title: row.nameText
      ? { key: 'myRoutes.deleteTitle', params: { name: row.nameText } }
      : { key: 'myRoutes.deleteThisTitle' },
    body: isActiveRun(id)
      ? paragraphs(['myRoutes.activeRunDelete', 'myRoutes.deleteBody'])
      : { key: 'myRoutes.deleteBody' },
    confirmLabel: { key: 'myRoutes.delete' },
    cancelLabel: { key: 'common.cancel' },
    destructive: true,
    sourceLocale: row.sourceLocale,
  });
  if (!confirmed || busy.value) return;
  busy.value = id;
  try {
    // A route's run can't outlive it: it ends here, without a summary.
    if (isActiveRun(id)) run.reset();
    await deleteMyRoute(id);
    await creator.discardIfEditing(id);
    ui.toast({ key: 'myRoutes.deleted' }, { tone: 'success' });
    // Its row (and the menu that had focus) is gone: focus goes back to the title.
    await nextTick();
    heading.value?.focus();
  } catch (error) {
    console.warn('my routes: the route could not be deleted', error);
    ui.toast({ key: 'errors.generic' }, { tone: 'warning' });
  } finally {
    busy.value = null;
  }
}

async function retry(row: Row): Promise<void> {
  if (busy.value) return;
  busy.value = row.record.id;
  try {
    await retryMyRoute(row.record.id);
  } catch (error) {
    console.warn('my routes: the upload could not be retried', error);
    ui.toast({ key: 'errors.generic' }, { tone: 'warning' });
  } finally {
    busy.value = null;
  }
}

function onMenu(row: Row, action: string): void {
  if (action === 'edit') void edit(row);
  else if (action === 'delete') void remove(row);
}

onMounted(() => void catalog.loadMine());
</script>

<template>
  <main class="mine">
    <header class="mine__head">
      <h1 ref="heading" class="t-h1" tabindex="-1">{{ t('myRoutes.title') }}</h1>
      <AppButton
        v-if="!loading && rows.length > 0"
        size="m"
        @click="router.push({ name: 'create' })"
      >
        <template #icon><Plus :size="20" aria-hidden="true" /></template>
        {{ t('myRoutes.new') }}
      </AppButton>
    </header>

    <section class="mine__body" :aria-busy="loading">
      <template v-if="loading">
        <div class="mine__list" aria-hidden="true">
          <div v-for="n in 2" :key="n" class="skeleton">
            <div class="skeleton__cover" />
            <div class="skeleton__line" />
            <div class="skeleton__line skeleton__line--short" />
          </div>
        </div>
        <p class="visually-hidden">{{ t('common.loading') }}</p>
      </template>

      <EmptyState v-else-if="catalog.mineUnreadable" :title="t('myRoutes.loadError')">
        <AppButton size="m" variant="secondary" @click="catalog.loadMine()">
          <template #icon><RotateCcw :size="20" aria-hidden="true" /></template>
          {{ t('common.retry') }}
        </AppButton>
      </EmptyState>

      <EmptyState
        v-else-if="rows.length === 0"
        :title="t('myRoutes.empty.title')"
        :body="t('myRoutes.empty.body')"
      >
        <AppButton size="m" @click="router.push({ name: 'create' })">
          <template #icon><Plus :size="20" aria-hidden="true" /></template>
          {{ t('myRoutes.empty.cta') }}
        </AppButton>
      </EmptyState>

      <ul v-else class="mine__list" :aria-label="t('myRoutes.title')">
        <li v-for="row in rows" :key="row.record.id" class="item">
          <template v-if="row.route">
            <RouteCard :route="row.route" menu-space />
            <OverflowMenu
              class="item__menu"
              :items="menuItems"
              :label="t('myRoutes.menu', { name: row.name })"
              @select="onMenu(row, $event)"
            />
          </template>

          <div v-else class="item__broken">
            <TriangleAlert :size="22" aria-hidden="true" class="item__brokenicon" />
            <div class="item__brokentext">
              <p v-if="row.name" class="t-title">{{ row.name }}</p>
              <p class="t-small t-muted">{{ t('myRoutes.unreadable') }}</p>
            </div>
            <AppButton
              variant="danger"
              size="m"
              :disabled="busy !== null"
              class="item__brokendelete"
              @click="remove(row)"
            >
              <template #icon><Trash2 :size="20" aria-hidden="true" /></template>
              {{ t('myRoutes.delete') }}
            </AppButton>
          </div>

          <div v-if="row.status" class="item__status" :class="`item__status--${row.status.tone}`">
            <p class="item__statustext">
              <component
                :is="row.status.tone === 'pending' ? CloudOff : TriangleAlert"
                :size="18"
                aria-hidden="true"
                class="item__statusicon"
              />
              <span>{{ row.status.text }}</span>
            </p>
            <AppButton
              v-if="row.status.tone === 'error'"
              variant="secondary"
              size="m"
              :disabled="busy !== null"
              :aria-label="
                row.status.action === 'edit'
                  ? `${t('myRoutes.edit')}: ${row.name}`
                  : `${t('common.retry')}: ${row.name}`
              "
              class="item__statusaction"
              @click="row.status.action === 'edit' ? edit(row) : retry(row)"
            >
              <template #icon>
                <component
                  :is="row.status.action === 'edit' ? Pencil : RotateCcw"
                  :size="18"
                  aria-hidden="true"
                />
              </template>
              {{ row.status.action === 'edit' ? t('myRoutes.edit') : t('common.retry') }}
            </AppButton>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.mine {
  max-width: 640px;
  margin: 0 auto;
  padding: calc(24px + var(--safe-top)) var(--gutter) 32px;
}
.mine__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 20px;
}
.mine__head h1 {
  min-width: 0;
  overflow-wrap: anywhere;
}
.mine__list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Tablet and desktop (DESIGN §13): two columns of cards. */
@media (min-width: 720px) {
  .mine {
    max-width: 1040px;
    padding-inline: 24px;
  }
  .mine__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 32px 24px;
  }
}
.item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* The ⋯ button sits on the cover's top-right corner, outside the card's link. */
.item :deep(.item__menu) {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.item :deep(.item__menu:hover),
.item :deep(.item__menu.is-open) {
  background: var(--color-surface-2);
}
/* A white halo keeps the focus ring visible on the cover's pattern or photo. */
.item :deep(.item__menu:focus-visible) {
  box-shadow: 0 0 0 7px #fff;
}
.item__broken {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-e1);
}
.item__brokenicon {
  flex: none;
  align-self: flex-start;
  margin-top: 1px;
  color: var(--color-warning);
}
.item__brokentext {
  flex: 1 1 160px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.item__brokendelete {
  margin-left: auto;
}
/* The button shares the message's row when it fits, and goes under it otherwise. */
.item__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: var(--color-text-muted);
  font: 500 14px/20px var(--font-ui);
}
.item__statustext {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.item__statusicon {
  flex: none;
  margin-top: 1px;
}
.item__status--error {
  padding: 10px 12px 10px 14px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font-weight: 600;
}
.item__statusaction {
  margin-left: auto;
}
.skeleton {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.skeleton__cover {
  aspect-ratio: 16 / 9;
  background: var(--color-surface-2);
}
.skeleton__line {
  height: 14px;
  margin: 14px 16px;
  width: 70%;
  border-radius: 6px;
  background: var(--color-surface-2);
}
.skeleton__line--short {
  width: 40%;
}
</style>
