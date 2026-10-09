import { INTERESTS } from '@rumbo/api-contract';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { MediaRef, RouteBundle } from '@rumbo/route-spec';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import RouteCard from '../src/components/RouteCard.vue';
import RouteCover, { coverInterest, INTEREST_ICONS } from '../src/components/RouteCover.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { routeImageUrls, toCatalogRoute } from '../src/services/catalog.ts';

// RouteCover (DESIGN §7 RouteCard, phase 7.3, ADR 0005): the 16:9 face of a
// route. Its photo; if that fails to load, or there is none, the illustration
// of its first interest; and without interests the brand's azulejo pattern.
// RouteCard wears it with its badges over it.

const OWN = 'https://rumbo.test/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg';
const COVER: MediaRef = { url: OWN, alt: { es: 'Mi paseo por Leiria', en: 'My walk in Leiria' } };
const WIKI: MediaRef = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Castelo.jpg',
  alt: 'Castelo de Leiria',
  credit: 'Autor',
  license: 'CC BY-SA 4.0',
};

beforeEach(() => applyLocale('es'));

function mountCover(
  props: {
    cover?: MediaRef | null;
    interest?: (typeof INTERESTS)[number] | null;
    locale?: 'es' | 'en' | 'pt';
  },
  slot?: string,
) {
  return mount(RouteCover, {
    props: { locale: 'es', ...props },
    ...(slot ? { slots: { default: slot } } : {}),
    global: { plugins: [i18n] },
  });
}

describe('RouteCover, with a photo', () => {
  it('shows the photo in a 16:9 box, with the alt text in the active language', async () => {
    const cover = mountCover({ cover: COVER });
    expect(cover.attributes('data-cover')).toBe('photo');
    expect(cover.find('svg').exists()).toBe(false);
    expect(cover.classes()).not.toContain('azulejo');
    const image = cover.get('img');
    expect(image.attributes('src')).toBe(OWN);
    expect(image.attributes('alt')).toBe('Mi paseo por Leiria');
    expect(image.attributes('loading')).toBe('lazy');

    applyLocale('en');
    await cover.vm.$nextTick();
    expect(cover.get('img').attributes('alt')).toBe('My walk in Leiria');
    // The route has no Portuguese: the route's own language is the fallback.
    applyLocale('pt');
    await cover.vm.$nextTick();
    expect(cover.get('img').attributes('alt')).toBe('Mi paseo por Leiria');
  });

  it("reads a plain alt text in the route's own language", () => {
    const cover = mountCover({ cover: WIKI, locale: 'es' });
    expect(cover.get('img').attributes('alt')).toBe('Castelo de Leiria');
  });

  it('prefers the photo to the illustration, and lets the slot lie over it', () => {
    const cover = mountCover({ cover: COVER, interest: 'history' }, '<b class="over">Badges</b>');
    expect(cover.attributes('data-cover')).toBe('photo');
    expect(cover.attributes('data-interest')).toBeUndefined();
    expect(cover.classes()).not.toContain('cover--history');
    expect(cover.get('.over').text()).toBe('Badges');
  });

  it('tells the screen that the photo did not load, once, for the ones that want to say so', async () => {
    const cover = mountCover({ cover: COVER });
    expect(cover.emitted('photoError')).toBeUndefined();
    await cover.get('img').trigger('error');
    expect(cover.emitted('photoError')).toHaveLength(1);
  });

  it('falls back to the illustration of the first interest when the photo does not load', async () => {
    const cover = mountCover({ cover: COVER, interest: 'nature' });
    await cover.get('img').trigger('error');
    expect(cover.find('img').exists()).toBe(false);
    expect(cover.attributes('data-cover')).toBe('illustration');
    expect(cover.attributes('data-interest')).toBe('nature');
    expect(cover.get('svg').attributes('aria-hidden')).toBe('true');
  });

  it('falls back to the pattern when the photo does not load and there are no interests', async () => {
    const cover = mountCover({ cover: COVER });
    await cover.get('img').trigger('error');
    expect(cover.attributes('data-cover')).toBe('pattern');
    expect(cover.classes()).toContain('azulejo');
    expect(cover.find('img').exists()).toBe(false);
    expect(cover.find('svg').exists()).toBe(false);
  });

  it('tries the photo again when the cover is another one', async () => {
    const cover = mountCover({ cover: COVER });
    await cover.get('img').trigger('error');
    expect(cover.find('img').exists()).toBe(false);
    await cover.setProps({ cover: { ...COVER, url: OWN.replace('AAAA', 'BBBB') } });
    expect(cover.get('img').attributes('src')).toContain('BBBB');
    expect(cover.attributes('data-cover')).toBe('photo');
  });
});

