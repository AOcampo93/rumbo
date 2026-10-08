import {
  ACTION_LIMITS,
  type ActionDef,
  type Locale,
  type LocalizedText,
  QuizParamsSchema,
  RedirectParamsSchema,
  resolveText,
  ToastParamsSchema,
  USER_QUIZ_POINTS,
  UserLinkSchema,
  VideoParamsSchema,
  YOUTUBE_ID,
} from '@rumbo/route-spec';
import { cleanText } from './text.ts';

// What happens when the user arrives at a place (docs/PROJECT_PLAN.md §7):
// the creator lets each place pick one, and buildRouteSpec turns the choice
// into the place's `onEnter` action.

/** The ways to greet someone who arrives at a place. */
export type ArrivalChoice =
  /** The AI card when there is one ready, else the basic sheet. The default. */
  | { type: 'card' }
  /** The basic sheet: the place's name and address, without the AI. */
  | { type: 'basic' }
  /** The user's own question; a right answer scores `USER_QUIZ_POINTS`. */
  | {
      type: 'quiz';
      question: string;
      /** Two to four answers. */
      options: string[];
      /** Index of the right one in `options`. */
      correctIndex: number;
      explanation?: string;
    }
  /** A YouTube video, played in the arrival sheet. */
  | { type: 'video'; youtubeId: string; title?: string }
  /** A web page, opened in the browser after the user confirms. */
  | { type: 'link'; url: string; label: string }
  /** Only a short notice ("Llegaste a …"): no sheet, the route goes on. */
  | { type: 'check' };

export type ArrivalType = ArrivalChoice['type'];

/** In the order the creator lists them. */
export const ARRIVAL_TYPES = ['card', 'basic', 'quiz', 'video', 'link', 'check'] as const;

/**
 * The i18n key of the notice a `check` shows. The toast handler gives it the
 * place's name as `{name}`; the web's catalogs define it ("Llegaste a {name}").
 */
export const CHECK_MESSAGE_KEY = 'run.arrivedAt';

/** The texts an arrival may hold, in code points (the schemas of the actions count the same way). */
export const ARRIVAL_LIMITS = {
  question: ACTION_LIMITS.quiz.question,
  option: ACTION_LIMITS.quiz.option,
  explanation: ACTION_LIMITS.quiz.explanation,
  options: ACTION_LIMITS.quiz.options,
  videoTitle: ACTION_LIMITS.videoTitle,
  linkLabel: ACTION_LIMITS.redirectLabel,
  linkUrl: ACTION_LIMITS.userLinkUrl,
} as const;

/** The arrival of a place: its choice, or the default one. */
export function arrivalTypeOf(place: { arrival?: ArrivalChoice | undefined }): ArrivalType {
  return place.arrival?.type ?? 'card';
}

/** A blank arrival of a type, for the creator to fill in. */
export function emptyArrival(type: ArrivalType): ArrivalChoice {
  switch (type) {
    case 'quiz':
      return { type, question: '', options: ['', ''], correctIndex: 0 };
    case 'video':
      return { type, youtubeId: '' };
    case 'link':
      return { type, url: '', label: '' };
    default:
      return { type };
  }
}

/**
 * The id of a YouTube video from what someone pastes: a link
 * (youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID, /live/ID, also
 * from m., music. and youtube-nocookie.com) or the id itself. Null when it is
 * neither, so a link to another site is never mistaken for a video.
 */
