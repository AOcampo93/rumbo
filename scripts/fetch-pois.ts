// Builds data/pois/leiria.json, the points of interest of the Explore map
// (PROJECT_PLAN §15, option A for the 20+ markers): names and coordinates from
// Wikidata (CC0), photos from Wikimedia Commons with author and licence.
// Run by hand when the list changes: `pnpm data:pois`. CI only validates the file.
import { writeFile } from 'node:fs/promises';
import { type PointCategory, type Poi, PoiCollectionSchema } from '@rumbo/route-spec';

const USER_AGENT = 'RumboDataScript/0.1 (https://github.com/AOcampo93/rumbo)';
const OUT = new URL('../data/pois/leiria.json', import.meta.url);

/**
 * Hand-picked places near the old town that a visitor would care about.
 * The 12 points of `leiria-historica` are left out, and so are places whose
 * marker would sit on top of one of them (validate-routes warns under 30 m):
 * the poet's statue on Praça Rodrigues Lobo, the Sé's bell tower and the
 * Celeiros da Mitra next to São Pedro.
 */
const PLACES: Record<string, PointCategory> = {
  Q76956778: 'church', // Igreja do Espírito Santo
  Q109442047: 'monument', // Paço Episcopal
  Q109444808: 'monument', // Palacete do Visconde da Barreira
  Q109450996: 'church', // Recolhimento e Igreja de Santo Estêvão
  Q66814153: 'church', // Convento de Santo António dos Capuchos
  Q10347036: 'monument', // Câmara Municipal
  Q10283294: 'monument', // Fonte Luminosa
  Q10283313: 'monument', // Fonte das Três Bicas
  Q115527195: 'monument', // Fonte do Arrabalde
  Q109654275: 'monument', // Ponte do Arrabalde
  Q109655227: 'monument', // Arcos de Azenha Medieval
  Q109653389: 'culture', // Moinhos do Lis e Vala Real
  Q109661393: 'monument', // Monumento a D. Afonso Henriques
  Q112580834: 'monument', // Estátua de D. Afonso III
  Q112581709: 'monument', // O Pastor Peregrino
  Q109653643: 'nature', // Parque Municipal
  Q109658791: 'nature', // Parque do Santuário da Encarnação
  Q73038321: 'culture', // Biblioteca Municipal Afonso Lopes Vieira
  Q112568674: 'museum', // Banco das Artes Galeria
  Q109465202: 'other', // Posto de Turismo
  Q1056864: 'culture', // Estádio Dr. Magalhães Pessoa
  Q109444565: 'food', // Edifício do Café Colonial
  Q8840924: 'other', // Estação Ferroviária
  Q109453524: 'culture', // Quiosque no Largo Alexandre Herculano
  Q109662149: 'monument', // Ponte metálica ferroviária sobre o Lis
};

interface Binding {
  [name: string]: { value: string } | undefined;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

async function queryWikidata(): Promise<Binding[]> {
  const values = Object.keys(PLACES)
    .map((qid) => `wd:${qid}`)
    .join(' ');
  const query = `
    SELECT ?item ?pt ?es ?en ?coord ?image ?ptwiki ?eswiki ?enwiki WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P625 ?coord .
      OPTIONAL { ?item rdfs:label ?pt FILTER(LANG(?pt) = "pt") }
      OPTIONAL { ?item rdfs:label ?es FILTER(LANG(?es) = "es") }
      OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?ptwiki schema:about ?item ; schema:isPartOf <https://pt.wikipedia.org/> }
      OPTIONAL { ?eswiki schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> }
      OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
    }`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const data = await getJson<{ results: { bindings: Binding[] } }>(url);
  return data.results.bindings;
}

/** "Point(-8.80 39.74)" → { lat, lng }. */
function parsePoint(wkt: string): { lat: number; lng: number } {
  const match = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(wkt);
  if (!match) throw new Error(`Unexpected coordinate ${wkt}`);
  return { lat: Number(Number(match[2]).toFixed(6)), lng: Number(Number(match[1]).toFixed(6)) };
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

interface CommonsImage {
  url: string;
  credit?: string;
  license?: string;
  sourceUrl: string;
}

/** Thumbnail, author and licence of a Commons file. */
async function commonsImage(filePathUrl: string): Promise<CommonsImage | null> {
  const fileName = decodeURIComponent(filePathUrl.split('/Special:FilePath/')[1] ?? '');
  if (!fileName) return null;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    titles: `File:${fileName}`,
  });
  type Page = {
    imageinfo?: Array<{
      thumburl?: string;
      descriptionurl: string;
      extmetadata?: Record<string, { value: string } | undefined>;
    }>;
  };
  const data = await getJson<{ query?: { pages?: Record<string, Page> } }>(
    `https://commons.wikimedia.org/w/api.php?${params}`,
  );
  const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const artist = info.extmetadata?.Artist?.value;
  const license = info.extmetadata?.LicenseShortName?.value;
  return {
    url: info.thumburl,
    sourceUrl: info.descriptionurl,
    ...(artist ? { credit: stripHtml(artist).slice(0, 200) } : {}),
    ...(license ? { license: stripHtml(license).slice(0, 100) } : {}),
  };
}

const rows = await queryWikidata();
const pois: Poi[] = [];
for (const [qid, category] of Object.entries(PLACES)) {
  const row = rows.find((r) => r.item?.value.endsWith(`/${qid}`));
  if (!row?.coord || !row.pt) {
    console.warn(`⚠ ${qid}: no coordinates or Portuguese label, skipped`);
    continue;
  }
  const name: Record<string, string> = { pt: row.pt.value };
  if (row.es) name.es = row.es.value;
  if (row.en) name.en = row.en.value;
  const wikipedia: Record<string, string> = {};
  for (const locale of ['pt', 'es', 'en'] as const) {
    const link = row[`${locale}wiki`]?.value;
    if (link) wikipedia[locale] = link;
  }
  const image = row.image ? await commonsImage(row.image.value) : null;
  pois.push({
    id: qid,
    name,
    position: parsePoint(row.coord.value),
    category,
    ...(image ? { image: { ...image, alt: name } } : {}),
    ...(Object.keys(wikipedia).length > 0 ? { wikipedia } : {}),
  });
  // Be gentle with the Wikimedia APIs.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const collection = PoiCollectionSchema.parse({
  id: 'leiria',
  name: { es: 'Leiria', en: 'Leiria', pt: 'Leiria' },
  locale: 'pt',
  source: 'wikidata',
  license: 'CC0 1.0 (Wikidata); images: see each credit and licence (Wikimedia Commons)',
  generatedAt: new Date().toISOString(),
  pois: pois.sort((a, b) => a.id.localeCompare(b.id)),
});
await writeFile(OUT, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`✓ ${collection.pois.length} points of interest → data/pois/leiria.json`);
