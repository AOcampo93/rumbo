import { describe, expect, it } from 'vitest';
import {
  buildVoiceUrl,
  describeVoiceError,
  TranscriptBuffer,
  VoiceClient,
  type SocketLike,
  type VoiceEvent,
} from '../src/ar/voice.ts';

class FakeSocket implements SocketLike {
  binaryType = '';
  readyState = 1;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: (string | ArrayBufferLike)[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(d: string | ArrayBufferLike) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  json(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function setup(code?: string) {
  const sockets: FakeSocket[] = [];
  const events: VoiceEvent[] = [];
  const sink = {
    chunks: [] as ArrayBuffer[],
    interrupts: 0,
    enqueue(c: ArrayBuffer) {
      this.chunks.push(c);
    },
    interrupt() {
      this.interrupts++;
    },
  };
  const client = new VoiceClient({
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    sink,
    onEvent: (e) => events.push(e),
    location: { protocol: 'https:', host: 'rumbo.test' },
    getCode: () => code,
  });
  return { client, sockets, events, sink };
}

describe('buildVoiceUrl', () => {
  it('uses wss on https and ws on http, with the access code when given', () => {
    expect(buildVoiceUrl({ protocol: 'https:', host: 'a.b' })).toBe(
      'wss://a.b/api/v1/ra-test/voice?lang=es&character=artesano',
    );
    expect(buildVoiceUrl({ protocol: 'http:', host: 'localhost:5173' }, { code: 'x y' })).toBe(
      'ws://localhost:5173/api/v1/ra-test/voice?lang=es&character=artesano&code=x+y',
    );
  });

  it('says which scene the character is in', () => {
    expect(
      buildVoiceUrl(
        { protocol: 'https:', host: 'a.b' },
        { lang: 'pt', character: 'soldado_portugues', scene: 'puerta_traicion' },
      ),
    ).toBe(
      'wss://a.b/api/v1/ra-test/voice?lang=pt&character=soldado_portugues&scene=puerta_traicion',
    );
  });
});

describe('VoiceClient', () => {
  it('connects, resolves on ready and sends the code', async () => {
    const { client, sockets } = setup('abc');
    const connecting = client.connect();
    expect(sockets[0]!.url).toContain('code=abc');
    expect(sockets[0]!.binaryType).toBe('arraybuffer');
    sockets[0]!.json({ type: 'ready' });
    await connecting;
    expect(client.connected).toBe(true);
  });

  it('sends audio only between audio_start and audio_end', async () => {
    const { client, sockets } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    const frame = new ArrayBuffer(3200);
    client.sendAudio(frame);
    client.startTalk();
    client.sendAudio(frame);
    client.endTalk();
    client.sendAudio(frame);
    expect(sockets[0]!.sent).toEqual(['{"type":"audio_start"}', frame, '{"type":"audio_end"}']);
  });

  it('sends typed text', async () => {
    const { client, sockets } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    client.sendText('¿Qué es el castillo?');
    expect(JSON.parse(sockets[0]!.sent[0] as string)).toEqual({
      type: 'text',
      text: '¿Qué es el castillo?',
    });
  });

  it('hands binary audio to the player and interrupts it on `interrupted`', async () => {
    const { client, sockets, sink, events } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    const audio = new ArrayBuffer(480);
    sockets[0]!.onmessage?.({ data: audio });
    expect(sink.chunks).toEqual([audio]);
    sockets[0]!.json({ type: 'interrupted' });
    expect(sink.interrupts).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['ready', 'interrupted']);
  });

  it('forwards transcripts, turn_complete and ended; ignores junk', async () => {
    const { client, sockets, events } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    sockets[0]!.json({ type: 'transcript', role: 'model', text: 'Hola', final: false });
    sockets[0]!.json({ type: 'transcript', role: 'robot', text: 'x' });
    sockets[0]!.onmessage?.({ data: 'not json' });
    sockets[0]!.json({ type: 'turn_complete' });
    sockets[0]!.json({ type: 'ended', reason: 'time_limit' });
    sockets[0]!.onclose?.({});
    expect(events).toEqual([
      { type: 'ready' },
      { type: 'transcript', role: 'model', text: 'Hola', final: false },
      { type: 'turn_complete' },
      { type: 'ended', reason: 'time_limit' },
    ]);
  });

  it('rejects connect() and reports server errors', async () => {
    const { client, sockets, events } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'error', code: 'access_code_required' });
    await expect(p).rejects.toThrow('access_code_required');
    expect(events).toEqual([{ type: 'error', code: 'access_code_required' }]);
    expect(client.connected).toBe(false);
  });

  it('maps an unknown error code to internal', async () => {
    const { client, sockets, events } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'error', code: 'weird' });
    await p.catch(() => undefined);
    expect(events[0]).toEqual({ type: 'error', code: 'internal' });
  });

  it('reports connection_lost when the socket drops, once', async () => {
    const { client, sockets, events } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    sockets[0]!.readyState = 3;
    sockets[0]!.onclose?.({});
    sockets[0]!.onerror?.({});
    expect(events.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', code: 'connection_lost' },
    ]);
  });

  it('reconnects on demand with a fresh socket and drops the old one', async () => {
    const { client, sockets } = setup();
    const p = client.connect();
    sockets[0]!.json({ type: 'ready' });
    await p;
    const p2 = client.connect();
    expect(sockets[0]!.closed).toBe(true);
    sockets[1]!.json({ type: 'ready' });
    await p2;
    expect(client.connected).toBe(true);
  });
});

describe('describeVoiceError', () => {
  it('has a message for every code', () => {
    for (const code of [
      'voice_unavailable',
      'access_code_required',
      'rate_limited',
      'session_limit',
      'internal',
      'connection_lost',
      'mic_denied',
      'mic_unavailable',
    ] as const) {
      expect(describeVoiceError(code).length).toBeGreaterThan(10);
    }
  });
});

describe('TranscriptBuffer', () => {
  it('appends fragments and starts over after a final one', () => {
    const t = new TranscriptBuffer();
    expect(t.push('Hola ', false)).toBe('Hola ');
    expect(t.push('mundo', false)).toBe('Hola mundo');
    expect(t.push('.', true)).toBe('Hola mundo.');
    expect(t.push('Otra', false)).toBe('Otra');
  });

  it('lets a complete final text replace the fragments', () => {
    const t = new TranscriptBuffer();
    t.push('Hol', false);
    expect(t.push('Hola mundo', true)).toBe('Hola mundo');
  });

  it('starts over after reset()', () => {
    const t = new TranscriptBuffer();
    t.push('uno', false);
    t.reset();
    expect(t.push('dos', false)).toBe('dos');
  });
});