export function parseYoutubeId(input: string): string | null {
  const text = cleanText(input);
  if (YOUTUBE_ID.test(text)) return text;
  const link =
    /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be)(?::\d+)?\/([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(
      text,
    );
  if (!link) return null;
  const segments = (link[2] as string).split('/').filter(Boolean);
  let id: string | undefined;
  if (link[1]?.toLowerCase() === 'youtu.be') id = segments[0];
  else if (['embed', 'shorts', 'live', 'v'].includes(segments[0] ?? '')) id = segments[1];
  else id = /(?:^|&)v=([^&]*)/.exec(link[3] ?? '')?.[1];
  return id !== undefined && YOUTUBE_ID.test(id) ? id : null;
}

export type ArrivalIssueCode =
  | 'arrival_question_required'
  | 'arrival_question_too_long'
  /** Not 2 to 4 answers. */
  | 'arrival_options_count'
  | 'arrival_option_required'
  | 'arrival_option_too_long'
  /** `correctIndex` doesn't point to one of the answers. */
  | 'arrival_correct_invalid'
  | 'arrival_explanation_too_long'
  | 'arrival_video_invalid'
  | 'arrival_video_title_too_long'
  /** Not a full https:// link (see UserLinkSchema). */
  | 'arrival_link_invalid'
  | 'arrival_link_label_required'
  | 'arrival_link_label_too_long';

const size = (text: string) => [...cleanText(text)].length;

/**
 * What keeps an arrival from becoming a valid action, each problem once.
 * Texts are checked as buildRouteSpec writes them (cleaned, in code points).
 */
export function validateArrival(arrival: ArrivalChoice | undefined): ArrivalIssueCode[] {
  const issues = new Set<ArrivalIssueCode>();
  if (arrival?.type === 'quiz') {
    const { question, options, correctIndex, explanation } = arrival;
    if (size(question) === 0) issues.add('arrival_question_required');
    else if (size(question) > ARRIVAL_LIMITS.question) issues.add('arrival_question_too_long');
    if (
      options.length < ARRIVAL_LIMITS.options.min ||
      options.length > ARRIVAL_LIMITS.options.max
    ) {
      issues.add('arrival_options_count');
    }
    for (const option of options) {
      if (size(option) === 0) issues.add('arrival_option_required');
      else if (size(option) > ARRIVAL_LIMITS.option) issues.add('arrival_option_too_long');
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      issues.add('arrival_correct_invalid');
    }
    if (explanation !== undefined && size(explanation) > ARRIVAL_LIMITS.explanation) {
      issues.add('arrival_explanation_too_long');
    }
  } else if (arrival?.type === 'video') {
    if (!YOUTUBE_ID.test(arrival.youtubeId)) issues.add('arrival_video_invalid');
    if (arrival.title !== undefined && size(arrival.title) > ARRIVAL_LIMITS.videoTitle) {
      issues.add('arrival_video_title_too_long');
    }
  } else if (arrival?.type === 'link') {
    if (!UserLinkSchema.safeParse(cleanText(arrival.url)).success) {
      issues.add('arrival_link_invalid');
    }
    if (size(arrival.label) === 0) issues.add('arrival_link_label_required');
    else if (size(arrival.label) > ARRIVAL_LIMITS.linkLabel) {
      issues.add('arrival_link_label_too_long');
    }
  }
  return [...issues];
}

/**
 * The action a quiz, video, link or check becomes; null for `card` and
 * `basic`, which show a sheet of the place itself (buildRouteSpec makes it).
 * Texts are cleaned; the arrival has to pass validateArrival first.
 */
export function ownArrivalAction(arrival: ArrivalChoice): ActionDef | null {
  switch (arrival.type) {
    case 'quiz': {
      const explanation = cleanText(arrival.explanation ?? '');
      return {
        type: 'quiz',
        params: {
          question: cleanText(arrival.question),
          options: arrival.options.map(cleanText),
          correctIndex: arrival.correctIndex,
          points: USER_QUIZ_POINTS,
          ...(explanation ? { explanation } : {}),
        },
      };
    }
    case 'video': {
      const title = cleanText(arrival.title ?? '');
      return {
        type: 'video',
        params: { provider: 'youtube', id: arrival.youtubeId, ...(title ? { title } : {}) },
      };
    }
    case 'link':
      return {
        type: 'redirect',
        params: { url: cleanText(arrival.url), label: cleanText(arrival.label) },
      };
    case 'check':
      return { type: 'toast', params: { messageKey: CHECK_MESSAGE_KEY } };
    default:
      return null;
  }
}

/**
 * The arrival a saved action stands for, for editing a route (draftFromSpec).
 * Cards and basic sheets read back as no choice (the default), as there is no
 * telling them apart; an action the creator doesn't make is no choice either.
 */
export function arrivalFromAction(
  action: ActionDef | undefined,
  locale: Locale,
): ArrivalChoice | undefined {
  if (!action) return undefined;
  const text = (value: LocalizedText) => resolveText(value, locale, locale).text;
  const params = action.params ?? {};
  switch (action.type) {
    case 'quiz': {
      const quiz = QuizParamsSchema.safeParse(params);
      if (!quiz.success) return undefined;
      const { question, options, correctIndex, explanation } = quiz.data;
      return {
        type: 'quiz',
        question: text(question),
        options: options.map(text),
        correctIndex,
        ...(explanation !== undefined ? { explanation: text(explanation) } : {}),
      };
    }
    case 'video': {
      const video = VideoParamsSchema.safeParse(params);
      if (!video.success || video.data.provider !== 'youtube' || !video.data.id) return undefined;
      const { id, title } = video.data;
      return {
        type: 'video',
        youtubeId: id,
        ...(title !== undefined ? { title: text(title) } : {}),
      };
    }
    case 'redirect': {
      const link = RedirectParamsSchema.safeParse(params);
      if (!link.success) return undefined;
      return { type: 'link', url: link.data.url, label: text(link.data.label) };
    }
    case 'toast': {
      const toast = ToastParamsSchema.safeParse(params);
      return toast.success && toast.data.messageKey === CHECK_MESSAGE_KEY
        ? { type: 'check' }
        : undefined;
    }
    default:
      return undefined;
  }
}
