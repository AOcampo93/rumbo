import type { LiveServerMessage } from '@google/genai';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { type AppConfig, loadConfig } from '../src/config.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CHARACTER_IDS,
  createCharacters,
  DEFAULT_VOICES,
  loadAllKnowledge,
  loadKnowledge,
  systemInstruction,
} from '../src/ra-test/characters.js';
import { STATUS_RATE_LIMIT_PER_MINUTE } from '../src/routes/ra-test.js';
import type {
  LiveCallbacks,
  LiveClientContent,
  LiveConnectRequest,
  LiveConnector,
  LiveRealtimeInput,
} from '../src/ra-test/live.js';

// The AR voice prototype: /v1/ra-test/voice relays between a WebSocket client
// and a Gemini Live session. Gemini is a fake here; no key is ever needed.

const KEY = ['made', 'up', 'key'].join('-');
const CODE = ['open', 'sesame'].join('-');
const KNOWLEDGE = new URL('../../../data/ra/artesano/', import.meta.url);

class FakeSession {
  realtime: LiveRealtimeInput[] = [];
  content: LiveClientContent[] = [];
  closed = false;
  constructor(
    readonly request: LiveConnectRequest,
    readonly callbacks: LiveCallbacks,
  ) {}
  emit(message: Pick<LiveServerMessage, 'serverContent'>) {
    this.callbacks.onmessage(message as LiveServerMessage);
  }
}

function fakeConnector(options: { fail?: boolean } = {}) {
  const sessions: FakeSession[] = [];
  const connector: LiveConnector = {
    async connect(request, callbacks) {
      if (options.fail) throw new Error('provider says: secret details');
      const session = new FakeSession(request, callbacks);
      sessions.push(session);
      return {
        sendRealtimeInput: (input) => void session.realtime.push(input),
        sendClientContent: (content) => void session.content.push(content),
        close: () => {
          session.closed = true;
        },
      };
    },
  };
  return { connector, sessions };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(env: Record<string, string> = {}, connector: LiveConnector | null = null) {
  const config: AppConfig = loadConfig({
    GEMINI_API_KEY: KEY,
    RA_TEST_RATE_LIMIT_PER_MINUTE: '1000',
    ...env,
  });
  app = await buildApp(
    config,
    { database: null, data: () => null, liveConnector: connector },
    { logger: false },
  );
  return app;
}

type Received =
  { kind: 'json'; value: Record<string, unknown> } | { kind: 'binary'; bytes: Buffer };

const addresses = new WeakMap<FastifyInstance, Promise<string>>();
const listening = (server: FastifyInstance) => {
  let address = addresses.get(server);
  if (!address) {
    address = server.listen({ host: '127.0.0.1', port: 0 });
    addresses.set(server, address);
  }
  return address;
};

/**
 * Opens a real socket to the app (Fastify's injectWS does not work with this
 * Fastify version) and records everything the server sends. Rejects when the
 * handshake is refused.
 */
async function connect(
  server: FastifyInstance,
  query = '?lang=es',
  headers: Record<string, string> = {},
) {
  const address = await listening(server);
  const url = address.replace('http', 'ws');
  const received: Received[] = [];
  let closed: number | undefined;
  // Node's WebSocket (undici) takes request headers as an extension of its init argument.
  const ws = new WebSocket(`${url}/api/v1/ra-test/voice${query}`, { headers } as never);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('message', (event) => {
    received.push(
      typeof event.data === 'string'
        ? { kind: 'json', value: JSON.parse(event.data) }
        : { kind: 'binary', bytes: Buffer.from(event.data as ArrayBuffer) },
    );
  });
  ws.addEventListener('close', (event) => {
    closed = event.code;
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('handshake refused (403)')));
  });
  return {
    ws,
    received,
    json: () => received.flatMap((r) => (r.kind === 'json' ? [r.value] : [])),
    binary: () => received.flatMap((r) => (r.kind === 'binary' ? [r.bytes] : [])),
    closed: () => closed,
  };
}

