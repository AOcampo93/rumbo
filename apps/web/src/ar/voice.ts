// Client of the voice backend (WebSocket, /api/v1/ra-test/voice) and the microphone capture.
// The socket and the player are injected, so the message handling is testable without a browser.

export const WORKLET_URL = '/ra_test/pcm-capture-worklet.js';

export type ServerErrorCode =
  'voice_unavailable' | 'access_code_required' | 'rate_limited' | 'session_limit' | 'internal';
export type VoiceErrorCode = ServerErrorCode | 'connection_lost' | 'mic_denied' | 'mic_unavailable';

export type VoiceEvent =
  | { type: 'ready' }
  | { type: 'transcript'; role: 'user' | 'model'; text: string; final: boolean }
  | { type: 'turn_complete' }
  | { type: 'interrupted' }
  | { type: 'ended'; reason: string }
  | { type: 'error'; code: VoiceErrorCode };

export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBufferLike): void;
  close(): void;
}

export interface AudioSink {
  enqueue(chunk: ArrayBuffer): void;
  interrupt(): void;
}

const OPEN = 1;

export function buildVoiceUrl(
  location: { protocol: string; host: string },
  options: { lang?: string; character?: string; code?: string } = {},
): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({
    lang: options.lang ?? 'es',
    character: options.character ?? 'artesano',
  });
  if (options.code) params.set('code', options.code);
  return `${scheme}://${location.host}/api/v1/ra-test/voice?${params.toString()}`;
}

type ErrorLang = 'es' | 'en' | 'pt';

const ERROR_TEXT: Record<ErrorLang, Record<VoiceErrorCode, string>> = {
  es: {
    voice_unavailable: 'La voz no está disponible ahora mismo. Inténtalo más tarde.',
    access_code_required: 'Hace falta un código de acceso para hablar con el guía.',
    rate_limited: 'Demasiadas peticiones seguidas. Espera un momento.',
    session_limit: 'Hay demasiadas conversaciones abiertas. Inténtalo en unos minutos.',
    connection_lost: 'Se perdió la conexión. Pulsa de nuevo para reconectar.',
    mic_denied: 'No hay permiso para usar el micrófono. Actívalo en los ajustes del navegador.',
    mic_unavailable: 'No se pudo abrir el micrófono en este dispositivo.',
    internal: 'Algo ha fallado en el servidor. Inténtalo de nuevo.',
  },
  en: {
    voice_unavailable: 'The voice isn’t available right now. Try again later.',
    access_code_required: 'You need an access code to talk to the guide.',
    rate_limited: 'Too many requests in a row. Wait a moment.',
    session_limit: 'Too many conversations are open. Try again in a few minutes.',
    connection_lost: 'The connection was lost. Press again to reconnect.',
    mic_denied: 'There’s no permission to use the microphone. Allow it in the browser settings.',
    mic_unavailable: 'Couldn’t open the microphone on this device.',
    internal: 'Something went wrong on the server. Try again.',
  },
  pt: {
    voice_unavailable: 'A voz não está disponível agora. Tenta mais tarde.',
    access_code_required: 'Precisas de um código de acesso para falar com o guia.',
    rate_limited: 'Demasiados pedidos seguidos. Espera um momento.',
    session_limit: 'Há demasiadas conversas abertas. Tenta daqui a uns minutos.',
    connection_lost: 'A ligação perdeu-se. Prime de novo para voltar a ligar.',
    mic_denied: 'Não há permissão para usar o microfone. Ativa-a nas definições do navegador.',
    mic_unavailable: 'Não foi possível abrir o microfone neste dispositivo.',
    internal: 'Algo falhou no servidor. Tenta de novo.',
  },
};

/** User-facing text for each error, in the page language (Spanish by default). */
export function describeVoiceError(code: VoiceErrorCode, lang: ErrorLang = 'es'): string {
  return ERROR_TEXT[lang][code];
}

/** What GET /api/v1/ra-test/status says about the voice (it opens no session). */
export type VoiceStatus = 'ok' | 'unavailable' | 'code_required' | 'code_invalid';

