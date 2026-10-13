import { CharacterAnimator, levelToMouthOpen, loadCharacter } from '../ar/character.ts';
import { generateSpeechLikePcm16 } from '../ar/pcm.ts';
import { PcmPlayer, type AudioContextLike } from '../ar/playback.ts';
import {
  describeVoiceError,
  fetchVoiceStatus,
  MicCapture,
  TranscriptBuffer,
  type SocketLike,
  VoiceClient,
  type VoiceErrorCode,
  type VoiceEvent,
} from '../ar/voice.ts';
import { isArSupported, Stage } from '../ar/xr.ts';
import { tapHaptic } from './haptics.ts';
import {
  type Health,
  isLang,
  type Lang,
  overallHealth,
  resolveLang,
  type RowHealth,
  rowHealth,
  type SetupChecks,
  STRINGS,
  type Strings,
  type UiState,
} from './strings.ts';

// AR lab (/ra_test/): the 3D tour-guide character in WebXR, or in a plain 3D view, with an
// optional voice chat. Plain TypeScript + DOM on purpose (no Vue) to keep the page light.

const MODEL_URL = '/ra_test/models/artesano.glb';
const CODE_KEY = 'ra_test_access_code';
const LANG_KEY = 'ra_test_lang';
const APP_SETTINGS_KEY = 'rumbo.settings';

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
  status: $<HTMLButtonElement>('status'),
  statusIcon: $('statusIcon'),
  statusText: $('statusText'),
  live: $('live'),
  setupBox: $('setupBox'),
  setupIcon: $('setupIcon'),
  setupTitle: $('setupTitle'),
  setupClose: $<HTMLButtonElement>('setupClose'),
  arGuide: $('arGuide'),
  debug: $('debug'),
  captions: $('captions'),
  subtitles: $('subtitles'),
  userText: $('userText'),
  ar: $<HTMLButtonElement>('ar'),
  appclip: $<HTMLAnchorElement>('appclip'),
  exitAr: $<HTMLButtonElement>('exitAr'),
  advanced: $<HTMLDetailsElement>('advanced'),
  demo: $<HTMLButtonElement>('demo'),
  debugToggle: $<HTMLButtonElement>('debugToggle'),
  codeRow: $<HTMLFormElement>('codeRow'),
  code: $<HTMLInputElement>('code'),
  talk: $<HTMLButtonElement>('talk'),
  talkLabel: $('talkLabel'),
  textForm: $<HTMLFormElement>('textForm'),
  text: $<HTMLInputElement>('text'),
};
const checkRows = [...els.setupBox.querySelectorAll<HTMLLIElement>('li[data-check]')];
const langButtons = [...document.querySelectorAll<HTMLButtonElement>('.seg button[data-lang]')];

/** Web storage that may be missing (private mode, blocked site data): never throws. */
function store(kind: 'session' | 'local') {
  const area = (): Storage => (kind === 'session' ? sessionStorage : localStorage);
  return {
    get: (key: string): string => {
      try {
        return area().getItem(key) ?? '';
      } catch {
        return '';
      }
    },
    set: (key: string, value: string): void => {
      try {
        area().setItem(key, value);
      } catch {
        // Not remembered, that's all.
      }
    },
  };
}
const session = store('session');
const local = store('local');

