<script setup lang="ts">
import {
  Bell,
  CircleCheck,
  Download,
  FlaskConical,
  MapPin,
  Smartphone,
  Volume2,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';
import PermissionRow from '../components/PermissionRow.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import { useTexts } from '../i18n/text.ts';
import { track } from '../services/analytics.ts';
import { prefetchImages, routeImageUrls } from '../services/catalog.ts';
import {
  type NotificationStatus,
  notificationStatus,
  requestNotifications,
} from '../services/notifications.ts';
import { isIos, isStandalone, supports } from '../services/platform.ts';
import { playSound, unlockAudio } from '../services/sound.ts';
import { keepScreenOn } from '../services/wakeLock.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useRunStore } from '../stores/run.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S04 · Before starting: location (required), alerts (recommended), a sound
// check, keeping the screen on and the offline download. "Start" waits for
// location and the download; in simulation the real location isn't needed.
const props = defineProps<{ routeId: string }>();
const { t } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const run = useRunStore();
const settings = useSettingsStore();
const texts = useTexts();

const route = computed(() => catalog.byId(props.routeId));
const location = ref<'prompt' | 'granted' | 'denied' | 'asking'>('prompt');
const notifications = ref<NotificationStatus>('default');
const download = ref<'pending' | 'done' | 'failed'>('pending');
const starting = ref(false);
const canWakeLock = supports.wakeLock();
const showInstall = isIos() && !isStandalone();
let permissionStatus: PermissionStatus | null = null;

const locationReady = computed(() => settings.simulation || location.value === 'granted');
const ready = computed(() => locationReady.value && download.value === 'done');
const hint = computed(() => {
  if (!locationReady.value) return t('prepare.needLocation');
  if (download.value !== 'done') return t('prepare.downloading');
  return t('prepare.ready');
});

function askLocation(): void {
  location.value = 'asking';
  navigator.geolocation.getCurrentPosition(
    () => {
      location.value = 'granted';
      track('permission_result', { type: 'location', result: 'granted' });
    },
    (error) => {
      location.value = error.code === error.PERMISSION_DENIED ? 'denied' : 'prompt';
      track('permission_result', { type: 'location', result: location.value });
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
  );
}

async function askNotifications(): Promise<void> {
  notifications.value = await requestNotifications();
  track('permission_result', { type: 'notifications', result: notifications.value });
}

async function testSound(): Promise<void> {
  await unlockAudio();
  playSound('arrive');
  if (settings.vibration && supports.vibration()) navigator.vibrate([200, 100, 200]);
}

async function startRun(): Promise<void> {
  if (!route.value || !ready.value) return;
  starting.value = true;
  // These need the user's tap: audio unlocks and the wake lock is granted now.
  await unlockAudio();
  if (settings.keepAwake) await keepScreenOn();
  const ok = await run.start(route.value.id);
  starting.value = false;
  if (ok) void router.replace({ name: 'run' });
}

onMounted(async () => {
  await catalog.load();
  notifications.value = notificationStatus();
  try {
    permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
    location.value = permissionStatus.state;
    permissionStatus.onchange = () => {
      if (permissionStatus) location.value = permissionStatus.state;
    };
  } catch {
    // Permissions API missing (older Safari): the button asks directly.
  }
  const current = route.value;
  if (current) {
    const saved = await catalog.download(current.id);
    // The photos complete the cards offline, but the route runs without them.
    if (saved) await prefetchImages(routeImageUrls(current.bundle));
    download.value = saved ? 'done' : 'failed';
  }
});

onBeforeUnmount(() => {
  if (permissionStatus) permissionStatus.onchange = null;
});
</script>

<template>
  <main class="prepare">
    <EmptyState v-if="catalog.status === 'ready' && !route" :title="t('route.notFound')">
      <AppButton size="m" @click="router.replace('/')">{{ t('notFound.cta') }}</AppButton>
    </EmptyState>
    <template v-else-if="route">
      <PageHeader :title="texts.text(route.bundle.spec.name, route.bundle.spec.locale)" />
      <div class="prepare__body">
        <h1 class="t-h1">{{ t('prepare.title') }}</h1>
        <p class="t-body t-muted">{{ t('prepare.intro') }}</p>

        <PermissionRow
          :icon="settings.simulation ? FlaskConical : MapPin"
          :title="t('prepare.location.title')"
          :tag="t('prepare.required')"
          :body="settings.simulation ? t('prepare.location.simulated') : t('prepare.location.body')"
          :done="locationReady"
        >
          <template v-if="!settings.simulation">
            <p v-if="location === 'granted'" class="prepare__ok">
              <CircleCheck :size="18" aria-hidden="true" />{{ t('prepare.location.granted') }}
            </p>
            <p v-else-if="location === 'denied'" class="prepare__denied" role="alert">
              {{ t('prepare.location.denied') }}
            </p>
            <AppButton
              v-if="location !== 'granted'"
              block
              :loading="location === 'asking'"
              @click="askLocation"
            >
              {{ location === 'denied' ? t('common.retry') : t('prepare.location.allow') }}
            </AppButton>
          </template>
        </PermissionRow>

        <PermissionRow
          :icon="Bell"
          :title="t('prepare.notifications.title')"
          :tag="t('prepare.recommended')"
          :body="showInstall ? t('ios.install') : t('prepare.notifications.body')"
          :done="notifications === 'granted'"
        >
          <template #side>
            <AppButton
              v-if="notifications === 'default'"
              variant="secondary"
              size="m"
              @click="askNotifications"
            >
              {{ t('prepare.notifications.allow') }}
            </AppButton>
            <span v-else-if="notifications === 'granted'" class="prepare__ok"
              ><CircleCheck :size="18" aria-hidden="true" />{{
                t('prepare.notifications.granted')
              }}</span
            >
          </template>
          <p v-if="showInstall" class="t-small t-muted">{{ t('ios.steps') }}</p>
          <p v-else-if="notifications === 'denied'" class="t-small t-muted">
            {{ t('prepare.notifications.denied') }}
          </p>
          <p v-else-if="notifications === 'unsupported'" class="t-small t-muted">
            {{ t('prepare.notifications.unsupported') }}
          </p>
        </PermissionRow>

        <PermissionRow
          :icon="Volume2"
          :title="t('prepare.sound.title')"
          :body="t('prepare.sound.body')"
        >
          <template #side>
            <AppButton variant="secondary" size="m" @click="testSound">{{
              t('prepare.sound.test')
            }}</AppButton>
          </template>
        </PermissionRow>

        <PermissionRow
          :icon="Smartphone"
          :title="t('prepare.wakeLock.title')"
          :body="canWakeLock ? t('prepare.wakeLock.body') : t('prepare.wakeLock.unsupported')"
        >
          <template v-if="canWakeLock" #side>
            <ToggleSwitch v-model="settings.keepAwake" :label="t('prepare.wakeLock.title')" />
          </template>
        </PermissionRow>

        <PermissionRow
          :icon="Download"
          :title="t('prepare.download.title')"
          :body="
            download === 'failed'
              ? t('prepare.download.failed')
              : download === 'done'
                ? t('prepare.download.ready')
                : t('prepare.downloading')
          "
          :done="download === 'done'"
        />
      </div>

      <footer class="prepare__cta">
        <AppButton block :disabled="!ready" :loading="starting" @click="startRun">{{
          t('prepare.go')
        }}</AppButton>
        <p class="t-small t-muted" role="status">{{ hint }}</p>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.prepare {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 640px;
  margin: 0 auto;
}
.prepare__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 8px var(--gutter) 24px;
}
.prepare__body > .t-body {
  margin-bottom: 8px;
}
.prepare__ok {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-success);
  font: 600 15px var(--font-ui);
}
.prepare__denied {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font: 500 14px/20px var(--font-ui);
}
.prepare__cta {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
</style>
