// Texts of the AR lab page (/ra_test/) in the three app languages. The page is plain DOM, so it
// keeps its own small table instead of the app's vue-i18n messages.

export const LANGS = ['es', 'en', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

/** What the page is doing; the status icon and the hint under the microphone follow it. */
export type UiState =
  'loading' | 'ready' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'info' | 'error';
export type ActivityState = Exclude<UiState, 'info' | 'error'>;

export type ModelCheck = 'loading' | 'ok' | 'failed';
export type VoiceCheck =
  'checking' | 'ok' | 'unavailable' | 'code_required' | 'code_invalid' | 'unknown';
export type MicCheck = 'granted' | 'prompt' | 'denied';
export type ArCheck = 'ok' | 'appclip' | 'https' | 'none';

export interface Strings {
  title: string;
  state: Record<ActivityState, string>;
  talkHint: Record<UiState, string>;
  talk: string;
  textPlaceholder: string;
  textLabel: string;
  send: string;
  ar: string;
  appclip: string;
  exitAr: string;
  advanced: string;
  advancedTitle: string;
  demo: string;
  info: string;
  language: string;
  arGuide: string;
  status: string;
  codePlaceholder: string;
  codeUse: string;
  codeSaved: string;
  endedTimeLimit: string;
  ended: string;
  arFailed: (reason: string) => string;
  modelFailed: string;
  setup: {
    ok: string;
    warn: string;
    close: string;
    model: { label: string } & Record<ModelCheck, string>;
    voice: { label: string } & Record<VoiceCheck, string>;
    mic: { label: string } & Record<MicCheck, string>;
    xr: { label: string } & Record<ArCheck, string>;
  };
}

export const STRINGS: Record<Lang, Strings> = {
  es: {
    title: 'Rumbo · Prueba de guía en RA',
    state: {
      loading: 'Cargando…',
      ready: 'Listo',
      connecting: 'Conectando…',
      listening: 'Escuchando…',
      thinking: 'Pensando…',
      speaking: 'Hablando',
    },
    talkHint: {
      loading: 'Cargando al guía…',
      ready: 'Mantén pulsado para hablar',
      connecting: 'Conectando…',
      listening: 'Te escucho · suelta para enviar',
      thinking: 'Pensando…',
      speaking: 'Mantén pulsado para interrumpir',
      info: 'Mantén pulsado para hablar',
      error: 'Mantén pulsado para hablar',
    },
    talk: 'Mantén pulsado para hablar',
    textPlaceholder: 'O escribe tu pregunta',
    textLabel: 'Escribe tu pregunta',
    send: 'Enviar',
    ar: 'Ver en realidad aumentada',
    appclip: 'Abrir en realidad aumentada (App Clip)',
    exitAr: 'Salir de la realidad aumentada',
    advanced: 'Opciones avanzadas',
    advancedTitle: 'Opciones avanzadas',
    demo: 'Probar animación',
    info: 'Info',
    language: 'Idioma',
    arGuide: 'Apunta al suelo y toca para colocar al guía',
    status: 'Estado de la configuración',
    codePlaceholder: 'Código de acceso',
    codeUse: 'Usar',
    codeSaved: 'Código guardado.',
    endedTimeLimit: 'Se acabó el tiempo de la conversación. Mantén pulsado para empezar otra.',
    ended: 'La conversación terminó.',
    arFailed: (reason) => `No se pudo iniciar la RA: ${reason}`,
    modelFailed: 'No se pudo cargar el modelo del guía',
    setup: {
      ok: 'Todo listo',
      warn: 'Revisa la configuración',
      close: 'Cerrar',
      model: {
        label: 'Guía 3D',
        loading: 'Cargando…',
        ok: 'Cargado',
        failed: 'No se pudo cargar',
      },
      voice: {
        label: 'Voz',
        checking: 'Comprobando…',
        ok: 'Disponible',
        unavailable: 'No disponible ahora mismo',
        code_required: 'Falta el código de acceso',
        code_invalid: 'El código de acceso no es válido',
        unknown: 'No se pudo comprobar',
      },
      mic: {
        label: 'Micrófono',
        granted: 'Permitido',
        prompt: 'Se pedirá permiso al hablar',
        denied: 'Bloqueado: actívalo en los ajustes del navegador',
      },
      xr: {
        label: 'Realidad aumentada',
        ok: 'Disponible',
        appclip: 'Ábrela con el botón RA (App Clip)',
        https: 'Necesita HTTPS',
        none: 'Este navegador no la tiene: verás al guía en 3D',
      },
    },
  },
  en: {
    title: 'Rumbo · AR guide test',
    state: {
      loading: 'Loading…',
      ready: 'Ready',
      connecting: 'Connecting…',
      listening: 'Listening…',
      thinking: 'Thinking…',
      speaking: 'Speaking',
    },
    talkHint: {
      loading: 'Loading the guide…',
      ready: 'Press and hold to talk',
      connecting: 'Connecting…',
      listening: 'Listening · release to send',
      thinking: 'Thinking…',
      speaking: 'Press and hold to interrupt',
      info: 'Press and hold to talk',
      error: 'Press and hold to talk',
    },
    talk: 'Press and hold to talk',
    textPlaceholder: 'Or type your question',
    textLabel: 'Type your question',
    send: 'Send',
    ar: 'View in augmented reality',
    appclip: 'Open in augmented reality (App Clip)',
    exitAr: 'Leave augmented reality',
    advanced: 'Advanced options',
    advancedTitle: 'Advanced options',
    demo: 'Test animation',
    info: 'Info',
    language: 'Language',
    arGuide: 'Point at the floor and tap to place the guide',
    status: 'Setup status',
    codePlaceholder: 'Access code',
    codeUse: 'Use',
    codeSaved: 'Code saved.',
    endedTimeLimit: 'The conversation ran out of time. Press and hold to start another.',
    ended: 'The conversation ended.',
    arFailed: (reason) => `Couldn’t start AR: ${reason}`,
    modelFailed: 'Couldn’t load the guide’s model',
    setup: {
      ok: 'All set',
      warn: 'Check the setup',
      close: 'Close',
      model: {
        label: '3D guide',
        loading: 'Loading…',
        ok: 'Loaded',
        failed: 'Couldn’t load',
      },
      voice: {
        label: 'Voice',
        checking: 'Checking…',
        ok: 'Available',
        unavailable: 'Not available right now',
        code_required: 'The access code is missing',
        code_invalid: 'The access code isn’t valid',
        unknown: 'Couldn’t check',
      },
      mic: {
        label: 'Microphone',
        granted: 'Allowed',
        prompt: 'You’ll be asked when you talk',
        denied: 'Blocked: allow it in the browser settings',
      },
      xr: {
        label: 'Augmented reality',
        ok: 'Available',
        appclip: 'Open it with the AR button (App Clip)',
        https: 'Needs HTTPS',
        none: 'This browser doesn’t have it: you’ll see the guide in 3D',
      },
    },
  },
  pt: {
    title: 'Rumbo · Teste do guia em RA',
    state: {
      loading: 'A carregar…',
      ready: 'Pronto',
      connecting: 'A ligar…',
      listening: 'A ouvir…',
      thinking: 'A pensar…',
      speaking: 'A falar',
    },
    talkHint: {
      loading: 'A carregar o guia…',
      ready: 'Mantém premido para falar',
      connecting: 'A ligar…',
      listening: 'Estou a ouvir · solta para enviar',
      thinking: 'A pensar…',
      speaking: 'Mantém premido para interromper',
      info: 'Mantém premido para falar',
      error: 'Mantém premido para falar',
    },
    talk: 'Mantém premido para falar',
    textPlaceholder: 'Ou escreve a tua pergunta',
    textLabel: 'Escreve a tua pergunta',
    send: 'Enviar',
    ar: 'Ver em realidade aumentada',
    appclip: 'Abrir em realidade aumentada (App Clip)',
    exitAr: 'Sair da realidade aumentada',
    advanced: 'Opções avançadas',
    advancedTitle: 'Opções avançadas',
    demo: 'Testar animação',
    info: 'Info',
    language: 'Idioma',
    arGuide: 'Aponta para o chão e toca para colocar o guia',
    status: 'Estado da configuração',
    codePlaceholder: 'Código de acesso',
    codeUse: 'Usar',
    codeSaved: 'Código guardado.',
    endedTimeLimit: 'O tempo da conversa acabou. Mantém premido para começar outra.',
    ended: 'A conversa terminou.',
    arFailed: (reason) => `Não foi possível iniciar a RA: ${reason}`,
    modelFailed: 'Não foi possível carregar o modelo do guia',
    setup: {
      ok: 'Tudo pronto',
      warn: 'Revê a configuração',
      close: 'Fechar',
      model: {
        label: 'Guia 3D',
        loading: 'A carregar…',
        ok: 'Carregado',
        failed: 'Não foi possível carregar',
      },
      voice: {
        label: 'Voz',
        checking: 'A verificar…',
        ok: 'Disponível',
        unavailable: 'Não está disponível agora',
        code_required: 'Falta o código de acesso',
        code_invalid: 'O código de acesso não é válido',
        unknown: 'Não foi possível verificar',
      },
      mic: {
        label: 'Microfone',
        granted: 'Permitido',
        prompt: 'Vai ser pedida permissão quando falares',
        denied: 'Bloqueado: ativa-o nas definições do navegador',
      },
      xr: {
        label: 'Realidade aumentada',
        ok: 'Disponível',
        appclip: 'Abre-a com o botão RA (App Clip)',
        https: 'Precisa de HTTPS',
        none: 'Este navegador não a tem: vais ver o guia em 3D',
      },
    },
  },
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * The page language: the link's ?lang=, then one chosen on this page, then the app's own
 * choice (the rumbo.settings JSON in localStorage), then the browser's, else Spanish.
 */
export function resolveLang(sources: {
  linkLang?: string | null;
  pageLang?: string | null;
  appSettings?: string | null;
  browserLanguages?: readonly string[];
}): Lang {
  if (isLang(sources.linkLang)) return sources.linkLang;
  if (isLang(sources.pageLang)) return sources.pageLang;
  try {
    const locale: unknown = sources.appSettings
      ? (JSON.parse(sources.appSettings) as { locale?: unknown }).locale
      : undefined;
    if (isLang(locale)) return locale;
  } catch {
    // Unreadable settings: fall through.
  }
  for (const tag of sources.browserLanguages ?? []) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'es';
}

export type Health = 'ok' | 'warn' | 'pending';

export interface SetupChecks {
  model: ModelCheck;
  voice: VoiceCheck;
  mic: MicCheck;
  xr: ArCheck;
}

/** One row of the setup box: ok, a problem to fix, a neutral note, or still being checked. */
export type RowHealth = 'ok' | 'warn' | 'note' | 'pending';

export function rowHealth(checks: SetupChecks): Record<keyof SetupChecks, RowHealth> {
  return {
    model: checks.model === 'ok' ? 'ok' : checks.model === 'failed' ? 'warn' : 'pending',
    voice: checks.voice === 'ok' ? 'ok' : checks.voice === 'checking' ? 'pending' : 'warn',
    mic: checks.mic === 'granted' ? 'ok' : checks.mic === 'denied' ? 'warn' : 'note',
    xr: checks.xr === 'ok' ? 'ok' : checks.xr === 'https' ? 'warn' : 'note',
  };
}

/** Yellow when something is misconfigured, green when nothing is, pending while checking. */
export function overallHealth(checks: SetupChecks): Health {
  const rows = Object.values(rowHealth(checks));
  if (rows.includes('warn')) return 'warn';
  if (rows.includes('pending')) return 'pending';
  return 'ok';
}
