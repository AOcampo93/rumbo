import { timingSafeEqual } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import { Modality, type LiveServerMessage } from '@google/genai';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { clientAddress } from '../limits.js';
import {
  type Character,
  LANGS,
  type Lang,
  type LocalizedFacts,
  systemInstruction,
} from '../ra-test/characters.js';
import type { LiveConnector, LiveSessionHandle } from '../ra-test/live.js';

// AR prototype, voice (PROJECT_PLAN: the character that answers by voice). The
// web page holds a WebSocket to this endpoint; the server holds a Gemini Live
// session per visitor and relays audio both ways. The Gemini key never leaves
// the server. Push-to-talk: the client marks the turn (audio_start/audio_end),
// so Gemini's own voice detection is off.
//
// Client -> server: JSON {type:'audio_start'}, binary PCM16 LE mono 16 kHz
// while the button is held, {type:'audio_end'}; or {type:'text', text}.
// Server -> client: binary PCM16 LE mono 24 kHz, and JSON {type:'ready'},
// {type:'transcript',role,text,final}, {type:'turn_complete'},
// {type:'interrupted'}, {type:'error',code}, {type:'ended',reason}.
//
// Nothing the visitor says or hears is logged: only when a session starts and
// ends, how long it lasted and the token counts Gemini reports.

export interface RaTestOptions {
  config: AppConfig;
  /** Null: the feature is off (voice_unavailable). */
  connector: LiveConnector | null;
  characters: ReadonlyMap<string, Character>;
  facts: LocalizedFacts;
  /** Also accept http://localhost and http://127.0.0.1 as the page's origin (development). */
  allowLocalOrigins: boolean;
}

/** The largest binary frame a client may send (1 s of PCM16 16 kHz is 32 KB). */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Most characters of a typed question. */
export const MAX_TEXT_CHARS = 500;
/** Unsent bytes at the client after which it is too slow and the session ends. */
export const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
/** PCM16 16 kHz mono: bytes of audio per second of talking. */
const AUDIO_BYTES_PER_SECOND = 32_000;
const INPUT_MIME = 'audio/pcm;rate=16000';

const QuerySchema = z.object({
  lang: z.enum(LANGS).catch('es').default('es'),
  character: z.string().default('artesano'),
  code: z.string().optional(),
});

type ErrorCode =
  'voice_unavailable' | 'access_code_required' | 'rate_limited' | 'session_limit' | 'internal';
type EndReason = 'time_limit' | 'server';

const CLIENT_MESSAGE = z.discriminatedUnion('type', [
  z.object({ type: z.literal('audio_start') }),
  z.object({ type: z.literal('audio_end') }),
  z.object({ type: z.literal('text'), text: z.string() }),
]);