describe('RouteCover, with the illustration of an interest', () => {
  it.each(INTERESTS)("has one for %s: a decorative tile with the theme's icon", (interest) => {
    const cover = mountCover({ interest });
    expect(cover.attributes('data-cover')).toBe('illustration');
    expect(cover.attributes('data-interest')).toBe(interest);
    expect(cover.classes()).toContain(`cover--${interest}`);
    expect(cover.classes()).not.toContain('azulejo');
    expect(cover.find('img').exists()).toBe(false);
    const art = cover.get('svg.cover__art');
    expect(art.attributes('viewBox')).toBe('0 0 320 180');
    // Decorative: the card's text is its accessible name.
    expect(art.attributes('aria-hidden')).toBe('true');
    expect(art.attributes('focusable')).toBe('false');
    expect(art.find('title').exists()).toBe(false);
    expect(art.find('pattern').exists()).toBe(true);
    // The icon of the theme, drawn big in the middle: the same drawing as the icon alone.
    const drawn = art.get('g.art-icon svg');
    expect(drawn.attributes('width')).toBe('72');
    expect(drawn.attributes('height')).toBe('72');
    const alone = mount(INTEREST_ICONS[interest]);
    expect(drawn.element.innerHTML).toBe(alone.element.innerHTML);
  });

  it('gives each interest its own icon and colour', () => {
    expect(new Set(Object.values(INTEREST_ICONS)).size).toBe(INTERESTS.length);
  });

  it('keeps the same 16:9 box with or without a photo, so nothing moves when a photo arrives', () => {
    const withPhoto = mountCover({ cover: COVER });
    const illustration = mountCover({ interest: 'art' });
    const pattern = mountCover({});
    for (const cover of [withPhoto, illustration, pattern]) {
      expect(cover.classes()).toContain('cover');
      expect(cover.element.tagName).toBe('DIV');
    }
  });

  it("gives every illustration on the page its own tile pattern, so one card's colours never leak into another's", () => {
    const list = mount(
      {
        render: () => [
          h(RouteCover, { interest: 'history', locale: 'es' }),
          h(RouteCover, { interest: 'nature', locale: 'es' }),
          h(RouteCover, { interest: 'history', locale: 'es' }),
        ],
      },
      { global: { plugins: [i18n] } },
    );
    const patterns = list.findAll('pattern').map((pattern) => pattern.attributes('id'));
    expect(patterns).toHaveLength(3);
    expect(new Set(patterns).size).toBe(3);
    const fills = list.findAll('svg.cover__art > rect').map((rect) => rect.attributes('fill'));
    expect(fills).toEqual(patterns.map((id) => `url(#${id})`));
  });

  it('puts the slot over the illustration', () => {
    const cover = mountCover({ interest: 'food' }, '<i class="badge">Libre</i>');
    expect(cover.get('.badge').text()).toBe('Libre');
  });
});

describe('RouteCover, with nothing', () => {
  it('is the azulejo pattern of the brand', () => {
    const cover = mountCover({});
    expect(cover.attributes('data-cover')).toBe('pattern');
    expect(cover.attributes('data-interest')).toBeUndefined();
    expect(cover.classes()).toContain('azulejo');
    expect(cover.find('img').exists()).toBe(false);
    expect(cover.find('svg').exists()).toBe(false);
  });

  it('is also what a null cover and a null interest give', () => {
    expect(mountCover({ cover: null, interest: null }).attributes('data-cover')).toBe('pattern');
  });
});