async function until(condition: () => boolean, what = 'condition') {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A client that got past the checks: connected and `ready`. */
async function open(server: FastifyInstance, query = '?lang=es') {
  const client = await connect(server, query);
  await until(() => client.json().some((m) => m.type === 'ready'), 'ready');
  return client;
}

describe('the checks before Gemini opens', () => {
  it('without a key the feature is off: voice_unavailable', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({ GEMINI_API_KEY: '' }, connector);
    const client = await connect(server);
    await until(() => client.closed() !== undefined);
    expect(client.json()).toEqual([{ type: 'error', code: 'voice_unavailable' }]);
    expect(sessions).toHaveLength(0);
  });

  it('with an access code, a missing or wrong one is access_code_required and the right one passes', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({ RA_TEST_ACCESS_CODE: CODE }, connector);
    for (const query of ['?lang=es', '?lang=es&code=nope']) {
      const client = await connect(server, query);
      await until(() => client.closed() !== undefined);
      expect(client.json()).toEqual([{ type: 'error', code: 'access_code_required' }]);
    }
    expect(sessions).toHaveLength(0);
    const ok = await open(server, `?lang=es&code=${CODE}`);
    expect(ok.json()).toEqual([{ type: 'ready' }]);
  });

  it("rejects a page from another origin, accepts the site's and a local one", async () => {
    const { connector } = fakeConnector();
    const server = await setup({ PUBLIC_ORIGIN: 'https://rumbo.example' }, connector);
    await expect(connect(server, '?lang=es', { origin: 'https://evil.example' })).rejects.toThrow(
      /refused/,
    );
    const site = await connect(server, '?lang=es', { origin: 'https://rumbo.example' });
    await until(() => site.json().length > 0);
    const local = await connect(server, '?lang=es', { origin: 'http://localhost:5173' });
    await until(() => local.json().length > 0);
    expect(site.json()).toEqual([{ type: 'ready' }]);
    expect(local.json()).toEqual([{ type: 'ready' }]);
  });

  it('limits the connections per address per minute: rate_limited', async () => {
    const { connector } = fakeConnector();
    const server = await setup(
      { RA_TEST_RATE_LIMIT_PER_MINUTE: '2', RA_TEST_MAX_SESSIONS: '10' },
      connector,
    );
    await open(server);
    await open(server);
    const third = await connect(server);
    await until(() => third.closed() !== undefined);
    expect(third.json()).toEqual([{ type: 'error', code: 'rate_limited' }]);
  });

  it('caps the sessions open at once on the server: session_limit, and frees the slot on close', async () => {
    const { connector } = fakeConnector();
    const server = await setup({ RA_TEST_MAX_SESSIONS: '1' }, connector);
    const first = await open(server);
    const second = await connect(server);
    await until(() => second.closed() !== undefined);
    expect(second.json()).toEqual([{ type: 'error', code: 'session_limit' }]);
    first.ws.close();
    await until(() => first.closed() !== undefined);
    const third = await open(server);
    expect(third.json()).toEqual([{ type: 'ready' }]);
  });
});

