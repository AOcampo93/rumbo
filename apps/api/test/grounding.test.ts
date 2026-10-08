import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createGrounding,
  type EntityFacts,
  GroundingError,
  htmlText,
  isOpenLicense,
  MAX_ARTICLE_CHARS,
  prepareArticle,
  sameName,
} from '../src/ai/grounding.js';
import type { Fetch } from '../src/geo/wikidata.js';

// The research behind a card against answers recorded from the real Wikidata,
// Wikipedia and Commons APIs near Leiria (test/fixtures/ai, captured on
// 2026-10-08 through this very module and trimmed to what it reads; the
// Portuguese article is cut at 8.7 KB). No test touches the network.
// Wikidata is CC0; the article texts are Wikipedia's, CC BY-SA 4.0
// (https://creativecommons.org/licenses/by-sa/4.0/), authors in the page
// histories of "Castelo de Leiria", "Castillo de Leiría" and "Castle of Leiria".

const UA = 'Rumbo/0.1.0 (https://github.com/AOcampo93/rumbo)';
const signal = () => AbortSignal.timeout(5000);

interface Exchange {
  url: string;
  body: unknown;
}

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/ai/${name}.json`, import.meta.url), 'utf8'),
  ) as Exchange[];

/** Same request whatever the order of its parameters. */
const canonical = (url: string) => {
  const parsed = new URL(url);
  parsed.searchParams.sort();
  return parsed.toString();
};

/** Wikimedia as recorded in these fixtures; anything else answers 404. */
function recorded(...names: string[]) {
  const answers = new Map(names.flatMap(fixture).map(({ url, body }) => [canonical(url), body]));
  return vi.fn<Fetch>(async (url) => {
    const body = answers.get(canonical(url));
    return body === undefined ? new Response('Not found', { status: 404 }) : Response.json(body);
  });
}

/** What each request asked of which host: "wikipedia pt Castelo de Leiria"… */
const asked = (fetch: ReturnType<typeof vi.fn<Fetch>>) =>
  fetch.mock.calls.map(([url]) => {
    const parsed = new URL(url);
    const p = parsed.searchParams;
    return [
      parsed.hostname,
      p.get('action'),
      p.get('titles') ?? p.get('ids') ?? p.get('entity') ?? p.get('srsearch'),
      p.get('property'),
    ]
      .filter(Boolean)
      .join(' ');
  });

const grounding = (
  fetch: Fetch,
  options: Parameters<typeof createGrounding>[0] extends infer O ? Partial<O> : never = {},
) => createGrounding({ userAgent: UA, fetch, ...options });

/** A fetch that never answers, and fails the way fetch does when its signal aborts (also if it already has). */
function hanging() {
  return vi.fn<Fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const stop = () => reject(new DOMException('aborted', 'AbortError'));
        if (init.signal?.aborted) stop();
        else init.signal?.addEventListener('abort', stop);
      }),
  );
}

const facts = (overrides: Partial<EntityFacts> = {}): EntityFacts => ({
  id: 'Q1',
  sitelinks: {},
  images: [],
  types: [],
  ...overrides,
});

// ---------------------------------------------------------------- synthetic Wikimedia

/** A Wikipedia that answers every title with this page. */
function wikipedia(pages: Record<string, Record<string, unknown>>) {
  return vi.fn<Fetch>(async (url) => {
    const parsed = new URL(url);
    const lang = parsed.hostname.split('.')[0] as string;
    const page = pages[lang];
    return Response.json({
      query: { pages: [page ?? { title: parsed.searchParams.get('titles'), missing: true }] },
    });
  });
}

const article = (
  lang: string,
  title: string,
  extract: string,
  extra: Record<string, unknown> = {},
) => ({
  title,
  extract,
  fullurl: `https://${lang}.wikipedia.org/wiki/${title.replace(/ /g, '_')}`,
  ...extra,
});

const prose = (chars: number, sentence = 'Esta frase conta algo do lugar. ') =>
  sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);

