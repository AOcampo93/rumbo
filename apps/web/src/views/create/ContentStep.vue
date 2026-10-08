<script setup lang="ts">
import {
  BellRing,
  Check,
  CircleAlert,
  CircleQuestionMark,
  Clock,
  ExternalLink,
  FileText,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Video,
  WifiOff,
} from '@lucide/vue';
import type { DraftPlace } from '@rumbo/route-builder';
import type { Component } from 'vue';
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../../components/AppButton.vue';
import OverflowMenu, { type OverflowMenuItem } from '../../components/OverflowMenu.vue';
import ProgressBar from '../../components/ProgressBar.vue';
import { AI_ERROR_MESSAGES, type AiErrorCode, BLOCKING_AI_ERRORS } from '../../services/ai.ts';
import { track } from '../../services/analytics.ts';
import { useOnline } from '../../services/network.ts';
import { useCreatorStore } from '../../stores/creator.ts';
import { useUiStore } from '../../stores/ui.ts';

// C3 · Fichas (DESIGN C3, phase 7): the AI prepares a card for every place
// while the user watches only the progress, two at a time, so the cards are
// ready (and offline-proof) by the time the route is saved. Nothing of a card
// is shown here: each row says whether it is ready and how many sources it
// has, because the card is what the user discovers on arrival. "Ver ficha"
// asks first ("te adelantará lo que descubrirás al llegar") and then shows it
// the way the arrival does. The step never blocks: whatever isn't ready when
// the route is saved uses the basic sheet. A place that picked something else
// to show on arrival (its own question, a video, a link, a notice, the plain
// sheet) needs no card: its row says what it shows instead of a card state.

type RowTone = 'ok' | 'warning' | 'danger' | 'muted' | 'busy' | 'choice';
interface Row {
  place: DraftPlace;
  index: number;
  tone: RowTone;
  icon: Component;
  spinning: boolean;
  text: string;
  /** A card the user can open. */
  viewable: boolean;
  /** Ready, with the menu (Regenerar · Usar ficha básica). */
  menu: boolean;
  retry: boolean;
  basic: boolean;
  generate: boolean;
}

const { t } = useI18n();
const router = useRouter();
const creator = useCreatorStore();
const ui = useUiStore();
const online = useOnline();
const uid = useId();

const liveText = ref('');
const rowNodes = new Map<string, HTMLElement>();

const draft = computed(() => creator.draft);
const stats = computed(() => creator.cardStats);
/** Cards being asked for, or about to be. */
const busy = computed(() => stats.value.pending + stats.value.generating > 0);
const finished = computed(() => stats.value.ready + stats.value.basic + stats.value.error);

/** Places that show something else than the card, for the note under the intro. */
const otherCount = computed(() => Object.values(stats.value.arrivals).reduce((a, b) => a + b, 0));
/** The places that use the AI card: the only ones with a card to prepare. */
const cardPlaces = computed(() =>
  (draft.value?.places ?? []).filter((place) => (place.arrival?.type ?? 'card') === 'card'),
);

