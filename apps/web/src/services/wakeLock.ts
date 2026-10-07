import { supports } from './platform.ts';

// Keeps the screen on during a run (PROJECT_PLAN §10.5): with the screen off
// the browser stops reporting positions. The lock is lost whenever the page is
// hidden, so it is requested again when the page comes back.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Denied (e.g. battery saver): the run still works while the screen is on.
  }
}

function onVisibility(): void {
  void acquire();
}

export async function keepScreenOn(): Promise<boolean> {
  if (!supports.wakeLock()) return false;
  wanted = true;
  document.addEventListener('visibilitychange', onVisibility);
  await acquire();
  return sentinel !== null;
}

export async function releaseScreen(): Promise<void> {
  wanted = false;
  document.removeEventListener('visibilitychange', onVisibility);
  try {
    await sentinel?.release();
  } catch {
    // Already released.
  }
  sentinel = null;
}