/** A Commons that answers with this image info. */
function commons(info: Record<string, unknown> | null, page: Record<string, unknown> = {}) {
  return vi.fn<Fetch>(async () =>
    Response.json({
      query: {
        pages: [
          { title: 'File:X.jpg', ...(info ? { imageinfo: [info] } : { missing: true }), ...page },
        ],
      },
    }),
  );
}

const photo = (overrides: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
  mime: 'image/jpeg',
  width: 2000,
  thumburl:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg?utm_source=commons.wikimedia.org',
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  extmetadata: Object.fromEntries(
    Object.entries({
      Artist: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana</a>',
      LicenseShortName: 'CC BY-SA 4.0',
      ...meta,
    }).map(([key, value]) => [key, { value }]),
  ),
  ...overrides,
});

// ---------------------------------------------------------------- entityFacts

describe('entityFacts', () => {
  it("reads a monument's names, articles, photo and types in three small requests", async () => {
    const fetch = recorded('castelo');
    const result = await grounding(fetch).entityFacts('Q2969701', 'es', signal());
    expect(result).toEqual({
      id: 'Q2969701',
      label: 'Castillo de Leiria',
      description: 'castillo medieval localizado en la ciudad de Leiría, Portugal',
      sitelinks: { es: 'Castillo de Leiría', en: 'Castle of Leiria', pt: 'Castelo de Leiria' },
      images: ['CASTELO DE LEIRIA.jpg'],
      types: ['Q23413', 'Q210272'],
    });
    expect(asked(fetch).sort()).toEqual([
      'www.wikidata.org wbgetclaims Q2969701 P18',
      'www.wikidata.org wbgetclaims Q2969701 P31',
      'www.wikidata.org wbgetentities Q2969701',
    ]);
    // The hygiene of every upstream request.
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toMatch(/format=json&formatversion=2$/);
      expect(init.redirect).toBe('error');
      expect(init.headers).toMatchObject({ 'User-Agent': UA });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('has no sitelinks for a place nobody wrote an article about', async () => {
    const result = await grounding(recorded('banco-das-artes')).entityFacts(
      'Q112568674',
      'es',
      signal(),
    );
    expect(result).toMatchObject({
      label: 'Banco das Artes Galeria',
      sitelinks: {},
      images: ['Banco das Artes Galeria Leiria 01.jpg'],
      types: ['Q1007870'],
    });
  });

  it('is null for an item that does not exist, in both ways Wikidata says it', async () => {
    const fetch = recorded('missing');
    const geo = grounding(fetch);
    expect(await geo.entityFacts('Q99999999', 'es', signal())).toBeNull();
    expect(await geo.entityFacts('Q999999999999', 'es', signal())).toBeNull();
    // Nothing else was asked once there was no item.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for what is not an item id', async () => {
    const fetch = recorded();
    for (const id of ['', 'Q', 'q1', 'Q1|Q2', 'Q1&action=wbeditentity', 'Q1234567890123', 'P31']) {
      expect(await grounding(fetch).entityFacts(id, 'es', signal())).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prefers the preferred statement, skips deprecated ones and fallback names of other languages', async () => {
    const claim = (value: unknown, rank = 'normal') => ({
      rank,
      mainsnak: { snaktype: 'value', datavalue: { value } },
    });
    const fetch = vi.fn<Fetch>(async (url) => {
      const p = new URL(url).searchParams;
      if (p.get('action') === 'wbgetentities') {
        return Response.json({
          entities: {
            Q5: {
              id: 'Q5',
              labels: {
                es: { language: 'en', value: 'English standing in for Spanish' },
                pt: { language: 'pt', value: 'Nome português' },
                en: { language: 'en', value: 'English name' },
              },
              descriptions: { es: { language: 'es-419', value: 'descripción' } },
              sitelinks: {
                eswiki: { site: 'eswiki', title: 'Título' },
                frwiki: { title: 'Titre' },
              },
            },
          },
        });
      }
      const property = p.get('property');
      const list =
        property === 'P18'
          ? [claim('Old.jpg', 'deprecated'), claim('Normal.jpg'), claim('Best.jpg', 'preferred')]
          : [
              claim({ id: 'Q23413' }),
              claim({ id: 'not an id' }),
              claim({ id: 'Q16970' }, 'preferred'),
            ];
      return Response.json({ claims: { [String(property)]: list } });
    });
    expect(await grounding(fetch).entityFacts('Q5', 'es', signal())).toEqual({
      id: 'Q5',
      // Spanish has no name of its own, so Portuguese (the places' own) is next.
      label: 'Nome português',
      description: 'descripción',
      sitelinks: { es: 'Título' },
      images: ['Best.jpg', 'Normal.jpg'],
      types: ['Q16970', 'Q23413'],
    });
  });
});

// ---------------------------------------------------------------- wikipediaText

describe('wikipediaText', () => {
  const castle = async () => {
    const geo = grounding(recorded('castelo'));
    return { geo, facts: (await geo.entityFacts('Q2969701', 'es', signal())) as EntityFacts };
  };

  it("compares the other languages when the user's is a stub, and takes the much longer one", async () => {
    const fetch = recorded('castelo');
    const geo = grounding(fetch);
    const castleFacts = (await geo.entityFacts('Q2969701', 'es', signal())) as EntityFacts;
    fetch.mockClear();
    const text = await geo.wikipediaText(castleFacts, 'es', signal());
    expect(text).toMatchObject({
      title: 'Castelo de Leiria',
      url: 'https://pt.wikipedia.org/wiki/Castelo_de_Leiria',
      lang: 'pt',
      image: 'CASTELO_DE_LEIRIA.jpg',
    });
    expect(text?.text.startsWith('O Castelo de Leiria localiza-se freguesia')).toBe(true);
    expect(text?.text.length).toBeLessThanOrEqual(MAX_ARTICLE_CHARS);
    expect(text?.text.length).toBeGreaterThan(5000);
    // Whole paragraphs, headings kept for structure, nothing left hanging.
    expect(text?.text).toContain('== História ==\n=== Antecedentes ===');
    expect(text?.text.split('\n').at(-1)).not.toMatch(/^=/);
    // The Spanish article first (a stub of 511 characters), then the others.
    const hosts = asked(fetch).map((line) => line.split(' ')[0]);
    expect(hosts[0]).toBe('es.wikipedia.org');
    expect(hosts.slice(1).sort()).toEqual(['en.wikipedia.org', 'pt.wikipedia.org']);
  });

  it("takes the user's language alone when its article is not a stub", async () => {
    const { geo, facts: castleFacts } = await castle();
    const fetch = recorded('castelo');
    const only = grounding(fetch);
    const pt = await only.wikipediaText(castleFacts, 'pt', signal());
    expect(pt?.lang).toBe('pt');
    expect(asked(fetch)).toHaveLength(1);
    const en = await only.wikipediaText(castleFacts, 'en', signal());
    expect(en).toMatchObject({ lang: 'en', title: 'Castle of Leiria' });
    expect(asked(fetch)).toHaveLength(2);
    void geo;
  });

  it("keeps the user's language unless another one is clearly longer", async () => {
    const pages = {
      es: article('es', 'Plaza', prose(1000)),
      en: article('en', 'Square', prose(1400)),
      pt: article('pt', 'Praça', prose(1600)),
    };
    const links = facts({ sitelinks: { es: 'Plaza', en: 'Square', pt: 'Praça' } });
    // 1400 is not 1.5 times 1000; Portuguese at 1600 is.
    expect((await grounding(wikipedia(pages)).wikipediaText(links, 'es', signal()))?.lang).toBe(
      'pt',
    );
    expect(
      (
        await grounding(
          wikipedia({ ...pages, pt: article('pt', 'Praça', prose(1400)) }),
        ).wikipediaText(links, 'es', signal())
      )?.lang,
    ).toBe('es');
  });

  it('is null without articles, and skips disambiguation pages and missing ones', async () => {
    const none = wikipedia({});
    expect(await grounding(none).wikipediaText(facts(), 'es', signal())).toBeNull();
    expect(none).not.toHaveBeenCalled();

    const links = facts({
      sitelinks: { es: 'Leiria (desambiguación)', en: 'Leiria (disambiguation)' },
    });
    const pages = {
      es: article('es', 'Leiria (desambiguación)', prose(3000), {
        pageprops: { disambiguation: '' },
      }),
    };
    // The English title is missing: nothing usable is left.
    expect(await grounding(wikipedia(pages)).wikipediaText(links, 'es', signal())).toBeNull();
  });

  it("builds the address itself when the API's is not the wiki's", async () => {
    const links = facts({ sitelinks: { es: 'Sé de Leiria' } });
    const page = article('es', 'Sé de Leiria', prose(2000), {
      fullurl: 'https://evil.example/wiki/Se',
    });
    const text = await grounding(wikipedia({ es: page })).wikipediaText(links, 'es', signal());
    expect(text?.url).toBe('https://es.wikipedia.org/wiki/S%C3%A9_de_Leiria');
  });

  it('settles for the lead of an article too big to read whole', async () => {
    const links = facts({ sitelinks: { es: 'Portugal' } });
    const fetch = vi.fn<Fetch>(async (url) => {
      const intro = new URL(url).searchParams.has('exintro');
      return intro
        ? Response.json({ query: { pages: [article('es', 'Portugal', prose(2000))] } })
        : new Response('x'.repeat(5000), { status: 200 });
    });
    const text = await grounding(fetch, { maxBodyBytes: 4000 }).wikipediaText(
      links,
      'es',
      signal(),
    );
    expect(text?.text.length).toBeGreaterThan(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('prepareArticle', () => {
  it('drops the back matter, the headings with nothing under them and the controls', () => {
    const extract = [
      'Lead paragraph.\u0000',
      '',
      '== História ==',
      '=== Antecedentes ===',
      'Texto dos antecedentes.\tCom tabulação.',
      '',
      '== Vazio ==',
      '',
      '== Ligações externas ==',
      'Not part of the story.',
      '== Depois ==',
      'Nor this.',
    ].join('\n');
    expect(prepareArticle(extract)).toBe(
      [
        'Lead paragraph.',
        '== História ==',
        '=== Antecedentes ===',
        'Texto dos antecedentes. Com tabulação.',
      ].join('\n'),
    );
  });

  it('knows the back matter of all three languages', () => {
    for (const heading of [
      'References',
      'Referencias',
      'Referências',
      'Bibliografía',
      'Véase también',
      'External links',
    ]) {
      expect(prepareArticle(`Lead.\n\n== ${heading} ==\nOther.`)).toBe('Lead.');
    }
  });

  it('cuts at the end of a paragraph, else of a sentence, and never leaves a heading last', () => {
    const paragraph = (n: number) => `Paragraph ${n} ${'x'.repeat(380)}.`;
    const text = [paragraph(1), paragraph(2), '== Next ==', paragraph(3)].join('\n');
    const cut = prepareArticle(text, 900);
    expect(cut).toBe([paragraph(1), paragraph(2)].join('\n'));

    const long = `${'Una frase de relleno. '.repeat(100)}`.trim();
    const bySentence = prepareArticle(long, 500);
    expect(bySentence.endsWith('relleno.')).toBe(true);
    expect(bySentence.length).toBeLessThanOrEqual(500);

    expect(prepareArticle('x'.repeat(100), 50)).toHaveLength(50);
    expect(prepareArticle('Short.')).toBe('Short.');
  });

  it('does not split a surrogate pair when it cuts', () => {
    const cut = prepareArticle(`${'a'.repeat(49)}😀😀😀`, 50);
    expect(cut).toBe('a'.repeat(49));
  });
});

// ---------------------------------------------------------------- commonsImage

describe('commonsImage', () => {
  it('turns a photo into a MediaRef with author, licence and page, without tracking parameters', async () => {
    const fetch = recorded('castelo');
    const image = await grounding(fetch).commonsImage(
      'CASTELO DE LEIRIA.jpg',
      'Castillo de Leiría',
      signal(),
    );
    expect(image).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/1/10/CASTELO_DE_LEIRIA.jpg',
      alt: 'Castillo de Leiría',
      credit: 'JMFH4778',
      license: 'CC BY-SA 3.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:CASTELO_DE_LEIRIA.jpg',
    });
    const params = new URL(fetch.mock.calls[0]?.[0] as string).searchParams;
    expect(params.get('titles')).toBe('File:CASTELO DE LEIRIA.jpg');
    // One of Wikimedia's standard widths, within the 1024 a card may use.
    expect(params.get('iiurlwidth')).toBe('960');
  });

  it('moves a thumbnail from thumb.wikimedia.org to upload.wikimedia.org, where a user route may use it', async () => {
    const image = await grounding(recorded('banco-das-artes')).commonsImage(
      'Banco das Artes Galeria Leiria 01.jpg',
      'Banco das Artes Galeria',
      signal(),
    );
    expect(image?.url).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Banco_das_Artes_Galeria_Leiria_01.jpg/960px-Banco_das_Artes_Galeria_Leiria_01.jpg',
    );
    expect(image).toMatchObject({ credit: 'GualdimG', license: 'CC BY-SA 4.0' });
  });

  it('reads the author out of the HTML, falls back to the credit, and cuts the texts', async () => {
    const withEntities = commons(
      photo({}, { Artist: '<span>Ana &amp; Rui &#x27;Silva&#39;</span> <b>(CC)</b>' }),
    );
    expect((await grounding(withEntities).commonsImage('X.jpg', 'x', signal()))?.credit).toBe(
      "Ana & Rui 'Silva' (CC)",
    );
    const noArtist = commons(photo({}, { Artist: '', Credit: '<span lang="en">Own work</span>' }));
    expect((await grounding(noArtist).commonsImage('X.jpg', 'x', signal()))?.credit).toBe(
      'Own work',
    );
    const none = commons(photo({}, { Artist: '', Credit: '' }));
    const bare = await grounding(none).commonsImage('X.jpg', 'a'.repeat(400), signal());
    expect(bare).not.toHaveProperty('credit');
    expect(bare?.alt).toHaveLength(300);
    const longName = commons(photo({}, { Artist: `<a>${'n'.repeat(300)}</a>` }));
    expect((await grounding(longName).commonsImage('X.jpg', 'x', signal()))?.credit).toHaveLength(
      200,
    );
  });

  it('only takes open licences', async () => {
    for (const license of [
      'CC0',
      'CC0 1.0',
      'Public domain',
      'PD-old-70',
      'CC BY 2.0',
      'CC BY-SA 3.0 pt',
    ]) {
      const image = await grounding(commons(photo({}, { LicenseShortName: license }))).commonsImage(
        'X.jpg',
        'x',
        signal(),
      );
      expect(image?.license, license).toBe(license);
    }
    for (const license of [
      'CC BY-NC 4.0',
      'CC BY-ND 2.0',
      'CC BY-NC-SA 3.0',
      'GFDL',
      'Fair use',
      'All rights reserved',
      '',
    ]) {
      const image = await grounding(commons(photo({}, { LicenseShortName: license }))).commonsImage(
        'X.jpg',
        'x',
        signal(),
      );
      expect(image, license).toBeNull();
    }
  });

  it('refuses what is no photo for a card', async () => {
    const take = (info: Record<string, unknown> | null) =>
      grounding(commons(info)).commonsImage('X.jpg', 'x', signal());
    expect(await take(photo())).not.toBeNull();
    expect(await take(photo({ mime: 'video/webm' }))).toBeNull();
    expect(await take(photo({ mime: 'application/pdf' }))).toBeNull();
    expect(await take(photo({ width: 200 }))).toBeNull();
    expect(await take(null)).toBeNull();
    // Addresses outside Wikimedia's image servers, or not https.
    expect(await take(photo({ thumburl: 'https://evil.example/x.jpg' }))).toBeNull();
    expect(await take(photo({ thumburl: 'http://upload.wikimedia.org/x.jpg' }))).toBeNull();
    expect(await take(photo({ thumburl: 'javascript:alert(1)' }))).toBeNull();
    // The original stands in when there is no thumbnail.
    const original = await take(photo({ thumburl: undefined }));
    expect(original?.url).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg');
    expect(await take(photo({ descriptionurl: 'https://evil.example/' }))).not.toHaveProperty(
      'sourceUrl',
    );
  });
});

describe('isOpenLicense and htmlText', () => {
  it('know the licences and the markup', () => {
    expect(isOpenLicense('cc by-sa 4.0')).toBe(true);
    expect(isOpenLicense('CC BY-SA')).toBe(false);
    expect(isOpenLicense('Creative Commons Attribution')).toBe(false);
    expect(htmlText('<a href="x">A</a> &lt;b&gt; &nbsp;&unknown; &#0; &#x110000;', 100)).toBe(
      'A <b> &unknown;',
    );
  });
});

// ---------------------------------------------------------------- nearbyEntity

describe('nearbyEntity', () => {
  const LIS = { lat: 39.7436, lng: -8.8071 };

  it('finds nothing for a river that no nearby item is named after', async () => {
    // The search finds bridges "over the Rio Lis" and the Rio Lena, none of them the river.
    const fetch = recorded('nearby');
    expect(await grounding(fetch).nearbyEntity('Rio Lis', LIS, 'es', signal())).toBeNull();
    expect(asked(fetch)[0]).toContain('rio lis haswbstatement:P625 nearcoord:2km,39.744,-8.807');
  });

  it('finds the item of a place typed by hand, whatever the accents, case and filler words', async () => {
    const castle = { lat: 39.747, lng: -8.81 };
    // Same words once folded, so the same recorded search answers all of them.
    for (const name of ['Castelo de Leiria', 'CASTELO DE LEIRIÁ', '  castelo   de leiria ']) {
      const found = await grounding(recorded('nearby')).nearbyEntity(name, castle, 'es', signal());
      expect(found, name).toBe('Q2969701');
    }
  });

  it("matches the names of the item in the user's languages, aliases included", async () => {
    const fetch = vi.fn<Fetch>(async (url) => {
      const p = new URL(url).searchParams;
      if (p.get('list') === 'search') {
        return Response.json({ query: { search: [{ title: 'Q10' }, { title: 'Q11' }] } });
      }
      return Response.json({
        entities: {
          Q10: { id: 'Q10', labels: { pt: { language: 'pt', value: 'Outro sítio' } } },
          Q11: {
            id: 'Q11',
            labels: { pt: { language: 'pt', value: 'Mercado de Sant’Ana' } },
            aliases: { pt: [{ language: 'pt', value: 'Mercado Municipal' }] },
          },
        },
      });
    });
    const geo = grounding(fetch);
    expect(await geo.nearbyEntity('mercado municipal', LIS, 'es', signal())).toBe('Q11');
    expect(await geo.nearbyEntity('Mercado Sant Ana', LIS, 'es', signal())).toBe('Q11');
    expect(await geo.nearbyEntity('Mercado', LIS, 'es', signal())).toBeNull();
  });

  it('does not search for what is not a name worth searching', async () => {
    const fetch = recorded();
    for (const name of ['', '--', 'a', 'de la', 'insource:/x/ -y']) {
      expect(await grounding(fetch).nearbyEntity(name, LIS, 'es', signal())).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks nothing more when the search finds nothing', async () => {
    const fetch = vi.fn<Fetch>(async () => Response.json({ query: { search: [] } }));
    expect(
      await grounding(fetch).nearbyEntity('Pastelaria Estrela', LIS, 'es', signal()),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('sameName', () => {
  it('compares the significant words, not their order, case, accents or filler', () => {
    expect(sameName('Sé de Leiria', 'se leiria')).toBe(true);
    expect(sameName('Rio Lis', 'Lis Rio')).toBe(true);
    expect(sameName('Rio Lis', 'Ponte do Rio Lis')).toBe(false);
    expect(sameName('Castelo', 'Castelo de Leiria')).toBe(false);
    expect(sameName('de la', 'de la')).toBe(false);
  });
});

// ---------------------------------------------------------------- failures

describe('when Wikimedia misbehaves', () => {
  const lookup = (geo: ReturnType<typeof createGrounding>) =>
    geo.entityFacts('Q2969701', 'es', signal());
  const reason = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GroundingError);
    return (error as GroundingError).reason;
  };

  it('pauses after a 429 or a 5xx for as long as it says, and then tries again', async () => {
    let time = 1_000_000;
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
      )
      .mockImplementation(async () =>
        Response.json({ entities: { Q2969701: { id: 'Q2969701', missing: '' } } }),
      );
    const geo = grounding(fetch, { now: () => time });
    expect(await reason(lookup(geo))).toBe('rate_limited');
    expect(fetch).toHaveBeenCalledTimes(1);
    // Paused: not even a request.
    time += 119_000;
    expect(await reason(lookup(geo))).toBe('paused');
    expect(fetch).toHaveBeenCalledTimes(1);
    time += 2_000;
    expect(await lookup(geo)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pauses a minute when it does not say, and never longer than an hour', async () => {
    let time = 0;
    const down = vi.fn<Fetch>(async () => new Response('', { status: 503 }));
    const geo = grounding(down, { now: () => time });
    expect(await reason(lookup(geo))).toBe('upstream_down');
    time = 59_000;
    expect(await reason(lookup(geo))).toBe('paused');

    time = 0;
    const long = vi.fn<Fetch>(
      async () => new Response('', { status: 429, headers: { 'retry-after': '999999' } }),
    );
    const geo2 = grounding(long, { now: () => time });
    await reason(lookup(geo2));
    time = 3_599_000;
    expect(await reason(lookup(geo2))).toBe('paused');
    time = 3_601_000;
    expect(await reason(lookup(geo2))).toBe('rate_limited');
  });

  it('reports the other failures by reason only', async () => {
    const answer = (response: () => Response | Promise<Response>, options = {}) =>
      reason(
        lookup(
          grounding(
            vi.fn<Fetch>(async () => response()),
            options,
          ),
        ),
      );
    expect(await answer(() => new Response('', { status: 404 }))).toBe('upstream_status');
    expect(await answer(() => new Response('not json', { status: 200 }))).toBe('bad_response');
    expect(await answer(() => Response.json({ error: { code: 'internal_api_error' } }))).toBe(
      'upstream_error',
    );
    expect(await answer(() => Response.json({ error: { code: 'maxlag' } }))).toBe('rate_limited');
    expect(await answer(() => new Response('x'.repeat(2000)), { maxBodyBytes: 1000 })).toBe(
      'too_large',
    );
    const broken = await reason(
      lookup(
        grounding(
          vi.fn<Fetch>(async () => {
            throw new TypeError('connect ECONNREFUSED 10.0.0.1');
          }),
        ),
      ),
    );
    expect(broken).toBe('network');
  });

  it('stops when the caller goes away or the deadline passes', async () => {
    const stuck = hanging();
    const controller = new AbortController();
    const gone = reason(grounding(stuck).entityFacts('Q2969701', 'es', controller.signal));
    controller.abort();
    expect(await gone).toBe('aborted');
    expect(
      await reason(grounding(stuck).entityFacts('Q2969701', 'es', AbortSignal.timeout(20))),
    ).toBe('timeout');
    expect(await reason(grounding(stuck).entityFacts('Q2969701', 'es', AbortSignal.abort()))).toBe(
      'aborted',
    );
  });

  it('runs a few requests at a time, the rest waiting in line', async () => {
    let running = 0;
    let peak = 0;
    const fetch = vi.fn<Fetch>(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return Response.json({ entities: {} });
    });
    const geo = grounding(fetch, { maxConcurrency: 2 });
    await Promise.all(Array.from({ length: 6 }, () => geo.entityFacts('Q2969701', 'es', signal())));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(peak).toBe(2);
  });

  it('lets a request that waits in line leave it when it is aborted', async () => {
    const release: Array<() => void> = [];
    const fetch = vi.fn<Fetch>(
      () => new Promise((resolve) => release.push(() => resolve(Response.json({ entities: {} })))),
    );
    const geo = grounding(fetch, { maxConcurrency: 1 });
    const first = geo.entityFacts('Q1', 'es', signal());
    const controller = new AbortController();
    const waiting = reason(geo.entityFacts('Q2', 'es', controller.signal));
    controller.abort();
    expect(await waiting).toBe('aborted');
    release[0]?.();
    expect(await first).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
