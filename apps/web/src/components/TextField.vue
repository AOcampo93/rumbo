<script setup lang="ts">
import { CircleAlert } from '@lucide/vue';
import { computed, ref, useId } from 'vue';

// TextField (DESIGN §7 Inputs): a visible label, the input, then its error or
// hint (tied to the input with aria-describedby / aria-invalid) and an
// optional character counter. The counter counts what `maxlength` counts.
const model = defineModel<string>({ required: true });
const props = withDefaults(
  defineProps<{
    label: string;
    hint?: string;
    error?: string | null;
    placeholder?: string;
    maxlength?: number;
    counter?: boolean;
    required?: boolean;
    enterkeyhint?: 'enter' | 'done' | 'go' | 'next' | 'search' | 'send';
  }>(),
  {
    hint: undefined,
    error: null,
    placeholder: undefined,
    maxlength: undefined,
    counter: false,
    required: false,
    enterkeyhint: undefined,
  },
);
const emit = defineEmits<{ blur: [] }>();

const id = useId();
const input = ref<HTMLInputElement | null>(null);
const describedBy = computed(() => {
  if (props.error) return `${id}-error`;
  return props.hint ? `${id}-hint` : undefined;
});

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="field" :class="{ 'field--error': !!error }">
    <label :for="id" class="field__label">{{ label }}</label>
    <input
      :id="id"
      ref="input"
      v-model="model"
      class="field__input"
      type="text"
      autocomplete="off"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :enterkeyhint="enterkeyhint"
      :aria-required="required || undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      @blur="emit('blur')"
    />
    <div v-if="error || hint || (counter && maxlength)" class="field__meta">
      <p v-if="error" :id="`${id}-error`" class="field__error" role="alert">
        <CircleAlert :size="16" aria-hidden="true" />{{ error }}
      </p>
      <p v-else-if="hint" :id="`${id}-hint`" class="field__hint">{{ hint }}</p>
      <span v-if="counter && maxlength" class="field__counter tabular" aria-hidden="true"
        >{{ model.length }}/{{ maxlength }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.field__label {
  font: 600 15px/20px var(--font-ui);
}
.field__input {
  width: 100%;
  min-height: 52px;
  padding: 12px 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  /* 16 px or more: iOS never zooms into the field. */
  font: 400 16px/24px var(--font-ui);
  transition: border-color var(--motion-fast);
}
.field__input::placeholder {
  color: var(--color-text-muted);
  opacity: 1;
}
.field__input:focus {
  border-color: var(--color-primary);
}
.field--error .field__input {
  border-color: var(--color-danger);
}
.field__meta {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.field__hint,
.field__error {
  flex: 1;
  min-width: 0;
  font: 400 14px/20px var(--font-ui);
}
.field__hint {
  color: var(--color-text-muted);
}
.field__error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-danger);
  font-weight: 600;
}
.field__error svg {
  flex: none;
  margin-top: 2px;
}
.field__counter {
  flex: none;
  margin-left: auto;
  color: var(--color-text-muted);
  font: 500 13px/20px var(--font-ui);
}
</style>