/** "visitleiria.pt" of "https://visitleiria.pt/agenda". */
const hostOf = (url: string): string => /^https?:\/\/([^/?#]+)/i.exec(url.trim())?.[1] ?? url;

/** The row of a place that doesn't use the card: what it shows on arrival. */
function choiceRow(place: DraftPlace, index: number): Row | null {
  const { arrival } = place;
  if (!arrival || arrival.type === 'card') return null;
  const row = {
    place,
    index,
    tone: 'choice' as const,
    spinning: false,
    viewable: false,
    menu: false,
    retry: false,
    basic: false,
    generate: false,
  };
  switch (arrival.type) {
    case 'quiz':
      return {
        ...row,
        icon: CircleQuestionMark,
        text: t('create.arrival.row.quiz', { question: arrival.question.trim() }),
      };
    case 'video': {
      const title = arrival.title?.trim();
      return {
        ...row,
        icon: Video,
        text: title
          ? t('create.arrival.row.videoTitled', { title })
          : t('create.arrival.row.video'),
      };
    }
    case 'link':
      return {
        ...row,
        icon: ExternalLink,
        text: t('create.arrival.row.link', {
          label: arrival.label.trim(),
          host: hostOf(arrival.url),
        }),
      };
    case 'check':
      return { ...row, icon: BellRing, text: t('create.arrival.row.check') };
    default:
      return { ...row, icon: FileText, text: t('create.arrival.row.basic') };
  }
}

const rows = computed<Row[]>(() =>
  (draft.value?.places ?? []).map((place, index): Row => {
    const choice = choiceRow(place, index);
    if (choice) return choice;
    const card = creator.cardOf(place.tempId);
    const base = {
      place,
      index,
      viewable: false,
      menu: false,
      retry: false,
      basic: false,
      generate: false,
    };
    if (card.status === 'ready' && card.content && place.contentRef) {
      if (creator.isRefreshing(place.tempId)) {
        return {
          ...base,
          tone: 'busy',
          icon: LoaderCircle,
          spinning: true,
          text: t('create.content.refreshing'),
          viewable: true,
        };
      }
      const sources = card.content.sources.length;
      const thin = card.grounding === 'none' || sources === 0;
      return {
        ...base,
        tone: thin ? 'warning' : 'ok',
        icon: thin ? CircleAlert : Check,
        spinning: false,
        text: thin
          ? t('create.content.thin')
          : t('create.content.ready', {
              sources: t('create.content.sources', { n: sources }, sources),
            }),
        viewable: true,
        menu: true,
      };
    }
    if (card.status === 'generating') {
      return {
        ...base,
        tone: 'busy',
        icon: LoaderCircle,
        spinning: true,
        text: t('create.content.generating'),
      };
    }
    if (card.status === 'basic') {
      return {
        ...base,
        tone: 'muted',
        icon: FileText,
        spinning: false,
        text: t('create.content.basic'),
        generate: true,
      };
    }
    if (card.status === 'error') {
      const code: AiErrorCode = card.error ?? 'failed';
      return {
        ...base,
        tone: code === 'offline' ? 'warning' : 'danger',
        icon: code === 'offline' ? WifiOff : CircleAlert,
        spinning: false,
        text: errorText(code),
        retry: !BLOCKING_AI_ERRORS.has(code),
        basic: true,
      };
    }
    return {
      ...base,
      tone: 'muted',
      icon: Clock,
      spinning: false,
      text: t('create.content.waiting'),
    };
  }),
);

/** What a row says when its card failed: where the cause is the user's connection or the day's limit, it says so. */
function errorText(code: AiErrorCode): string {
  if (code === 'offline') return t('create.content.offline');
  if (code === 'failed') return t('create.content.failed');
  return t(AI_ERROR_MESSAGES[code]);
}

/** The first error that no retry fixes today: it gets a banner with a way out for all the places at once. */
const blockedCode = computed<AiErrorCode | null>(() => {
  for (const place of draft.value?.places ?? []) {
    const card = creator.cardOf(place.tempId);
    if (card.status === 'error' && card.error && BLOCKING_AI_ERRORS.has(card.error)) {
      return card.error;
    }
  }
  return null;
});
const blockedText = computed(() =>
  blockedCode.value === 'ai_unavailable'
    ? t('create.content.blocked.unavailable')
    : blockedCode.value === 'ai_budget_exceeded'
      ? t('create.content.blocked.budget')
      : t('create.content.blocked.deviceLimit'),
);

const progressText = computed(() =>
  busy.value
    ? t('create.content.progress', { n: finished.value, total: stats.value.total })
    : t('create.content.done', {
        n: stats.value.ready + stats.value.basic,
        total: stats.value.total,
      }),
);
const segments = computed(() =>
  cardPlaces.value.map((place) => {
    const status = creator.cardOf(place.tempId).status;
    if (status === 'ready' || status === 'basic') return 'completed' as const;
    return status === 'generating' ? ('next' as const) : ('locked' as const);
  }),
);
const percent = computed(() =>
  stats.value.total === 0 ? 0 : ((stats.value.ready + stats.value.basic) / stats.value.total) * 100,
);
/** The user goes on with cards still on their way: say what happens to them. */
const leavingUnfinished = computed(() => stats.value.ready + stats.value.basic < stats.value.total);

const menuItems = computed<OverflowMenuItem[]>(() => [
  { id: 'regenerate', label: t('create.content.regenerate'), icon: RefreshCw },
  { id: 'basic', label: t('create.content.useBasic'), icon: FileText },
]);

function say(text: string): void {
  liveText.value = '';
  void nextTick(() => {
    liveText.value = text;
  });
}

function setRow(tempId: string, node: unknown): void {
  if (node instanceof HTMLElement) rowNodes.set(tempId, node);
  else rowNodes.delete(tempId);
}

/** A row's button went away with its state: focus stays on the row. */
async function focusRow(tempId: string): Promise<void> {
  await nextTick();
  rowNodes.get(tempId)?.focus({ preventScroll: true });
}

async function view(place: DraftPlace): Promise<void> {
  const current = draft.value;
  const card = creator.cardOf(place.tempId);
  if (!current || card.status !== 'ready' || !card.content || !place.contentRef) return;
  const confirmed = await ui.confirm({
    title: { key: 'create.content.spoilerTitle' },
    body: { key: 'create.content.spoilerBody' },
    confirmLabel: { key: 'create.content.spoilerConfirm' },
    cancelLabel: { key: 'create.content.spoilerCancel' },
  });
  if (!confirmed) return;
  // The card the arrival shows, with the sheet's preview footer instead of "Continuar ruta".
  void ui.present(
    'ai_template',
    {
      name: place.name,
      content: { [current.locale]: { ...card.content, id: place.contentRef } },
      preview: true,
    },
    { sourceLocale: current.locale },
  );
}

function onMenu(place: DraftPlace, id: string): void {
  if (id === 'regenerate') void regenerate(place);
  else if (id === 'basic') void useBasic(place);
}

async function regenerate(place: DraftPlace): Promise<void> {
  await creator.regenerateCard(place.tempId);
  void focusRow(place.tempId);
}

async function useBasic(place: DraftPlace): Promise<void> {
  await creator.setBasicCard(place.tempId);
  say(t('create.content.basicSet', { name: place.name }));
  void focusRow(place.tempId);
}

async function useBasicForAll(): Promise<void> {
  const changed = await creator.setBasicForFailed();
  say(t('create.content.basicAllSet', { n: changed }, changed));
}

async function next(): Promise<void> {
  track('creator_step_completed', { step: 'content' });
  await router.push({ name: 'create-review' });
}

// When the last card is in, say how it went (the rows change silently).
watch(busy, (now, before) => {
  if (before && !now) {
    const { ready, total } = stats.value;
    say(t('create.content.doneAnnounce', { n: ready, total }));
  }
});

// The connection came back: the cards that were waiting for it start.
watch(online, (isOnline) => {
  if (isOnline) void creator.generateMissing();
});

onMounted(() => {
  void creator.generateMissing();
});
</script>

<template>
  <section v-if="draft" class="content">
    <div class="content__body">
      <h1 class="t-h1">{{ t('create.steps.content') }}</h1>
      <p class="content__intro">{{ t('create.content.intro') }}</p>

      <p v-if="stats.total > 0 && otherCount > 0" class="content__intro">
        {{ t('create.arrival.contentNote') }}
      </p>

      <p v-if="stats.total === 0" class="content__intro">{{ t('create.arrival.noCards') }}</p>
      <div v-else class="content__status">
        <p class="content__progress tabular">{{ progressText }}</p>
        <ProgressBar :segments="segments" :percent="percent" :label="progressText" />
        <p class="content__ai">
          <Sparkles :size="16" aria-hidden="true" />
          <span>{{ t('create.content.aiNote') }}</span>
        </p>
      </div>

      <div v-if="blockedCode" class="content__blocked" role="status">
        <CircleAlert :size="22" aria-hidden="true" />
        <div class="content__blockedtext">
          <p>{{ blockedText }}</p>
          <AppButton variant="secondary" size="m" @click="useBasicForAll">
            {{ t('create.content.useBasicAll') }}
          </AppButton>
        </div>
      </div>

      <ol class="rows" :aria-label="t('create.content.list')">
        <li
          v-for="row in rows"
          :key="row.place.tempId"
          :ref="(node) => setRow(row.place.tempId, node)"
          class="row"
          tabindex="-1"
        >
          <span class="row__badge tabular" aria-hidden="true">{{ row.index + 1 }}</span>
          <div class="row__main">
            <p class="row__name">{{ row.place.name }}</p>
            <p class="row__status" :class="`is-${row.tone}`">
              <component
                :is="row.icon"
                :size="16"
                :class="{ row__spin: row.spinning }"
                aria-hidden="true"
              />
              <span>{{ row.text }}</span>
            </p>
          </div>
          <div v-if="row.viewable || row.retry || row.basic || row.generate" class="row__actions">
            <AppButton
              v-if="row.viewable"
              variant="secondary"
              size="m"
              :aria-label="t('create.content.viewNamed', { name: row.place.name })"
              @click="view(row.place)"
            >
              {{ t('create.content.view') }}
            </AppButton>
            <AppButton
              v-if="row.retry"
              size="m"
              :aria-label="t('create.content.retryNamed', { name: row.place.name })"
              @click="regenerate(row.place)"
            >
              {{ t('common.retry') }}
            </AppButton>
            <AppButton
              v-if="row.basic"
              variant="secondary"
              size="m"
              :aria-label="t('create.content.useBasicNamed', { name: row.place.name })"
              @click="useBasic(row.place)"
            >
              {{ t('create.content.useBasic') }}
            </AppButton>
            <AppButton
              v-if="row.generate"
              variant="secondary"
              size="m"
              :aria-label="t('create.content.generateNamed', { name: row.place.name })"
              @click="regenerate(row.place)"
            >
              <template #icon><Sparkles :size="18" aria-hidden="true" /></template>
              {{ t('create.content.generate') }}
            </AppButton>
            <OverflowMenu
              v-if="row.menu"
              :items="menuItems"
              :label="t('create.content.menu', { name: row.place.name })"
              @select="(id) => onMenu(row.place, id)"
            />
          </div>
        </li>
      </ol>
    </div>

    <footer class="content__footer">
      <div class="content__footerin">
        <p v-if="leavingUnfinished" :id="`${uid}-hint`" class="content__hint">
          {{ t('create.content.nextHint') }}
        </p>
        <AppButton
          block
          :aria-describedby="leavingUnfinished ? `${uid}-hint` : undefined"
          @click="next"
        >
          {{ t('create.next') }}
        </AppButton>
      </div>
    </footer>

    <p class="visually-hidden" aria-live="polite">{{ liveText }}</p>
  </section>
</template>

<style scoped>
.content {
  display: flex;
  flex: 1;
  flex-direction: column;
}
.content__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 20px var(--gutter) 28px;
}
.content__intro {
  color: var(--color-text-muted);
  font: 400 15px/22px var(--font-ui);
}
.content__status {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.content__progress {
  font: 600 16px/22px var(--font-ui);
}
.content__ai {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-muted);
  font: 500 13px/18px var(--font-ui);
}
.content__ai svg {
  flex: none;
  margin-top: 1px;
  color: var(--color-accent);
}
.content__blocked {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.content__blocked > svg {
  flex: none;
  margin-top: 1px;
}
.content__blockedtext {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  font: 600 15px/22px var(--font-ui);
}
.content__blockedtext :deep(.btn) {
  color: var(--color-text);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px 12px;
  padding: 14px 12px 14px 14px;
}
.row + .row {
  border-top: 1px solid var(--color-border);
}
.row__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2.15em;
  height: 2.15em;
  margin-top: 1px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: 700 13px/1 var(--font-ui);
}
.row__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.row__name {
  font: 600 17px/22px var(--font-ui);
  overflow-wrap: anywhere;
}
.row__status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-text-muted);
  font: 500 14px/20px var(--font-ui);
}
.row__status svg {
  flex: none;
  margin-top: 2px;
}
.row__status.is-ok {
  color: var(--color-success);
}
.row__status.is-warning {
  color: var(--color-warning);
}
.row__status.is-danger {
  color: var(--color-danger);
}
.row__status.is-busy {
  color: var(--color-primary);
}
.row__status.is-choice {
  color: var(--color-text);
}
.row__status.is-choice svg {
  color: var(--color-primary);
}
.row__spin {
  animation: spin 0.8s linear infinite;
}
.row__actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 2;
  align-items: center;
  gap: 8px;
  margin-right: -4px;
}
.content__footer {
  position: sticky;
  bottom: 0;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.content__footerin {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 640px;
  margin: 0 auto;
}
.content__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
  text-align: center;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
