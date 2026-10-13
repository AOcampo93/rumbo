import { CharacterAnimator, levelToMouthOpen, loadCharacter } from '../ar/character.ts';
import { generateSpeechLikePcm16 } from '../ar/pcm.ts';
import { PcmPlayer, type AudioContextLike } from '../ar/playback.ts';
import {
  describeVoiceError,
  MicCapture,
  TranscriptBuffer,
  type SocketLike,
  VoiceClient,
  type VoiceErrorCode,
  type VoiceEvent,
} from '../ar/voice.ts';
import { isArSupported, Stage } from '../ar/xr.ts';

// AR lab (/ra_test/): the 3D tour-guide character in WebXR, or in a plain 3D view, with an
// optional voice chat. Plain TypeScript + DOM on purpose (no Vue) to keep the page light.

const MODEL_URL = '/ra_test/models/artesano.glb';
const CODE_KEY = 'ra_test_access_code';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const els = {
  canvas: $<HTMLCanvasElement>('stage'),
  overlay: $('overlay'),
  top: $('top'),
  bottom: $('bottom'),
  status: $('status'),
  statusIcon: $('statusIcon'),
  statusText: $('statusText'),
  arGuide: $('arGuide'),
  debug: $('debug'),
  captions: $('captions'),
  subtitles: $('subtitles'),
  userText: $('userText'),
  ar: $<HTMLButtonElement>('ar'),
  appclip: $<HTMLAnchorElement>('appclip'),
  exitAr: $<HTMLButtonElement>('exitAr'),
  advanced: $<HTMLDetailsElement>('advanced'),
  arHint: $('arHint'),
  demo: $<HTMLButtonElement>('demo'),
  debugToggle: $<HTMLButtonElement>('debugToggle'),
  codeRow: $<HTMLFormElement>('codeRow'),
  code: $<HTMLInputElement>('code'),
  talk: $<HTMLButtonElement>('talk'),
  talkLabel: $('talkLabel'),
  textForm: $<HTMLFormElement>('textForm'),
  text: $<HTMLInputElement>('text'),
};

