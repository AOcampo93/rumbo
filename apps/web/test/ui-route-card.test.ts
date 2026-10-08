import { buildRouteSpec } from '@rumbo/route-builder';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import RouteCard from '../src/components/RouteCard.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { type CatalogRoute, toCatalogRoute } from '../src/services/catalog.ts';

// RouteCard: the user's own routes say "Creada por ti" (DESIGN §7).

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
