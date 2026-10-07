<script setup lang="ts">
import { onMounted, ref } from 'vue';

// Temporary landing until phase 4. It proves the production path end to end:
// browser → web (nginx) → /api (Fastify) → PostgreSQL.
interface Health {
  status: string;
  version: string;
  commit: string | null;
  db: 'ok' | 'error' | 'disabled';
}

const health = ref<Health | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const res = await fetch('/api/v1/health', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    health.value = (await res.json()) as Health;
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <main class="landing">
    <h1 class="wordmark" aria-label="rumbo">
      rumb<span class="compass" aria-hidden="true"><span class="needle" /></span>
    </h1>
    <ul class="taglines">
      <li lang="es">La ruta cobra vida al llegar.</li>
      <li lang="en">The route comes alive when you arrive.</li>
      <li lang="pt-PT">A rota ganha vida quando chegas.</li>
    </ul>
    <p class="status" :class="{ ok: health?.db === 'ok', bad: failed || health?.db === 'error' }" role="status">
      <template v-if="failed">API ✗</template>
      <template v-else-if="health">
        API {{ health.version }} · DB {{ health.db
        }}<template v-if="health.commit"> · {{ health.commit.slice(0, 7) }}</template>
      </template>
      <template v-else>API …</template>
    </p>
  </main>
</template>

<style scoped>
.landing {
  min-height: 100dvh;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  text-align: center;
}

/* Wordmark from the mockup: the final "o" is a compass with a Terracota needle. */
.wordmark {
  margin: 0;
  display: flex;
  align-items: flex-end;
  font: 600 clamp(48px, 16vw, 72px) / 1 var(--font-display);
  letter-spacing: -0.03em;
}

.compass {
  position: relative;
  display: inline-block;
  width: 0.58em;
  height: 0.58em;
  margin: 0 0 0.11em 0.03em;
  border: 0.11em solid var(--color-text);
  border-radius: 50%;
}

.needle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0.083em;
  height: 0.36em;
  margin: -0.18em 0 0 -0.042em;
  background: var(--color-accent);
  border-radius: 0.04em;
  transform: rotate(40deg);
}

.taglines {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-muted);
  font-size: 17px;
}

.taglines li:first-child {
  color: var(--color-text);
  font-weight: 600;
}

.status {
  margin: 8px 0 0;
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font: 600 13px/20px var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.status.ok {
  color: var(--color-success);
}

.status.bad {
  color: var(--color-danger);
}
</style>
