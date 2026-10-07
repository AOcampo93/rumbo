<script setup lang="ts">
// EmptyState (DESIGN §7): brand pattern, title, text and a call to action.
defineProps<{ title: string; body?: string }>();
</script>

<template>
  <section class="empty">
    <div class="empty__art azulejo" aria-hidden="true" />
    <h2 class="t-h2">{{ title }}</h2>
    <p v-if="body" class="t-body t-muted">{{ body }}</p>
    <slot />
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
}
.empty__art {
  width: 120px;
  height: 120px;
  margin-bottom: 8px;
  border-radius: 28px;
}
.empty p {
  max-width: 34ch;
}
</style>
