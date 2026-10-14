// In AR a tap on the screen places (or moves) the scene: the session's `select` event. A tap
// on the page's controls must not, but not every browser honours `beforexrselect` (Needle's
// App Clip on iPhone ignores it), and a held button (hold to talk) only selects on release.
// So the page tells the guard when a finger is on its controls, and the stage asks it.

/** How long after a control is released a `select` still belongs to it (ms). */
export const RELEASE_GRACE_MS = 400;

export class UiTapGuard {
  private pressed = 0;
  private releasedAt = Number.NEGATIVE_INFINITY;

  /** A finger (or the mouse) went down on a control. */
  press(): void {
    this.pressed += 1;
  }

  /** It went up, or was cancelled, anywhere. */
  release(now: number): void {
    if (this.pressed === 0) return;
    this.pressed = 0;
    this.releasedAt = now;
  }

  /** Whether a `select` happening now is a tap on the scene, not on a control. */
  allowsPlacing(now: number): boolean {
    return this.pressed === 0 && now - this.releasedAt > RELEASE_GRACE_MS;
  }
}