describe('the status check of the setup box', () => {
  const status = async (server: FastifyInstance, query = '') => {
    const res = await server.inject({ method: 'GET', url: `/v1/ra-test/status${query}` });
    return { status: res.statusCode, body: res.json<Record<string, unknown>>(), res };
  };

  it('says whether the voice is on and the code is right, without opening a session', async () => {
    const { connector, sessions } = fakeConnector();
    const off = await setup({ GEMINI_API_KEY: '' }, connector);
    expect((await status(off)).body).toEqual({ voice: 'unavailable' });
    await off.close();

    const server = await setup({ RA_TEST_ACCESS_CODE: CODE }, connector);
    expect((await status(server)).body).toEqual({ voice: 'code_required' });
    expect((await status(server, '?code=nope')).body).toEqual({ voice: 'code_invalid' });
    const ok = await status(server, `?code=${CODE}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ voice: 'ok' });
    expect(ok.res.headers['cache-control']).toBe('no-store');
    expect(sessions).toHaveLength(0);
  });

  it('needs no code when none is set', async () => {
    const { connector } = fakeConnector();
    const server = await setup({}, connector);
    expect((await status(server)).body).toEqual({ voice: 'ok' });
  });

  it('is rate-limited per address, apart from the sessions', async () => {
    const { connector } = fakeConnector();
    const server = await setup({ RA_TEST_ACCESS_CODE: CODE }, connector);
    for (let i = 0; i < STATUS_RATE_LIMIT_PER_MINUTE; i++) {
      expect((await status(server, '?code=nope')).status).toBe(200);
    }
    const limited = await status(server, `?code=${CODE}`);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'rate_limited' });
  });
});

describe('the Gemini session', () => {
  it('opens with audio out, the character voice, the prompt, transcriptions and no automatic detection', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({ GEMINI_LIVE_MODEL: 'some-live-model' }, connector);
    await open(server, '?lang=pt');
    const { request } = sessions[0]!;
    expect(request.model).toBe('some-live-model');
    expect(request.config).toMatchObject({
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    });
    expect(String(request.config.systemInstruction)).toContain('## O que veio depois');
  });

  it('talks as the character asked for, with his own voice and sheet', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    await open(server, '?lang=es&character=soldado_almoravide');
    const { request } = sessions[0]!;
    expect(request.config.speechConfig).toEqual({
      voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_VOICES.soldado_almoravide } },
    });
    const prompt = String(request.config.systemInstruction);
    expect(prompt).toMatch(/^Eres un guerrero almorávide/);
    expect(prompt).toContain('## Lo que vino después');
    expect(prompt).not.toContain('artesano del siglo XIV');
  });

  it('refuses a character it does not know', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    const client = await connect(server, '?lang=es&character=pirata');
    await until(() => client.closed() !== undefined);
    expect(client.json()).toEqual([{ type: 'error', code: 'internal' }]);
    expect(sessions).toHaveLength(0);
  });

  it('relays the visitor to Gemini: activityStart, audio as base64 PCM 16 kHz, activityEnd, text', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    const client = await open(server);
    const session = sessions[0]!;
    const frame = Buffer.from([1, 2, 3, 4]);

    client.ws.send(frame); // Not talking yet: dropped.
    client.ws.send(JSON.stringify({ type: 'audio_start' }));
    client.ws.send(frame);
    client.ws.send(JSON.stringify({ type: 'audio_end' }));
    client.ws.send(JSON.stringify({ type: 'text', text: '  Quem és tu?  ' }));
    await until(() => session.content.length === 1);

    expect(session.realtime).toEqual([
      { activityStart: {} },
      { audio: { data: frame.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
      { activityEnd: {} },
    ]);
    expect(session.content).toEqual([
      { turns: [{ role: 'user', parts: [{ text: 'Quem és tu?' }] }], turnComplete: true },
    ]);
  });

  it('relays Gemini to the visitor: audio as binary frames, transcripts, interrupted, turn_complete', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    const client = await open(server);
    const pcm = Buffer.from([9, 8, 7, 6]);

    sessions[0]!.emit({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
        inputTranscription: { text: 'hola', finished: true },
        outputTranscription: { text: 'Bom dia', finished: false },
      },
    });
    sessions[0]!.emit({ serverContent: { interrupted: true } });
    sessions[0]!.emit({ serverContent: { turnComplete: true } });
    await until(() => client.json().some((m) => m.type === 'turn_complete'));

    expect(client.binary()).toEqual([pcm]);
    expect(client.json()).toEqual([
      { type: 'ready' },
      { type: 'transcript', role: 'user', text: 'hola', final: true },
      { type: 'transcript', role: 'model', text: 'Bom dia', final: false },
      { type: 'interrupted' },
      { type: 'turn_complete' },
    ]);
  });

  it('ends the session after the time limit, closing Gemini', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({ RA_TEST_SESSION_SECONDS: '1' }, connector);
    const client = await open(server);
    await until(() => client.closed() !== undefined);
    expect(client.json().at(-1)).toEqual({ type: 'ended', reason: 'time_limit' });
    expect(sessions[0]!.closed).toBe(true);
  });

  it('closes Gemini when the client closes, and the client when Gemini closes', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    const first = await open(server);
    first.ws.close();
    await until(() => sessions[0]!.closed);

    const second = await open(server);
    sessions[1]!.callbacks.onclose();
    await until(() => second.closed() !== undefined);
    expect(second.json().at(-1)).toEqual({ type: 'ended', reason: 'server' });
  });

  it('answers internal and nothing of the provider when Gemini fails', async () => {
    const failing = await setup({}, fakeConnector({ fail: true }).connector);
    const client = await connect(failing);
    await until(() => client.closed() !== undefined);
    expect(client.json()).toEqual([{ type: 'error', code: 'internal' }]);
    expect(JSON.stringify(client.received)).not.toContain('secret');
  });

  it('ends the session when a frame is too large', async () => {
    const { connector, sessions } = fakeConnector();
    const server = await setup({}, connector);
    const client = await open(server);
    client.ws.send(JSON.stringify({ type: 'audio_start' }));
    client.ws.send(Buffer.alloc(64 * 1024 + 1));
    await until(() => client.closed() !== undefined);
    expect(client.closed()).toBe(1009);
    expect(sessions[0]!.closed).toBe(true);
  });
});

describe('the settings', () => {
  it('are off and bounded by default', () => {
    expect(loadConfig({})).toMatchObject({
      geminiApiKey: null,
      geminiLiveModel: 'gemini-3.8-live',
      raTestAccessCode: null,
      raTestSessionSeconds: 180,
      raTestMaxSessions: 3,
      raTestRateLimitPerMinute: 5,
      raTestVoiceArtesano: null,
    });
  });

  it('read the environment; empty values and bad numbers fall back', () => {
    expect(
      loadConfig({
        GEMINI_API_KEY: ` ${KEY} `,
        GEMINI_LIVE_MODEL: 'm',
        RA_TEST_ACCESS_CODE: CODE,
        RA_TEST_SESSION_SECONDS: '60',
        RA_TEST_MAX_SESSIONS: '0',
        RA_TEST_RATE_LIMIT_PER_MINUTE: 'x',
        RA_TEST_VOICE_ARTESANO: 'Orus',
      }),
    ).toMatchObject({
      geminiApiKey: KEY,
      geminiLiveModel: 'm',
      raTestAccessCode: CODE,
      raTestSessionSeconds: 60,
      raTestMaxSessions: 3,
      raTestRateLimitPerMinute: 5,
      raTestVoiceArtesano: 'Orus',
    });
    expect(loadConfig({ GEMINI_API_KEY: '', GEMINI_LIVE_MODEL: '' })).toMatchObject({
      geminiApiKey: null,
      geminiLiveModel: 'gemini-3.8-live',
    });
  });
});

describe('the craftsman', () => {
  const craftsman = createCharacters().get('artesano')!;

  it('has a male voice, configurable', () => {
    expect(craftsman.voiceName).toBe('Charon');
    expect(createCharacters({ artesanoVoice: 'Orus' }).get('artesano')!.voiceName).toBe('Orus');
  });

  it('has a knowledge sheet in each language, with the later times apart', async () => {
    const facts = await loadKnowledge(KNOWLEDGE);
    // The prompts point at these headings by name.
    expect(facts.es).toContain('## Lo que vino después');
    expect(facts.en).toContain('## What came later');
    expect(facts.pt).toContain('## O que veio depois');
    for (const text of Object.values(facts)) expect(text.length).toBeGreaterThan(1500);
  });

  it('reads the sheet per language and leaves a missing one empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rumbo-knowledge-'));
    try {
      await writeFile(join(dir, 'es.md'), '  El castillo es antiguo.\n');
      await writeFile(join(dir, 'en.md'), 'The castle is old.');
      const facts = await loadKnowledge(pathToFileURL(`${dir}/`));
      expect(facts).toEqual({ es: 'El castillo es antiguo.', en: 'The castle is old.', pt: '' });
      expect(systemInstruction(craftsman, 'pt', facts)).toContain('Não tens informação');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds the prompt with the context and the rules in the language asked', () => {
    const facts = {
      es: 'Hecho en español.',
      en: 'A fact in English.',
      pt: 'Um facto em português.',
    };
    const es = systemInstruction(craftsman, 'es', facts);
    const en = systemInstruction(craftsman, 'en', facts);
    const pt = systemInstruction(craftsman, 'pt', facts);
    expect(es).toContain('Hecho en español.');
    expect(es).not.toContain('A fact in English.');
    expect(en).toContain('A fact in English.');
    expect(pt).toContain('Um facto em português.');
    expect(es).toMatch(/siglo XIV/);
    expect(es).toMatch(/SOLO con lo que dice el contexto/);
    expect(es).toMatch(/No inventes nunca fechas/);
    expect(es).toContain('«Lo que vino después»');
    expect(en).toMatch(/14th-century/);
    expect(en).toMatch(/one to three sentences/);
    expect(en).toMatch(/Answer ONLY from the context/);
    expect(en).toMatch(/Never invent dates, names/);
    expect(en).toContain('"What came later"');
    expect(pt).toMatch(/século XIV/);
    expect(pt).toMatch(/SÓ com o que diz o contexto/);
    expect(pt).toContain('«O que veio depois»');
  });

  it('loads a sheet for every character', async () => {
    const knowledge = await loadAllKnowledge(new URL('../../../data/ra/', import.meta.url));
    expect([...knowledge.keys()]).toEqual([...CHARACTER_IDS]);
    for (const [id, facts] of knowledge) {
      for (const lang of ['es', 'en', 'pt'] as const) {
        expect(facts[lang].length, `${id} ${lang}`).toBeGreaterThan(1500);
      }
      expect(facts.es, id).toContain('## Lo que vino después');
      expect(facts.en, id).toContain('## What came later');
      expect(facts.pt, id).toContain('## O que veio depois');
    }
  });

  it('gives each one his own voice and persona, with the same rules', () => {
    const characters = createCharacters();
    expect(new Set(CHARACTER_IDS.map((id) => characters.get(id)!.voiceName)).size).toBe(
      CHARACTER_IDS.length,
    );
    const king = systemInstruction(characters.get('afonso_henriques')!, 'pt', {
      es: '',
      en: '',
      pt: 'Facto.',
    });
    expect(king).toMatch(/^És D\. Afonso Henriques, o primeiro rei de Portugal/);
    const facts = { es: 'Hecho.', en: 'Fact.', pt: 'Facto.' };
    const soldier = systemInstruction(characters.get('soldado_portugues')!, 'es', facts);
    expect(soldier).toMatch(/^Eres un soldado de la guarnición del castillo de Leiria/);
    expect(soldier).toContain('Paio Guterres');
    expect(soldier).toMatch(/SOLO con lo que dice el contexto/);
    expect(soldier).toContain('«Lo que vino después»');
    expect(soldier.endsWith('Contexto:\nHecho.')).toBe(true);
    const warrior = systemInstruction(characters.get('soldado_almoravide')!, 'en', facts);
    expect(warrior).toMatch(/^You are an Almoravid warrior/);
    expect(warrior).toMatch(/Answer ONLY from the context/);
  });

  it("always speaks the page's language, whatever the visitor speaks", () => {
    const craftsman = createCharacters().get('artesano')!;
    const facts = { es: '', en: '', pt: '' };
    expect(systemInstruction(craftsman, 'es', facts)).toContain('Habla siempre en español');
    expect(systemInstruction(craftsman, 'en', facts)).toContain('Always speak English');
    expect(systemInstruction(craftsman, 'pt', facts)).toContain('português de Portugal');
  });

  it('says it has no information when there is no sheet', () => {
    expect(systemInstruction(craftsman, 'en', { es: '', en: '', pt: '' })).toContain(
      'no information',
    );
  });
});