// A shared link may carry the access code and the language (?code=…&lang=en). The code is
// remembered for the session and taken out of the address bar.
const linkParams = new URLSearchParams(location.search);
const linkCode = linkParams.get('code')?.trim();
if (linkCode) {
  session.set(CODE_KEY, linkCode);
  linkParams.delete('code');
  replaceQuery();
}
function replaceQuery(): void {
  const query = linkParams.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
const accessCode = (): string | undefined => session.get(CODE_KEY) || undefined;

let lang: Lang = resolveLang({
  linkLang: linkParams.get('lang'),
  pageLang: session.get(LANG_KEY),
  appSettings: local.get(APP_SETTINGS_KEY),
  browserLanguages: navigator.languages,
});
let t: Strings = STRINGS[lang];

/** The App Clip opens this page in its own browser: hand it the code and the language too. */
function refreshAppClipLink(): void {
  const target = new URL(location.pathname, location.origin);
  if (lang !== 'es') target.searchParams.set('lang', lang);
  const code = accessCode();
  if (code) target.searchParams.set('code', code);
  els.appclip.href = `https://appclip.needle.tools/ar?url=${encodeURIComponent(target.href)}`;
}

// Taps on the controls must not place the character in AR.
for (const el of [els.top, els.bottom]) {
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
}

// Icons (Lucide, ISC). Constant markup, never built from user input --------------------------

const SPINNER =
  '<svg viewBox="0 0 24 24" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
const CHECK =
  '<svg viewBox="0 0 24 24" class="ok-icon"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const WARN =
  '<svg viewBox="0 0 24 24" class="warn-icon"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
const NOTE =
  '<svg viewBox="0 0 24 24" class="note-icon"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
const HEALTH_ICON: Record<Health, string> = { ok: CHECK, warn: WARN, pending: SPINNER };
const ROW_ICON: Record<RowHealth, string> = {
  ok: CHECK,
  warn: WARN,
  note: NOTE,
  pending: SPINNER,
};
const ACTIVITY_ICON: Record<Exclude<UiState, 'ready'>, string> = {
  loading: SPINNER,
  connecting: SPINNER,
  listening:
    '<svg viewBox="0 0 24 24"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>',
  thinking:
    '<svg viewBox="0 0 24 24" class="bounce"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  speaking:
    '<svg viewBox="0 0 24 24" class="bars"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>',
  info: NOTE,
  error:
    '<svg viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

// Setup checks: what the box under the status icon lists -------------------------------------

const checks: SetupChecks = { model: 'loading', voice: 'checking', mic: 'prompt', xr: 'none' };

function renderSetup(): void {
  const rows = rowHealth(checks);
  for (const li of checkRows) {
    const key = li.dataset.check as keyof SetupChecks;
    const texts = t.setup[key] as Record<string, string>;
    li.dataset.health = rows[key];
    li.querySelector('.check__icon')!.innerHTML = ROW_ICON[rows[key]];
    li.querySelector('.check__label')!.textContent = texts.label ?? '';
    li.querySelector('.check__detail')!.textContent = texts[checks[key]] ?? '';
  }
  const health = overallHealth(checks);
  els.setupIcon.innerHTML = HEALTH_ICON[health];
  els.setupTitle.textContent =
    health === 'ok' ? t.setup.ok : health === 'warn' ? t.setup.warn : t.setup.voice.checking;
  els.codeRow.hidden = checks.voice !== 'code_required' && checks.voice !== 'code_invalid';
  if (uiState === 'ready') paintStatus();
}

let voiceCheckSeq = 0;
async function checkVoice(): Promise<void> {
  const seq = ++voiceCheckSeq;
  checks.voice = 'checking';
  renderSetup();
  const result = await fetchVoiceStatus((url) => fetch(url, { cache: 'no-store' }), accessCode());
  if (seq !== voiceCheckSeq) return;
  checks.voice = result;
  renderSetup();
}

async function watchMicPermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    const apply = () => {
      checks.mic =
        status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
      renderSetup();
    };
    apply();
    status.addEventListener('change', apply);
  } catch {
    // No Permissions API for the microphone here: it stays "asked when you talk".
  }
}

function setSetupOpen(open: boolean): void {
  els.setupBox.hidden = !open;
  els.status.setAttribute('aria-expanded', String(open));
  if (!open) return;
  els.advanced.open = false;
  if (checks.voice !== 'ok' && checks.voice !== 'checking') void checkVoice();
}
els.status.addEventListener('click', () => setSetupOpen(els.setupBox.hidden !== false));
els.setupClose.addEventListener('click', () => setSetupOpen(false));
els.advanced.addEventListener('toggle', () => {
  if (els.advanced.open) setSetupOpen(false);
});
document.addEventListener('pointerdown', (e) => {
  const target = e.target as Node;
  if (!els.setupBox.hidden && !els.setupBox.contains(target) && !els.status.contains(target)) {
    setSetupOpen(false);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setSetupOpen(false);
});

// Status: an icon while things go well; words only for an error or a passing message ----------

/** A passing message folds back into the icon after this long. */
const INFO_MS = 4000;

let uiState: UiState = 'loading';
let message = '';
let infoTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(state: UiState, text = ''): void {
  clearTimeout(infoTimer);
  uiState = state;
  message = text;
  paintStatus();
  if (state === 'info') infoTimer = setTimeout(() => setStatus('ready'), INFO_MS);
}

function statusWords(): string {
  if (uiState === 'info' || uiState === 'error') return message;
  if (uiState === 'ready') {
    const health = overallHealth(checks);
    return health === 'warn' ? t.setup.warn : health === 'ok' ? t.setup.ok : t.state.ready;
  }
  return t.state[uiState];
}

function paintStatus(): void {
  const words = statusWords();
  els.status.dataset.state = uiState;
  els.statusIcon.innerHTML =
    uiState === 'ready' ? HEALTH_ICON[overallHealth(checks)] : ACTIVITY_ICON[uiState];
  els.statusText.textContent = words;
  els.status.setAttribute('aria-label', `${t.status}: ${words}`);
  els.live.textContent = uiState === 'ready' ? '' : words;
  els.talkLabel.textContent = t.talkHint[uiState];
  els.talk.classList.toggle('speaking', uiState === 'speaking');
}

// Language: every text on the page, live ------------------------------------------------------

function textAt(path: string): string {
  let value: unknown = t;
  for (const part of path.split('.')) value = (value as Record<string, unknown>)[part];
  return typeof value === 'string' ? value : path;
}

function applyStrings(): void {
  document.documentElement.lang = lang === 'pt' ? 'pt-PT' : lang;
  document.title = t.title;
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) {
    el.textContent = textAt(el.dataset.t!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-t-aria]')) {
    el.setAttribute('aria-label', textAt(el.dataset.tAria!));
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-t-placeholder]')) {
    el.placeholder = textAt(el.dataset.tPlaceholder!);
  }
  for (const button of langButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
  renderSetup();
  paintStatus();
}

