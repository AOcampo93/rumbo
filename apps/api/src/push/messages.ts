import type { Locale } from '@rumbo/route-spec';
import type { AnnouncementBody } from './schemas.js';
import type { PushMessage } from './send.js';

// The notifications the server writes, in the language of each subscription:
// a push carries the text to show (the service worker has no catalogs), so
// these live here and not in the web's i18n files.

export const REMINDER_KIND = 'run_reminder';

const REMINDER: Record<Locale, { title: string; body: (route: string) => string }> = {
  es: { title: '¿Seguimos?', body: (route) => `Tu recorrido «${route}» te espera` },
  en: { title: 'Shall we go on?', body: (route) => `Your route “${route}” is waiting for you` },
  pt: { title: 'Continuamos?', body: (route) => `O teu percurso «${route}» está à tua espera` },
};

/** A run left unfinished: tapping it opens the run in progress. */
export function reminderMessage(locale: Locale, routeName: string, runId: string): PushMessage {
  const text = REMINDER[locale];
  return {
    title: text.title,
    body: text.body(routeName),
    url: '/run',
    tag: `${REMINDER_KIND}:${runId}`,
  };
}

/** An announcement of the operator, in the language of the subscription. */
export function announcementMessage(
  announcement: AnnouncementBody,
  locale: Locale,
  tag: string,
): PushMessage {
  return {
    title: announcement.title[locale],
    body: announcement.body[locale],
    url: announcement.url ?? '/',
    tag,
  };
}
