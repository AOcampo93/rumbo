import { buildRouteSpec } from '@rumbo/route-builder';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import RouteCard from '../src/components/RouteCard.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { type CatalogRoute, toCatalogRoute } from '../src/services/catalog.ts';

// RouteCard: the user's own routes say "Creada por ti", the ones the community
// published "De la comunidad", and an own route that is public "Publicada" (DESIGN §7).

function userRoute(mine?: CatalogRoute['mine']): CatalogRoute {
  const built = buildRouteSpec(
    {
      name: 'Mi Leiria',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', idFactory: () => 'card000001' },
  );
  const route = toCatalogRoute({ spec: built.normalized, contents: {} }, 0);
  return mine ? { ...route, mine } : route;
}

function mountCard(props: Record<string, unknown>) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(RouteCard, {
    props: props as { route: CatalogRoute },
    global: { plugins: [pinia, i18n], stubs: { RouterLink: RouterLinkStub } },
  });
}

beforeEach(() => applyLocale('es'));

describe('RouteCard', () => {
  it('says "Creada por ti" on the user\'s own routes', () => {
    const card = mountCard({ route: userRoute({ sync: 'pending' }) });
    expect(card.get('.card__badge--mine').text()).toBe('Creada por ti');
    expect(card.text()).toContain('Mi Leiria');
    expect(card.getComponent(RouterLinkStub).props('to')).toEqual({
      name: 'route',
      params: { routeId: card.props('route').id },
    });
  });

  it('has no such badge on other routes', () => {
    const card = mountCard({ route: userRoute(), downloaded: true });
    expect(card.find('.card__badge--mine').exists()).toBe(false);
    expect(card.get('.card__badge--offline').text()).toBe('Descargada');
  });

  it('follows the language and can leave room for a menu on the cover', async () => {
    const card = mountCard({ route: userRoute({ sync: 'synced' }), menuSpace: true });
    expect(card.get('.card__badges').classes()).toContain('card__badges--menu');
    applyLocale('en');
    await card.vm.$nextTick();
    expect(card.get('.card__badge--mine').text()).toBe('Created by you');
  });
});

describe('RouteCard, with the community (phase 7.2)', () => {
  it('says "De la comunidad" on a user route that is not the user\'s own', () => {
    const card = mountCard({ route: userRoute() });
    expect(card.get('.card__badge--shared').text()).toBe('De la comunidad');
    expect(card.find('.card__badge--mine').exists()).toBe(false);
    expect(card.findAll('.card__badge--shared')).toHaveLength(1);
  });

  it('says it on the user\'s own routes only as "Creada por ti"', () => {
    const card = mountCard({ route: userRoute({ sync: 'synced' }) });
    expect(card.find('.card__badge--shared').exists()).toBe(false);
    expect(card.get('.card__badge--mine').text()).toBe('Creada por ti');
  });

  it('says "Publicada" on an own route that is public, when the screen asks for it', async () => {
    const card = mountCard({
      route: userRoute({ sync: 'synced', published: true }),
      published: true,
    });
    expect(card.findAll('.card__badge').map((badge) => badge.text())).toEqual([
      'Creada por ti',
      'Publicada',
    ]);
    expect(card.find('.card__badge--shared').text()).toBe('Publicada');
    applyLocale('en');
    await card.vm.$nextTick();
    expect(card.findAll('.card__badge').map((badge) => badge.text())).toEqual([
      'Created by you',
      'Published',
    ]);
    applyLocale('pt');
    await card.vm.$nextTick();
    expect(card.findAll('.card__badge').map((badge) => badge.text())).toEqual([
      'Criada por ti',
      'Publicada',
    ]);
  });

  it("has neither label on a private route of the user's, nor on a curated one", () => {
    const own = mountCard({ route: userRoute({ sync: 'synced' }) });
    expect(own.findAll('.card__badge--shared')).toHaveLength(0);
    const curated = mountCard({
      route: {
        ...userRoute(),
        bundle: { ...userRoute().bundle, spec: { ...userRoute().bundle.spec, source: 'curated' } },
      },
    });
    expect(curated.findAll('.card__badge--shared')).toHaveLength(0);
  });

  it('keeps the labels clear of the menu button laid over a cover', () => {
    const card = mountCard({
      route: userRoute({ sync: 'synced', published: true }),
      published: true,
      menuSpace: true,
    });
    expect(card.get('.card__badges').classes()).toContain('card__badges--menu');
  });
});