describe('coverInterest', () => {
  it('is the first interest of the route that has an illustration', () => {
    expect(coverInterest(['history', 'food'])).toBe('history');
    expect(coverInterest(['curiosities'])).toBe('curiosities');
    expect(coverInterest(['spaceships', 'nature', 'history'])).toBe('nature');
  });

  it('is nothing for a route without interests, or with ones it has no illustration for', () => {
    expect(coverInterest(undefined)).toBeNull();
    expect(coverInterest(null)).toBeNull();
    expect(coverInterest([])).toBeNull();
    expect(coverInterest(['spaceships', 3, null])).toBeNull();
    expect(coverInterest('history')).toBeNull();
    expect(coverInterest({ 0: 'history' })).toBeNull();
  });
});

describe('RouteCard, with the cover', () => {
  function route(extra: Record<string, unknown> = {}, spec?: Partial<RouteBundle['spec']>) {
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
      { source: 'user', idFactory: () => 'cover00001' },
    );
    const bundle: RouteBundle = {
      spec: { ...built.normalized, ...spec, ...extra } as RouteBundle['spec'],
      contents: {},
    };
    return toCatalogRoute(bundle, 0);
  }

  function mountCard(catalogRoute: ReturnType<typeof route>, props: Record<string, unknown> = {}) {
    const pinia = createPinia();
    setActivePinia(pinia);
    return mount(RouteCard, {
      props: { route: catalogRoute, ...props },
      global: { plugins: [pinia, i18n], stubs: { RouterLink: RouterLinkStub } },
    });
  }

  it("shows the route's photo, with its alt text, and the badges over it", () => {
    const card = mountCard(route({ coverImage: COVER }), { downloaded: true });
    const cover = card.get('[data-cover]');
    expect(cover.attributes('data-cover')).toBe('photo');
    expect(cover.get('img').attributes('src')).toBe(OWN);
    expect(cover.get('img').attributes('alt')).toBe('Mi paseo por Leiria');
    expect(cover.find('.card__badges').exists()).toBe(true);
    expect(cover.get('.card__badge--offline').text()).toBe('Descargada');
  });

  it("shows the illustration of the route's first interest when it has no photo", () => {
    const card = mountCard(route({ meta: { interests: ['art', 'food'] } }));
    const cover = card.get('[data-cover]');
    expect(cover.attributes('data-cover')).toBe('illustration');
    expect(cover.attributes('data-interest')).toBe('art');
    // The text of the card, not the picture, is what the link is called.
    expect(card.get('h2').text()).toBe('Mi Leiria');
    expect(cover.find('img').exists()).toBe(false);
  });

  it('shows the brand pattern for a route without photo or interests, as before', () => {
    const cover = mountCard(route()).get('[data-cover]');
    expect(cover.attributes('data-cover')).toBe('pattern');
    expect(cover.classes()).toContain('azulejo');
  });

  it('keeps its badges and labels as they are over every kind of cover', () => {
    for (const extra of [{ coverImage: COVER }, { meta: { interests: ['nature'] } }, {}]) {
      const card = mountCard(
        { ...route(extra), mine: { sync: 'synced' as const, published: true } },
        { published: true, menuSpace: true },
      );
      expect(card.findAll('.card__badge').map((badge) => badge.text())).toEqual([
        'Creada por ti',
        'Publicada',
      ]);
      expect(card.get('.card__badges').classes()).toContain('card__badges--menu');
      expect(card.find('[data-cover] .card__badges').exists()).toBe(true);
    }
  });

  it('falls back to the illustration when its photo does not load', async () => {
    const card = mountCard(route({ coverImage: COVER, meta: { interests: ['religion'] } }));
    await card.get('img').trigger('error');
    expect(card.get('[data-cover]').attributes('data-cover')).toBe('illustration');
    expect(card.get('[data-cover]').attributes('data-interest')).toBe('religion');
  });

  it("reads the alt in the route's language and follows the active one", async () => {
    const card = mountCard(route({ coverImage: COVER }));
    applyLocale('en');
    await card.vm.$nextTick();
    expect(card.get('img').attributes('alt')).toBe('My walk in Leiria');
  });
});

describe('a downloaded route keeps its cover photo', () => {
  it("lists the user's own photo among the pictures the download fetches for offline use", () => {
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
      { source: 'user', idFactory: () => 'cover00002' },
    );
    const bundle: RouteBundle = { spec: { ...built.normalized, coverImage: COVER }, contents: {} };
    expect(routeImageUrls(bundle)).toEqual([OWN]);
  });
});