function sameSecret(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

interface Usage {
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
}

export const raTestRoutes: FastifyPluginAsync<RaTestOptions> = async (app, options) => {
  const { config } = options;
  const connectionLimit = app.createRateLimit({
    max: config.raTestRateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: clientAddress,
  });
  let active = 0;
  const maxAudioBytes = config.raTestSessionSeconds * AUDIO_BYTES_PER_SECOND * 2;

  /** Only the site's own page may open a session: a browser always sends Origin. */
  const originAllowed = (request: FastifyRequest): boolean => {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    return (
      origin === config.publicOrigin || (options.allowLocalOrigins && LOCAL_ORIGIN.test(origin))
    );
  };

  app.get(
    '/v1/ra-test/voice',
    {
      websocket: true,
      onRequest: async (request, reply) => {
        if (request.ws && !originAllowed(request))
          return reply.code(403).send({ code: 'forbidden' });
      },
    },
    (socket, request) => {
      const refuse = (code: ErrorCode) => {
        socket.send(JSON.stringify({ type: 'error', code }), () => socket.close(1000));
      };
      const query = QuerySchema.parse(request.query ?? {});
      const lang: Lang = query.lang;
      const character = options.characters.get(query.character);

      if (!config.geminiApiKey || !options.connector) return refuse('voice_unavailable');
      // The limit counts every try, also the wrong codes, so the code can't be guessed freely.
      void (async () => {
        const rate = await connectionLimit(request);
        if (!rate.isAllowed && rate.isExceeded) return refuse('rate_limited');
        if (config.raTestAccessCode && !sameSecret(query.code, config.raTestAccessCode)) {
          return refuse('access_code_required');
        }
        if (!character) return refuse('internal');
        if (active >= config.raTestMaxSessions) return refuse('session_limit');
        run(socket, request, options.connector as LiveConnector, character, lang);
      })().catch(() => refuse('internal'));
    },
  );

  function run(
    socket: WebSocket,
    request: FastifyRequest,
    connector: LiveConnector,
    character: Character,
    lang: Lang,
  ): void {
    active += 1;
    const startedAt = Date.now();
    const usage: Usage = {};
    let gemini: LiveSessionHandle | null = null;
    let ready = false;
    let over = false;
    let talking = false;
    let audioBytes = 0;
    let timer: NodeJS.Timeout | null = null;

    const send = (message: object) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    /** Ends the session once: tells the client why, closes both sides, logs the outcome. */
    const finish = (outcome: { reason: EndReason } | { error: ErrorCode }, socketCode = 1000) => {
      if (over) return;
      over = true;
      active -= 1;
      if (timer) clearTimeout(timer);
      try {
        gemini?.close();
      } catch {
        // Already closed.
      }
      if ('reason' in outcome) send({ type: 'ended', reason: outcome.reason });
      else send({ type: 'error', code: outcome.error });
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
        socket.close(socketCode);
      }
      request.log.info(
        {
          character: character.id,
          lang,
          durationMs: Date.now() - startedAt,
          end: 'reason' in outcome ? outcome.reason : outcome.error,
          ...usage,
        },
        'voice session ended',
      );
    };

    request.log.info({ character: character.id, lang }, 'voice session started');
    timer = setTimeout(() => finish({ reason: 'time_limit' }), config.raTestSessionSeconds * 1000);
    timer.unref();

    const onGemini = (message: LiveServerMessage) => {
      if (over) return;
      const meta = message.usageMetadata;
      if (meta) {
        if (meta.promptTokenCount !== undefined) usage.promptTokens = meta.promptTokenCount;
        if (meta.responseTokenCount !== undefined) usage.responseTokens = meta.responseTokenCount;
        if (meta.totalTokenCount !== undefined) usage.totalTokens = meta.totalTokenCount;
      }
      if (message.goAway) return finish({ reason: 'server' });
      const content = message.serverContent;
      if (!content) return;
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && (part.inlineData.mimeType ?? '').startsWith('audio/')) {
          socket.send(Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return finish({ reason: 'server' });
      const spoken = content.inputTranscription;
      if (spoken?.text) {
        send({
          type: 'transcript',
          role: 'user',
          text: spoken.text,
          final: spoken.finished === true,
        });
      }
      const said = content.outputTranscription;
      if (said?.text) {
        send({ type: 'transcript', role: 'model', text: said.text, final: said.finished === true });
      }
      if (content.interrupted) send({ type: 'interrupted' });
      if (content.turnComplete) send({ type: 'turn_complete' });
    };

    socket.on('message', (data, isBinary) => {
      if (over || !ready || !gemini) return;
      try {
        if (isBinary) {
          const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
          if (frame.length > MAX_FRAME_BYTES) return finish({ reason: 'server' }, 1009);
          if (!talking) return;
          audioBytes += frame.length;
          if (audioBytes > maxAudioBytes) return finish({ reason: 'server' }, 1009);
          gemini.sendRealtimeInput({
            audio: { data: frame.toString('base64'), mimeType: INPUT_MIME },
          });
          return;
        }
        const parsed = CLIENT_MESSAGE.safeParse(JSON.parse(data.toString()));
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'audio_start' && !talking) {
          talking = true;
          gemini.sendRealtimeInput({ activityStart: {} });
        } else if (message.type === 'audio_end' && talking) {
          talking = false;
          gemini.sendRealtimeInput({ activityEnd: {} });
        } else if (message.type === 'text') {
          const text = message.text.trim().slice(0, MAX_TEXT_CHARS);
          if (!text) return;
          gemini.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          });
        }
      } catch {
        // Not JSON, or Gemini refused the write: the next message or the close handles it.
      }
    });
    socket.on('close', () => finish({ reason: 'server' }));
    socket.on('error', () => finish({ reason: 'server' }));

    connector
      .connect(
        {
          model: config.geminiLiveModel,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: character.voiceName } },
            },
            systemInstruction: systemInstruction(character, lang, options.facts),
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          },
        },
        {
          onmessage: onGemini,
          // Provider errors are never forwarded: the client only learns "internal".
          onerror: () => finish({ error: 'internal' }, 1011),
          onclose: () => finish({ reason: 'server' }),
        },
      )
      .then((handle) => {
        if (over) {
          handle.close();
          return;
        }
        gemini = handle;
        ready = true;
        send({ type: 'ready' });
      })
      .catch(() => finish({ error: 'internal' }, 1011));
  }
};
