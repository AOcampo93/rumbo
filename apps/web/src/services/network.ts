import { onScopeDispose, ref } from 'vue';

/** Whether the browser thinks it's online, kept up to date. */
export function useOnline() {
  const online = ref(globalThis.navigator?.onLine ?? true);
  const update = () => {
    online.value = navigator.onLine;
  };
  globalThis.addEventListener?.('online', update);
  globalThis.addEventListener?.('offline', update);
  onScopeDispose(() => {
    globalThis.removeEventListener?.('online', update);
    globalThis.removeEventListener?.('offline', update);
  });
  return online;
}
