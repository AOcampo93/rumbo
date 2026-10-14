import { describe, expect, it } from 'vitest';
import { RELEASE_GRACE_MS, UiTapGuard } from '../src/ar/tap-guard.ts';

// An AR tap places the scene, unless the finger was on the page's controls.

describe('the AR tap guard', () => {
  it('lets a tap on the scene place it', () => {
    expect(new UiTapGuard().allowsPlacing(1000)).toBe(true);
  });

  it('keeps a held control (hold to talk) from moving the scene, also right after release', () => {
    const guard = new UiTapGuard();
    guard.press();
    expect(guard.allowsPlacing(1000)).toBe(false);
    expect(guard.allowsPlacing(9000)).toBe(false);
    guard.release(9000);
    expect(guard.allowsPlacing(9000 + RELEASE_GRACE_MS - 1)).toBe(false);
    expect(guard.allowsPlacing(9000 + RELEASE_GRACE_MS + 1)).toBe(true);
  });

  it('ignores a release with no press (a tap that started on the scene)', () => {
    const guard = new UiTapGuard();
    guard.release(5000);
    expect(guard.allowsPlacing(5001)).toBe(true);
  });

  it('two fingers on controls count as one press until they lift', () => {
    const guard = new UiTapGuard();
    guard.press();
    guard.press();
    guard.release(100);
    expect(guard.allowsPlacing(100 + RELEASE_GRACE_MS + 1)).toBe(true);
  });
});
