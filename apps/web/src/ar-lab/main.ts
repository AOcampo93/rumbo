import { type Group, Vector3 } from 'three';
import { type CharacterAnimator, levelToMouthOpen, loadCharacter } from '../ar/character.ts';
import { Encounter, type EncounterPhase } from '../ar/encounter.ts';
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
import { type ActorDef, sceneFromParams, swordOut } from '../ar/scenes.ts';
import { isArSupported, Stage } from '../ar/xr.ts';
import { AR_CODE_KEY, appClipUrl, arPageUrl, isIos, readArCode, saveArCode } from '../ar/access.ts';
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
  back: $<HTMLButtonElement>('back'),
  demo: $<HTMLButtonElement>('demo'),
  debugToggle: $<HTMLButtonElement>('debugToggle'),
  codeRow: $<HTMLFormElement>('codeRow'),
  code: $<HTMLInputElement>('code'),
  talk: $<HTMLButtonElement>('talk'),
  talkLabel: $('talkLabel'),
  choiceHint: $('choiceHint'),
  choiceButtons: $('choiceButtons'),
  speakerName: $('speakerName'),
  endTalk: $<HTMLButtonElement>('endTalk'),
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
// kept in this site's localStorage, shared with the app, and taken out of the address bar.
const linkParams = new URLSearchParams(location.search);
const linkCode = (linkParams.get('code') ?? linkParams.get('ra_code'))?.trim();
if (linkCode) {
  saveArCode(linkCode);
  linkParams.delete('code');
  linkParams.delete('ra_code');
  replaceQuery();
} else if (!readArCode() && session.get(AR_CODE_KEY)) {
  saveArCode(session.get(AR_CODE_KEY)); // kept per tab before
}
/** What the page shows: one guide, or an encounter of several characters. */
const scene = sceneFromParams(linkParams);
const isEncounter = scene.kind === 'encounter';
document.documentElement.dataset.scene = scene.kind;
// In an encounter one talks only after choosing a character; a guide is always ready.
document.documentElement.dataset.talk = isEncounter ? 'closed' : 'open';
if (isEncounter) els.arGuide.dataset.t = 'arGuideScene';
/** Opened from a route's arrival: offer the way back to it. */
const fromRoute = linkParams.get('from') === 'route';
function replaceQuery(): void {
  const query = linkParams.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
const accessCode = (): string | undefined => readArCode() || undefined;

let lang: Lang = resolveLang({
  linkLang: linkParams.get('lang'),
  pageLang: session.get(LANG_KEY),
  appSettings: local.get(APP_SETTINGS_KEY),
  browserLanguages: navigator.languages,
});
let t: Strings = STRINGS[lang];

/** The App Clip opens this page in its own browser: hand it the code and the language too. */
function refreshAppClipLink(): void {
  const code = accessCode();
  els.appclip.href = appClipUrl(
    arPageUrl(location.origin, { scene: scene.id, lang, fromRoute, ...(code ? { code } : {}) }),
  );
}

// Back to the route: this page was opened in a window of its own, so closing it shows the
// run again; if the browser won't close it, go to the app (it picks the run up).
els.back.hidden = !fromRoute;
els.back.addEventListener('click', () => {
  voice.close();
  mic.stop();
  window.close();
  setTimeout(() => location.assign('/'), 300);
});

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
  els.choiceHint.textContent = t.approach;
  const speaker = encounter ? currentActor() : undefined;
  els.speakerName.textContent = speaker ? t.talkingWith(speaker.def.name[lang]) : '';
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
let talkingHeld = false;
let modelBusy = false;

interface Actor {
  def: ActorDef;
  animator: CharacterAnimator;
  group: Group;
}
let actors: Actor[] = [];
/** The encounter's script (fight, stop, talk, fight again); null for a single guide. */
let encounter: Encounter | null = null;

/** Who answers now: the guide, or the character chosen in an encounter. */
function currentActor(): Actor | undefined {
  return encounter ? actors.find((actor) => actor.def.id === encounter?.speaker) : actors[0];
}

const player = new PcmPlayer(audioCtx as unknown as AudioContextLike, {
  onState: (state) => {
    const speaking = state === 'speaking';
    if (encounter) encounter.speaking(speaking);
    else actors[0]?.animator.setState(speaking ? 'talking' : 'idle');
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
    const talker = currentActor();
    for (const actor of actors) {
      actor.animator.setMouthOpen(actor === talker ? smoothed : 0);
      actor.animator.update(dt);
    }
    if (encounter) directEncounter(encounter, dt);
  },
  onModeChange: (mode) => {
    const ar = mode === 'ar';
    document.documentElement.dataset.mode = mode;
    els.exitAr.hidden = !ar;
    els.ar.hidden = ar || !arSupported;
    els.arGuide.hidden = !ar;
    placedInAr = false;
    els.advanced.open = false;
    setSetupOpen(false);
    if (uiState !== 'error') setStatus('ready');
  },
  onPlaced: () => {
    els.arGuide.hidden = true;
    placedInAr = true;
  },
});
stage.resize();

let arSupported = false;
void (async () => {
  arSupported = await isArSupported();
  const ios = isIos(navigator);
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

els.ar.addEventListener('click', () => {
  void unlockAudio();
  stage.startAr().catch((error: unknown) => {
    setStatus('error', t.arFailed((error as Error).message));
  });
});
els.exitAr.addEventListener('click', () => void stage.endAr());

void Promise.all(
  scene.actors.map((def) => loadCharacter(def.model, def.clips, isEncounter ? 'fight' : 'idle')),
).then(
  (loaded) => {
    actors = loaded.map((character, i) => {
      const def = scene.actors[i] as ActorDef;
      for (const name of def.hidden ?? []) {
        const mesh = character.root.getObjectByName(name);
        if (mesh) mesh.visible = false;
      }
      return {
        def,
        animator: character.animator,
        group: stage.addActor(character.root, def.x, def.z),
      };
    });
    if (isEncounter) {
      // Face to face, and a wider view for two.
      for (const actor of actors) {
        const other = actors.find((candidate) => candidate !== actor);
        if (other) stage.turnActor(actor.group, other.group.position, Math.PI);
      }
      stage.setViewScale(1.35);
      encounter = new Encounter(
        actors.map((actor) => {
          const sword = actor.def.sword ? actor.group.getObjectByName(actor.def.sword) : undefined;
          return {
            id: actor.def.id,
            animator: {
              setState: (state, done) => {
                if (sword) sword.visible = swordOut(state);
                actor.animator.setState(state, done);
              },
            },
          };
        }),
        onEncounterChange,
      );
      encounter.start();
    }
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

// The encounter: walk up to a character to talk to him ------------------------------------

/** Close enough to a character to talk to him (AR), and far enough to leave him (metres). */
const NEAR_METRES = 2;
const LEAVE_METRES = 3.5;
/** How long one has to stay away before the talk ends (seconds). */
const LEAVE_SECONDS = 2;
/** How fast they turn round (radians per second). */
const TURN_SPEED = 3;
const MIC_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>';

let placedInAr = false;
let awayFor = 0;
let offered = '';
let greeted: string | null = null;
const viewer = new Vector3();

function directEncounter(script: Encounter, dt: number): void {
  stage.viewerOnStage(viewer);
  // Each one looks at his opponent, or at the visitor while he is the one talking.
  for (const actor of actors) {
    const other = actors.find((candidate) => candidate !== actor);
    const towards = script.facing(actor.def.id) === 'visitor' ? viewer : other?.group.position;
    if (towards) stage.turnActor(actor.group, towards, dt * TURN_SPEED);
  }
  const talking = script.phase === 'stopping' || script.phase === 'talking';
  if (stage.mode !== 'ar') {
    // The 3D view has no walking: both can be asked.
    offerTalk(talking ? [] : actors.map((actor) => actor.def.id));
    return;
  }
  const away = (actor: Actor) =>
    Math.hypot(viewer.x - actor.group.position.x, viewer.z - actor.group.position.z);
  if (talking) {
    const speaker = currentActor();
    awayFor = speaker && away(speaker) > LEAVE_METRES ? awayFor + dt : 0;
    if (awayFor > LEAVE_SECONDS) endConversation();
    offerTalk([]);
    return;
  }
  const nearest = actors.reduce<Actor | undefined>(
    (best, actor) => (!best || away(actor) < away(best) ? actor : best),
    undefined,
  );
  offerTalk(placedInAr && nearest && away(nearest) <= NEAR_METRES ? [nearest.def.id] : []);
}

/** Shows a "Talk to …" button for each character on offer (only when that changes). */
function offerTalk(ids: string[]): void {
  const key = `${lang}:${ids.join(',')}:${placedInAr}`;
  if (key === offered) return;
  offered = key;
  els.choiceButtons.replaceChildren(
    ...ids.map((id) => {
      const actor = actors.find((candidate) => candidate.def.id === id) as Actor;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-btn';
      button.innerHTML = MIC_ICON;
      const label = document.createElement('span');
      label.textContent = t.talkWith(actor.def.name[lang]);
      button.append(label);
      button.addEventListener('click', () => talkTo(id));
      return button;
    }),
  );
  els.choiceHint.hidden = ids.length > 0 || !placedInAr;
}

function talkTo(id: string): void {
  if (!encounter) return;
  tapHaptic();
  void unlockAudio();
  if (encounter.speaker && encounter.speaker !== id) {
    // Another character answers: a new session with his voice and knowledge.
    voice.close();
    player.interrupt();
    greeted = null;
  }
  encounter.talkTo(id);
}

function onEncounterChange(phase: EncounterPhase, speaker: string | null): void {
  const open = phase === 'stopping' || phase === 'talking';
  document.documentElement.dataset.talk = open ? 'open' : 'closed';
  const actor = actors.find((candidate) => candidate.def.id === speaker);
  els.speakerName.textContent = actor ? t.talkingWith(actor.def.name[lang]) : '';
  if (!open) greeted = null;
  // Once both have put their swords away, the chosen one greets the visitor.
  if (phase === 'talking' && speaker && greeted !== speaker) {
    greeted = speaker;
    ensureConnected().then(
      () => {
        player.interrupt();
        voice.sendText(t.greet);
        setStatus('thinking');
      },
      (error: unknown) => {
        if (uiState !== 'error') showError(errorCode(error));
      },
    );
  }
}

/** The talk is over: the session closes and they go back to the fight. */
function endConversation(): void {
  if (talkingHeld) releaseTalk();
  voice.close();
  mic.stop();
  player.interrupt();
  awayFor = 0;
  els.captions.hidden = true;
  els.subtitles.textContent = '';
  els.userText.textContent = '';
  encounter?.finish();
  if (uiState !== 'error') setStatus('ready');
}
els.endTalk.addEventListener('click', endConversation);

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
      if (encounter) endConversation();
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
  getCharacter: () => currentActor()?.def.id ?? (scene.actors[0] as ActorDef).id,
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
  saveArCode(els.code.value);
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