/** Asks the API whether the voice is on and the code is right; 'unknown' on any failure. */
export async function fetchVoiceStatus(
  fetchFn: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  code: string | undefined,
): Promise<VoiceStatus | 'unknown'> {
  try {
    const query = code ? `?code=${encodeURIComponent(code)}` : '';
    const res = await fetchFn(`/api/v1/ra-test/status${query}`);
    if (!res.ok) return 'unknown';
    const voice = ((await res.json()) as { voice?: unknown }).voice;
    return voice === 'ok' ||
      voice === 'unavailable' ||
      voice === 'code_required' ||
      voice === 'code_invalid'
      ? voice
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

const SERVER_CODES: readonly string[] = [
  'voice_unavailable',
  'access_code_required',
  'rate_limited',
  'session_limit',
  'internal',
];

export class VoiceClient {
  private socket: SocketLike | null = null;
  private talking = false;
  private finished = false;

  constructor(
    private readonly options: {
      createSocket: (url: string) => SocketLike;
      sink: AudioSink;
      onEvent: (event: VoiceEvent) => void;
      location?: { protocol: string; host: string };
      lang?: string;
      /** Read on every connect, so the language can change between sessions. */
      getLang?: () => string;
      character?: string;
      getCode?: () => string | undefined;
    },
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === OPEN && !this.finished;
  }

  /** Opens the session; resolves when the server says `ready`, rejects with the error code. */
  connect(): Promise<void> {
    this.close();
    this.finished = false;
    const loc = this.options.location ?? { protocol: 'http:', host: 'localhost' };
    const url = buildVoiceUrl(loc, {
      lang: this.options.getLang?.() ?? this.options.lang,
      character: this.options.character,
      code: this.options.getCode?.(),
    });
    const socket = this.options.createSocket(url);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      const fail = (code: VoiceErrorCode) => {
        if (this.socket !== socket || this.finished) return;
        this.finished = true;
        this.talking = false;
        this.options.onEvent({ type: 'error', code });
        if (!ready) reject(new Error(code));
      };
      socket.onerror = () => fail('connection_lost');
      socket.onclose = () => {
        if (this.socket !== socket) return;
        if (!this.finished) fail('connection_lost');
        this.talking = false;
      };
      socket.onmessage = (ev) => {
        if (this.socket !== socket) return;
        const data = ev.data;
        if (typeof data === 'string') {
          const msg = parseMessage(data);
          if (!msg) return;
          if (msg.type === 'ready') {
            ready = true;
            resolve();
          }
          if (msg.type === 'error') {
            fail(msg.code);
            return;
          }
          if (msg.type === 'ended') this.finished = true;
          if (msg.type === 'interrupted') this.options.sink.interrupt();
          this.options.onEvent(msg);
        } else if (data instanceof ArrayBuffer) {
          this.options.sink.enqueue(data);
        }
      };
    });
  }

  /** The talk button went down: tells the server a user turn starts. */
  startTalk(): void {
    if (!this.connected || this.talking) return;
    this.talking = true;
    this.sendJson({ type: 'audio_start' });
  }

  /** One PCM16 16 kHz frame from the microphone; ignored unless the button is held. */
  sendAudio(frame: ArrayBuffer): void {
    if (this.talking && this.connected) this.socket?.send(frame);
  }

  endTalk(): void {
    if (!this.talking) return;
    this.talking = false;
    if (this.connected) this.sendJson({ type: 'audio_end' });
  }

  sendText(text: string): void {
    if (this.connected) this.sendJson({ type: 'text', text });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.talking = false;
    if (socket) {
      socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  private sendJson(value: unknown): void {
    this.socket?.send(JSON.stringify(value));
  }
}

function parseMessage(text: string): VoiceEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'turn_complete':
    case 'interrupted':
      return { type: m.type };
    case 'transcript':
      if ((m.role === 'user' || m.role === 'model') && typeof m.text === 'string') {
        return { type: 'transcript', role: m.role, text: m.text, final: m.final === true };
      }
      return null;
    case 'error':
      return {
        type: 'error',
        code: SERVER_CODES.includes(String(m.code)) ? (m.code as ServerErrorCode) : 'internal',
      };
    case 'ended':
      return { type: 'ended', reason: typeof m.reason === 'string' ? m.reason : 'server' };
    default:
      return null;
  }
}

/** Microphone -> AudioWorklet -> 16 kHz PCM16 frames of ~100 ms. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;

  get active(): boolean {
    return this.stream !== null;
  }

  /** Call from a user gesture. Throws a VoiceErrorCode-like Error('mic_denied' | 'mic_unavailable'). */
  async start(onFrame: (frame: ArrayBuffer) => void): Promise<void> {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      throw new Error(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_unavailable',
        { cause: error },
      );
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(WORKLET_URL);
      if (ctx.state !== 'running') await ctx.resume();
      const source = ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfOutputs: 0 });
      node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => onFrame(ev.data);
      source.connect(node);
    } catch {
      this.stop();
      throw new Error('mic_unavailable');
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/**
 * Builds the subtitle of one speaker's turn from transcript fragments. Fragments are
 * normally increments; a final message that already holds the whole text replaces them.
 */
export class TranscriptBuffer {
  private text = '';
  private closed = true;

  push(fragment: string, final: boolean): string {
    if (this.closed) {
      this.text = '';
      this.closed = false;
    }
    if (final && fragment.length >= this.text.length && fragment.trim()) this.text = fragment;
    else this.text += fragment;
    if (final) this.closed = true;
    return this.text;
  }

  /** The next fragment starts a new turn. */
  reset(): void {
    this.closed = true;
  }
}