function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  t = STRINGS[lang];
  session.set(LANG_KEY, lang);
  linkParams.set('lang', lang);
  replaceQuery();
  // The next press opens a session in the new language; what was said stays as it was.
  voice.close();
  mic.stop();
  refreshAppClipLink();
  applyStrings();
}
for (const button of langButtons) {
  button.addEventListener('click', () => {
    if (isLang(button.dataset.lang)) setLang(button.dataset.lang);
  });
}

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
    setSetupOpen(false);
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
  const ios = isIos();
  els.ar.hidden = !arSupported;
  // Safari has no WebXR, so an iPhone that has it is inside Needle's App Clip.
  document.documentElement.classList.toggle('appclip', arSupported && ios);
  if (!arSupported && ios) {
    refreshAppClipLink();
    els.appclip.hidden = false;
  }
  const onLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  checks.xr = arSupported
    ? 'ok'
    : ios
      ? 'appclip'
      : location.protocol !== 'https:' && !onLocalhost
        ? 'https'
        : 'none';
  renderSetup();
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
    setStatus('error', t.arFailed((error as Error).message));
  });
});
els.exitAr.addEventListener('click', () => void stage.endAr());

void loadCharacter(MODEL_URL).then(
  (character) => {
    animator = character.animator;
    stage.setCharacter(character.root);
    els.demo.disabled = false;
    els.talk.disabled = false;
    checks.model = 'ok';
    setStatus('ready');
    renderSetup();
  },
  (error: unknown) => {
    console.error(error);
    els.talk.disabled = false; // the voice works without the 3D model
    checks.model = 'failed';
    setStatus('error', t.modelFailed);
    renderSetup();
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
  setStatus('error', describeVoiceError(code, lang));
  if (code === 'access_code_required') {
    checks.voice = accessCode() ? 'code_invalid' : 'code_required';
  } else if (code === 'voice_unavailable') {
    checks.voice = 'unavailable';
  } else if (code === 'mic_denied') {
    checks.mic = 'denied';
  }
  renderSetup();
  if (code === 'access_code_required') {
    setSetupOpen(true);
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
      setStatus('info', event.reason === 'time_limit' ? t.endedTimeLimit : t.ended);
      mic.stop();
      break;
    case 'error':
      mic.stop();
      showError(event.code);
      break;
    case 'ready':
      checks.voice = 'ok';
      renderSetup();
      setStatus('ready');
      break;
  }
}

const voice = new VoiceClient({
  createSocket: (url) => new WebSocket(url) as SocketLike,
  sink: player,
  onEvent: onVoiceEvent,
  location,
  getLang: () => lang,
  getCode: accessCode,
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
  const text = (error as Error | undefined)?.message;
  return text === 'mic_denied' || text === 'mic_unavailable' ? text : 'connection_lost';
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
  if (checks.mic !== 'granted') {
    checks.mic = 'granted';
    renderSetup();
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
  tapHaptic();
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
  session.set(CODE_KEY, els.code.value.trim());
  refreshAppClipLink();
  setStatus('info', t.codeSaved);
  void checkVoice();
});
els.code.value = accessCode() ?? '';

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
    `Idioma: ${lang}`,
    `Estado: ${uiState}${message ? ` (${message})` : ''}`,
  ].join('\n');
}, 500);

window.addEventListener('pagehide', () => {
  voice.close();
  mic.stop();
});

applyStrings();
setStatus('loading');
void checkVoice();
void watchMicPermission();
