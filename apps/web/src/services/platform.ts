// What the browser can do (PROJECT_PLAN §10.5). Feature detection first; the
// user agent only tells iOS apart, where notifications need the installed PWA.

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac: tell them apart by touch support.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as an installed PWA. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || nav.standalone);
}

export const supports = {
  vibration: () => typeof navigator.vibrate === 'function',
  wakeLock: () => 'wakeLock' in navigator,
  notifications: () => 'Notification' in globalThis,
  geolocation: () => 'geolocation' in navigator,
};

/** iOS only shows notifications from an installed PWA (16.4+). */
export function notificationsNeedInstall(): boolean {
  return isIos() && !isStandalone();
}
