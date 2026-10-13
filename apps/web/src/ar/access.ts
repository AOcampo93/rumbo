// The AR guide (version 2 prototype): its voice needs an access code (the API checks it, as the
// voice costs money). The code lives in this site's localStorage, so the app and the /ra_test/
// page share it and the App Clip gets it in its link; it is not a secret worth more than that.

export const AR_CODE_KEY = 'ra_test_access_code';
/** Query parameter that hands the code to the app or the AR page once (then it is removed). */
export const AR_CODE_PARAM = 'ra_code';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localArea(): StorageLike | null {
  try {
    return localStorage;
  } catch {
    return null; // blocked site data
  }
}

export function readArCode(storage: StorageLike | null = localArea()): string {
  try {
    return storage?.getItem(AR_CODE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveArCode(code: string, storage: StorageLike | null = localArea()): void {
  try {
    storage?.setItem(AR_CODE_KEY, code.trim());
  } catch {
    // Not remembered: the AR page asks again.
  }
}

/**
 * Keeps a code that came in the link (`?ra_code=` on any page of the app) and returns the
 * address without it, or null when there was none. The caller replaces the history entry.
 */
export function adoptArCodeFromUrl(
  href: string,
  storage: StorageLike | null = localArea(),
): string | null {
  const url = new URL(href);
  const code = url.searchParams.get(AR_CODE_PARAM)?.trim();
  if (code === undefined) return null;
  if (code) saveArCode(code, storage);
  url.searchParams.delete(AR_CODE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface ArPageOptions {
  character: string;
  lang: string;
  /** Opened from a route's arrival: the page offers to go back to it. */
  fromRoute?: boolean;
  /** Only for the App Clip, which has its own storage. */
  code?: string;
}

/** The AR page for a character, on this site. */
export function arPageUrl(origin: string, options: ArPageOptions): string {
  const url = new URL('/ra_test/', origin);
  url.searchParams.set('character', options.character);
  url.searchParams.set('lang', options.lang);
  if (options.fromRoute) url.searchParams.set('from', 'route');
  if (options.code) url.searchParams.set('code', options.code);
  return url.href;
}

/** Needle's App Clip, which brings WebXR to iPhones (Safari has none). */
export function appClipUrl(pageUrl: string): string {
  return `https://appclip.needle.tools/ar?url=${encodeURIComponent(pageUrl)}`;
}

export function isIos(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  );
}