const storage = {
  get: (): string => {
    try {
      return sessionStorage.getItem(CODE_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (value: string): void => {
    try {
      sessionStorage.setItem(CODE_KEY, value);
    } catch {
      // Private mode: the code just isn't remembered.
    }
  },
};

// A shared link may carry the access code and the language (?code=…&lang=en). The code is
// remembered for the session and taken out of the address bar.
const linkParams = new URLSearchParams(location.search);
const LANGS = ['es', 'en', 'pt'] as const;
const linkLang = linkParams.get('lang');
const lang = (LANGS as readonly string[]).includes(linkLang ?? '') ? (linkLang as string) : 'es';
const linkCode = linkParams.get('code')?.trim();
if (linkCode) {
  storage.set(linkCode);
  linkParams.delete('code');
  const query = linkParams.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

/** The App Clip opens this page in its own browser: hand it the code and the language too. */
function refreshAppClipLink(): void {
  const target = new URL(location.pathname, location.origin);
  if (lang !== 'es') target.searchParams.set('lang', lang);
  const code = storage.get();
  if (code) target.searchParams.set('code', code);
  els.appclip.href = `https://appclip.needle.tools/ar?url=${encodeURIComponent(target.href)}`;
}

// Taps on the controls must not place the character in AR.
for (const el of [els.top, els.bottom]) {
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
}

// Status: an icon while things go well; words only for an error or a passing message ----------

type UiState =
  'loading' | 'ready' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'info' | 'error';

// Lucide icons (ISC). Constant markup, never built from user input.
const ICONS: Record<UiState, string> = {
  loading: '<svg viewBox="0 0 24 24" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  connecting: '<svg viewBox="0 0 24 24" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  ready: '<span class="dot"></span>',
  listening:
    '<svg viewBox="0 0 24 24"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>',
  thinking:
    '<svg viewBox="0 0 24 24" class="bounce"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  speaking:
    '<svg viewBox="0 0 24 24" class="bars"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  error:
    '<svg viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};
const STATE_TEXT: Record<Exclude<UiState, 'info' | 'error'>, string> = {
  loading: 'Cargando…',
  ready: 'Listo',
  connecting: 'Conectando…',
  listening: 'Escuchando…',
  thinking: 'Pensando…',
  speaking: 'Hablando',
};
/** The words under the microphone, for each state. */
const TALK_HINT: Record<UiState, string> = {
  loading: 'Cargando al guía…',
  ready: 'Mantén pulsado para hablar',
  connecting: 'Conectando…',
  listening: 'Te escucho · suelta para enviar',
  thinking: 'Pensando…',
  speaking: 'Mantén pulsado para interrumpir',
  info: 'Mantén pulsado para hablar',
  error: 'Mantén pulsado para hablar',
};
/** A passing message folds back into the icon after this long. */
const INFO_MS = 4000;

let uiState: UiState = 'loading';
let statusBase = STATE_TEXT.loading;
let infoTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(state: UiState, message?: string): void {
  clearTimeout(infoTimer);
  uiState = state;
  statusBase = message ?? (state === 'info' || state === 'error' ? '' : STATE_TEXT[state]);
  els.status.dataset.state = state;
  els.statusIcon.innerHTML = ICONS[state];
  els.statusText.textContent = statusBase;
  els.talkLabel.textContent = TALK_HINT[state];
  els.talk.classList.toggle('speaking', state === 'speaking');
  if (state === 'info') infoTimer = setTimeout(() => setStatus('ready'), INFO_MS);
}
setStatus('loading');

// Audio output and the character -------------------------------------------------------------

const audioCtx = new AudioContext();
let animator: CharacterAnimator | null = null;
let talkingHeld = false;
let modelBusy = false;

const player = new PcmPlayer(audioCtx as unknown as AudioContextLike, {
  onState: (state) => {
    animator?.setState(state === 'speaking' ? 'talking' : 'idle');
    if (state === 'speaking') setStatus('speaking');
    else if (!talkingHeld && uiState !== 'error') setStatus('ready');
  },
});
const unlockAudio = () => player.unlock().catch(() => undefined);

let smoothed = 0;
const stage = new Stage({
  canvas: els.canvas,
  overlay: els.overlay,
  onFrame: (dt) => {
    // Quick attack, slower release: the jaw follows syllables without flickering.
    const target = levelToMouthOpen(player.level());
    smoothed += (target - smoothed) * Math.min(1, dt * (target > smoothed ? 30 : 12));
    animator?.setMouthOpen(smoothed);
    animator?.update(dt);
  },
  onModeChange: (mode) => {
    const ar = mode === 'ar';
    document.documentElement.dataset.mode = mode;
    els.exitAr.hidden = !ar;
    els.ar.hidden = ar || !arSupported;
    els.arGuide.hidden = !ar;
    els.advanced.open = false;
    if (uiState !== 'error') setStatus('ready');
  },
  onPlaced: () => {
    els.arGuide.hidden = true;
  },
});
stage.resize();

let arSupported = false;
void (async () => {
  arSupported = await isArSupported();
  els.ar.hidden = !arSupported;
  if (!arSupported && isIos()) {
    refreshAppClipLink();
    els.appclip.hidden = false;
  }
  if (!arSupported && !isIos()) {
    els.arHint.textContent = 'Este navegador no tiene realidad aumentada (WebXR).';
    els.arHint.hidden = false;
  } else if (arSupported && location.protocol !== 'https:') {
    els.arHint.textContent = 'La realidad aumentada necesita HTTPS.';
    els.arHint.hidden = false;
  }
})();

function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

els.ar.addEventListener('click', () => {
  void unlockAudio();
  stage.startAr().catch((error: unknown) => {
    setStatus('error', `No se pudo iniciar la RA: ${(error as Error).message}`);
  });
});
els.exitAr.addEventListener('click', () => void stage.endAr());

void loadCharacter(MODEL_URL).then(
  (character) => {
    animator = character.animator;
    stage.setCharacter(character.root);
    els.demo.disabled = false;
    els.talk.disabled = false;
    setStatus('ready');
  },
  (error: unknown) => {
    console.error(error);
    els.talk.disabled = false; // the voice works without the 3D model
    setStatus('error', 'No se pudo cargar el modelo del guía');
  },
);

els.demo.addEventListener('click', () => {
  void unlockAudio().then(() => player.enqueue(generateSpeechLikePcm16(4)));
});

// Voice chat ---------------------------------------------------------------------------------

const modelText = new TranscriptBuffer();
const userText = new TranscriptBuffer();
const mic = new MicCapture();

function showError(code: VoiceErrorCode): void {
  setStatus('error', describeVoiceError(code));
  if (code === 'access_code_required') {
    els.codeRow.hidden = false;
    els.code.focus();
  }
}

function onVoiceEvent(event: VoiceEvent): void {
  switch (event.type) {
    case 'transcript': {
      const buffer = event.role === 'model' ? modelText : userText;
      const text = buffer.push(event.text, event.final);
      els.captions.hidden = false;
      (event.role === 'model' ? els.subtitles : els.userText).textContent = text;
      if (event.role === 'model') modelBusy = true;
      break;
    }
    case 'turn_complete':
      modelBusy = false;
      modelText.reset();
      userText.reset();
      if (!player.isSpeaking && !talkingHeld) setStatus('ready');
      break;
    case 'interrupted':
      modelText.reset();
      break;
    case 'ended':
      setStatus(
        'info',
        event.reason === 'time_limit'
          ? 'Se acabó el tiempo de la conversación. Pulsa para empezar otra.'
          : 'La conversación terminó.',
      );
      mic.stop();
      break;
    case 'error':
      mic.stop();
      showError(event.code);
      break;
    case 'ready':
      setStatus('ready');
      break;
  }
}

const voice = new VoiceClient({
  createSocket: (url) => new WebSocket(url) as SocketLike,
  sink: player,
  onEvent: onVoiceEvent,
  location,
  lang,
  getCode: () => storage.get() || undefined,
});

let connecting: Promise<void> | null = null;
function ensureConnected(): Promise<void> {
  if (voice.connected) return Promise.resolve();
  if (!connecting) {
    setStatus('connecting');
    connecting = voice.connect().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

function errorCode(error: unknown): VoiceErrorCode {
  const message = (error as Error | undefined)?.message;
  return message === 'mic_denied' || message === 'mic_unavailable' ? message : 'connection_lost';
}

/** RMS of a PCM16 frame, 0..~1: drives the halo around the microphone. */
function frameLevel(frame: ArrayBuffer): number {
  const samples = new Int16Array(frame);
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length) / 32768;
}
let micLevel = 0;
function showMicLevel(level: number): void {
  micLevel += (Math.min(1, level * 5) - micLevel) * 0.5;
  els.talk.style.setProperty('--level', micLevel.toFixed(3));
}

let talkSeq = 0;
async function pressTalk(): Promise<void> {
  talkingHeld = true;
  const seq = ++talkSeq;
  els.talk.classList.add('held');
  void unlockAudio();
  const micReady = mic.start((frame) => {
    voice.sendAudio(frame);
    if (talkingHeld) showMicLevel(frameLevel(frame));
  });
  try {
    await Promise.all([ensureConnected(), micReady]);
  } catch (error) {
    // Errors from the server were already shown through onVoiceEvent.
    const code = errorCode(error);
    if (code === 'mic_denied' || code === 'mic_unavailable') showError(code);
    else if (uiState !== 'error') showError(code);
    releaseTalk();
    return;
  }
  if (!talkingHeld || seq !== talkSeq) return;
  player.interrupt(); // barge-in: stop the model while the user speaks
  voice.startTalk();
  setStatus('listening');
}

function releaseTalk(): void {
  if (!talkingHeld) return;
  talkingHeld = false;
  els.talk.classList.remove('held');
  micLevel = 0;
  els.talk.style.setProperty('--level', '0');
  voice.endTalk();
  if (voice.connected) setStatus('thinking');
}

els.talk.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  els.talk.setPointerCapture(e.pointerId);
  void pressTalk();
});
for (const type of ['pointerup', 'pointercancel'] as const) {
  els.talk.addEventListener(type, releaseTalk);
}
els.talk.addEventListener('contextmenu', (e) => e.preventDefault());

els.textForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.text.value.trim();
  if (!text) return;
  void unlockAudio();
  ensureConnected().then(
    () => {
      player.interrupt();
      voice.sendText(text);
      els.text.value = '';
      els.text.blur();
      els.captions.hidden = false;
      els.userText.textContent = text;
      els.subtitles.textContent = '';
      modelText.reset();
      setStatus('thinking');
    },
    (error: unknown) => {
      if (uiState !== 'error') showError(errorCode(error));
    },
  );
});

els.codeRow.addEventListener('submit', (e) => {
  e.preventDefault();
  storage.set(els.code.value.trim());
  refreshAppClipLink();
  els.codeRow.hidden = true;
  setStatus('info', 'Código guardado. Vuelve a intentarlo.');
});
els.code.value = storage.get();

// Advanced options: test animation and debug info --------------------------------------------

els.debugToggle.addEventListener('click', () => {
  els.debug.hidden = !els.debug.hidden;
  els.debugToggle.setAttribute('aria-pressed', String(!els.debug.hidden));
});
setInterval(() => {
  if (els.debug.hidden) return;
  els.debug.textContent = [
    `FPS: ${stage.fps}`,
    `Modo: ${stage.mode}`,
    `WebXR immersive-ar: ${arSupported ? 'sí' : 'no'}`,
    `Audio: ${audioCtx.state}`,
    `Voz: ${voice.connected ? 'conectada' : 'desconectada'}${modelBusy ? ' (turno)' : ''}`,
    `Estado: ${statusBase}`,
  ].join('\n');
}, 500);

window.addEventListener('pagehide', () => {
  voice.close();
  mic.stop();
});
