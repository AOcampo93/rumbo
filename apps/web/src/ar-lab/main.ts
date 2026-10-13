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
  status: $('status'),
  debug: $('debug'),
  captions: $('captions'),
  subtitles: $('subtitles'),
  userText: $('userText'),
  controls: $('controls'),
  ar: $<HTMLButtonElement>('ar'),
  appclip: $<HTMLAnchorElement>('appclip'),
  exitAr: $<HTMLButtonElement>('exitAr'),
  arHint: $('arHint'),
  demo: $<HTMLButtonElement>('demo'),
  debugToggle: $<HTMLButtonElement>('debugToggle'),
  codeRow: $('codeRow'),
  code: $<HTMLInputElement>('code'),
  codeSave: $<HTMLButtonElement>('codeSave'),
  talk: $<HTMLButtonElement>('talk'),
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
els.controls.addEventListener('beforexrselect', (e) => e.preventDefault());
els.captions.addEventListener('beforexrselect', (e) => e.preventDefault());

let statusBase = 'Cargando…';
function setStatus(text: string, kind: 'ok' | 'error' | 'busy' = 'ok'): void {
  statusBase = text;
  els.status.textContent = text;
  els.status.dataset.kind = kind;
}

// Audio output and the character -------------------------------------------------------------

const audioCtx = new AudioContext();
let animator: CharacterAnimator | null = null;
let talkingHeld = false;
let modelBusy = false;

const player = new PcmPlayer(audioCtx as unknown as AudioContextLike, {
  onState: (state) => {
    animator?.setState(state === 'speaking' ? 'talking' : 'idle');
    if (state === 'speaking') setStatus('Hablando', 'busy');
    else if (!talkingHeld) setStatus(stage.mode === 'ar' ? 'En RA' : 'Listo');
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
    els.exitAr.hidden = !ar;
    els.ar.hidden = ar || !arSupported;
    setStatus(ar ? 'En RA: apunta al suelo y toca para colocar al guía' : 'Listo');
  },
  onPlaced: () => setStatus('En RA'),
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
  els.arHint.hidden = arSupported && location.protocol === 'https:';
  if (arSupported) els.arHint.textContent = 'La realidad aumentada necesita HTTPS.';
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
    setStatus(`No se pudo iniciar la RA: ${(error as Error).message}`, 'error');
  });
});
els.exitAr.addEventListener('click', () => void stage.endAr());

void loadCharacter(MODEL_URL).then(
  (character) => {
    animator = character.animator;
    stage.setCharacter(character.root);
    els.demo.disabled = false;
    setStatus('Listo');
  },
  (error: unknown) => {
    console.error(error);
    setStatus('Error: no se pudo cargar el modelo del guía', 'error');
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
  setStatus(describeVoiceError(code), 'error');
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
      if (!player.isSpeaking && !talkingHeld) setStatus(stage.mode === 'ar' ? 'En RA' : 'Listo');
      break;
    case 'interrupted':
      modelText.reset();
      break;
    case 'ended':
      setStatus(
        event.reason === 'time_limit'
          ? 'La conversación terminó (límite de tiempo). Pulsa para empezar otra.'
          : 'La conversación terminó.',
      );
      mic.stop();
      break;
    case 'error':
      mic.stop();
      showError(event.code);
      break;
    case 'ready':
      setStatus('Conectado');
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
    setStatus('Conectando…', 'busy');
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

let talkSeq = 0;
async function pressTalk(): Promise<void> {
  talkingHeld = true;
  const seq = ++talkSeq;
  els.talk.classList.add('held');
  void unlockAudio();
  const micReady = mic.start((frame) => voice.sendAudio(frame));
  try {
    await Promise.all([ensureConnected(), micReady]);
  } catch (error) {
    // Errors from the server were already shown through onVoiceEvent.
    const code = errorCode(error);
    if (code === 'mic_denied' || code === 'mic_unavailable') showError(code);
    else if (!els.status.dataset.kind || els.status.dataset.kind !== 'error') showError(code);
    releaseTalk();
    return;
  }
  if (!talkingHeld || seq !== talkSeq) return;
  player.interrupt(); // barge-in: stop the model while the user speaks
  voice.startTalk();
  setStatus('Escuchando…', 'busy');
}

function releaseTalk(): void {
  if (!talkingHeld) return;
  talkingHeld = false;
  els.talk.classList.remove('held');
  voice.endTalk();
  if (voice.connected) setStatus('Pensando…', 'busy');
}

els.talk.disabled = false;
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
      els.captions.hidden = false;
      els.userText.textContent = text;
      els.subtitles.textContent = '';
      modelText.reset();
      setStatus('Pensando…', 'busy');
    },
    (error: unknown) => {
      if (els.status.dataset.kind !== 'error') showError(errorCode(error));
    },
  );
});

els.codeSave.addEventListener('click', () => {
  storage.set(els.code.value.trim());
  refreshAppClipLink();
  els.codeRow.hidden = true;
  setStatus('Código guardado. Vuelve a intentarlo.');
});
els.code.value = storage.get();

// Debug info ---------------------------------------------------------------------------------

els.debugToggle.addEventListener('click', () => {
  els.debug.hidden = !els.debug.hidden;
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
