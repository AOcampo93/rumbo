<script setup lang="ts">
import { CircleCheck, Clock, Globe, MapPin, Route, UserRound, Users } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import { type CatalogRoute, isCommunityRoute } from '../services/catalog.ts';
import ActivityBadge from './ActivityBadge.vue';
import ModeBadge from './ModeBadge.vue';
import RouteCover, { coverInterest } from './RouteCover.vue';
import StatChip from './StatChip.vue';

// RouteCard (DESIGN §7): 16:9 cover (the route's photo, else the illustration
// of its first interest, else the brand pattern: RouteCover), mode badge,
// "Created by you" on the user's own routes, "From the community" on the ones
// other people published, Fraunces title, activity, summary and the stats
// row. `published` adds "Published" to the user's own route that is public
// (My routes). `menuSpace` keeps the cover's top-right corner free for a menu
// button laid over the card (My routes): it can't go inside the link.
const props = defineProps<{
  route: CatalogRoute;
  downloaded?: boolean;
  published?: boolean;
  menuSpace?: boolean;
}>();
const { t } = useI18n();
const texts = useTexts();
const format = useFormat();

const spec = computed(() => props.route.bundle.spec);
const name = computed(() => texts.text(spec.value.name, spec.value.locale));
const summary = computed(() => texts.text(spec.value.summary, spec.value.locale));
const cover = computed(() => spec.value.coverImage);
const interest = computed(() => coverInterest(spec.value.meta?.['interests']));
const community = computed(() => isCommunityRoute(props.route));
</script>

<template>
  <RouterLink :to="{ name: 'route', params: { routeId: route.id } }" class="card">
    <RouteCover class="card__cover" :cover="cover" :interest="interest" :locale="spec.locale">
      <div class="card__badges" :class="{ 'card__badges--menu': menuSpace }">
        <ModeBadge :mode="spec.mode" />
        <span v-if="route.mine" class="card__badge card__badge--mine">
          <UserRound :size="15" aria-hidden="true" />{{ t('route.createdByYou') }}
        </span>
        <span v-if="community" class="card__badge card__badge--shared">
          <Users :size="15" aria-hidden="true" />{{ t('route.community') }}
        </span>
        <span v-if="published" class="card__badge card__badge--shared">
          <Globe :size="15" aria-hidden="true" />{{ t('route.published') }}
        </span>
        <span v-if="downloaded" class="card__badge card__badge--offline">
          <CircleCheck :size="15" aria-hidden="true" />{{ t('route.downloaded') }}
        </span>
      </div>
    </RouteCover>
    <div class="card__body">
      <div class="card__titlerow">
        <h2 class="t-card-title card__title">{{ name }}</h2>
        <ActivityBadge :activity="spec.activity" plain />
      </div>
      <p v-if="summary" class="t-small t-muted">{{ summary }}</p>
      <div class="card__stats">
        <StatChip
          :icon="Route"
          :value="format.distance(route.summary.distanceMeters)"
          :label="t('summary.distance')"
        />
        <StatChip
          :icon="Clock"
          :value="format.approx(route.summary.estimatedMinutes)"
          :label="t('summary.time')"
        />
        <StatChip :icon="MapPin" :value="format.points(route.summary.pointCount)" />
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: block;
  overflow: hidden;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e1);
  text-decoration: none;
}
/* Badges wrap instead of overlapping when the text is long or large. */
.card__badges {
  position: absolute;
  inset: 12px 12px auto;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px;
}
/* On the cover (a photo or the brand pattern): the same colours in every theme. */
.card__badges--menu {
  right: 64px;
}
.card__badge {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-xs);
  background: #fff;
  font: 700 13px/16px var(--font-ui);
}
.card__badge--mine {
  color: #1e4fa3;
}
.card__badge--shared {
  color: #0b6b66;
}
.card__badge--offline {
  margin-left: auto;
  color: #1a7f45;
}
.card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
}
.card__titlerow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card__title {
  flex: 1;
  min-width: 0;
}
.card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 4px;
}
</style>
