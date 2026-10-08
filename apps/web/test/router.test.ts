import 'fake-indexeddb/auto';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import { createAppRouter } from '../src/router/index.ts';
import { routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';

// The creator's routes (design §4.5): /create resumes the draft at its first
// unfinished step, and each step needs what the previous ones collect.

const castle = { name: 'Castelo de Leiria', position: { lat: 39.7473, lng: -8.8077 } };
const cathedral = { name: 'Sé de Leiria', position: { lat: 39.7436, lng: -8.8072 } };

let pinia: Pinia;
let router: Router;

async function go(to: string | { name: string }): Promise<string | undefined> {
  await router.push(to);
  const name = router.currentRoute.value.name;
  return typeof name === 'string' ? name : undefined;
}

beforeEach(async () => {
  localStorage.setItem('rumbo.settings', JSON.stringify({ locale: 'es', onboarded: true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await Promise.all([db.del(KEYS.creatorDraft), db.del(KEYS.myRoutes)]);
  pinia = createPinia();
  setActivePinia(pinia);
  router = createAppRouter(pinia);
});

afterEach(async () => {
  useCreatorStore(pinia).$dispose();
  await routeSyncIdle();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the creator routes', () => {
  it('open a new draft on its first step, without the bottom navigation', async () => {
    expect(await go('/create')).toBe('create-details');
    expect(router.currentRoute.value.meta.nav).toBeUndefined();
    expect(useCreatorStore(pinia).draft).not.toBeNull();
  });

  it('send each step back to the first one with something missing', async () => {
    const creator = useCreatorStore(pinia);
    expect(await go({ name: 'create-places' })).toBe('create-details');
    expect(await go({ name: 'create-content' })).toBe('create-details');
    await creator.update({ name: 'Leiria numa manhã' });
    expect(await go({ name: 'create-places' })).toBe('create-places');
    expect(await go({ name: 'create-content' })).toBe('create-places');
    expect(await go({ name: 'create-review' })).toBe('create-places');
    await creator.addPlace(castle);
    await creator.addPlace(cathedral);
    expect(await go({ name: 'create-review' })).toBe('create-review');
    expect(await go('/create/content')).toBe('create-content');
    expect(await go({ name: 'create-done' })).toBe('create-review');
  });

  it('resume a stored draft where it was left', async () => {
    const creator = useCreatorStore(pinia);
    await creator.ensureDraft();
    await creator.update({ name: 'Leiria numa manhã' });
    await creator.addPlace(castle);
    expect(await go('/create')).toBe('create-places');
  });

  it('resume at the cards while any place still needs one, then at the review', async () => {
    const creator = useCreatorStore(pinia);
    await creator.ensureDraft();
    await creator.update({ name: 'Leiria numa manhã' });
    await creator.addPlace({ ...castle, tempId: 'castle' });
    await creator.addPlace({ ...cathedral, tempId: 'cathedral' });
    expect(await go('/create')).toBe('create-content');
    await creator.setBasicCard('castle');
    expect(await go('/create')).toBe('create-content');
    await creator.setBasicCard('cathedral');
    expect(await go('/create')).toBe('create-review');
  });

  it('after saving: "done" opens, Back into the steps goes to My routes, "Create" starts anew', async () => {
    const creator = useCreatorStore(pinia);
    await creator.ensureDraft();
    await creator.update({ name: 'Leiria numa manhã' });
    await creator.addPlace(castle);
    await creator.addPlace(cathedral);
    expect(await go({ name: 'create-review' })).toBe('create-review');
    const id = await creator.save();
    expect(await go({ name: 'create-done' })).toBe('create-done');
    expect(await go({ name: 'create-places' })).toBe('my-routes');
    expect(creator.savedId).toBe(id);
    expect(await go('/create')).toBe('create-details');
    expect(creator.savedId).toBeNull();
    expect(creator.draft).toMatchObject({ name: '', places: [] });
  });
});
