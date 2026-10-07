const DEFAULT_DURATION_MS = 360;
const REDUCED_DURATION_MS = 90;

function animationFinished(animation) {
  if (!animation?.finished) return Promise.resolve();
  return Promise.resolve(animation.finished).catch(() => {});
}

function setScreenAccessibility(screen, active) {
  if (!screen) return;
  screen.inert = !active;
  screen.setAttribute?.("aria-hidden", String(!active));
}

function setScreenVisible(screen, visible) {
  if (!screen?.classList) return;
  screen.classList.toggle("is-hidden", !visible);
}

export class PreGameTransitionCoordinator {
  constructor({
    windowRef = globalThis.window,
    durationMs = DEFAULT_DURATION_MS,
    reducedDurationMs = REDUCED_DURATION_MS
  } = {}) {
    this.windowRef = windowRef;
    this.durationMs = durationMs;
    this.reducedDurationMs = reducedDurationMs;
    this.busy = false;
  }

  prefersReducedMotion() {
    return Boolean(this.windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  showImmediately(activeScreen, allScreens = []) {
    for (const screen of allScreens) {
      const active = screen === activeScreen;
      setScreenVisible(screen, active);
      setScreenAccessibility(screen, active);
    }
  }

  async transition(fromScreen, toScreen, { focusTarget = null, direction = "forward" } = {}) {
    if (this.busy || !fromScreen || !toScreen || fromScreen === toScreen) return false;

    this.busy = true;
    const reduced = this.prefersReducedMotion();
    const duration = reduced ? this.reducedDurationMs : this.durationMs;

    setScreenVisible(toScreen, true);
    setScreenAccessibility(fromScreen, false);
    setScreenAccessibility(toScreen, false);
    fromScreen.classList?.add("is-pre-game-transitioning");
    toScreen.classList?.add("is-pre-game-transitioning");

    const directionSign = direction === "back" ? -1 : 1;
    const outgoingFrames = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
          { opacity: 0, transform: `translate3d(${-18 * directionSign}px, 0, 0) scale(.985)` }
        ];

    const incomingFrames = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translate3d(${22 * directionSign}px, 0, 0) scale(.975)` },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
        ];

    let outgoing = null;
    let incoming = null;

    try {
      try {
        outgoing = fromScreen.animate?.(outgoingFrames, {
          duration,
          easing: "cubic-bezier(.22,.78,.30,1)",
          fill: "both"
        });
        incoming = toScreen.animate?.(incomingFrames, {
          duration,
          easing: "cubic-bezier(.22,.78,.30,1)",
          fill: "both"
        });
      } catch {
        outgoing = null;
        incoming = null;
      }

      await Promise.all([animationFinished(outgoing), animationFinished(incoming)]);
      outgoing?.cancel?.();
      incoming?.cancel?.();

      setScreenVisible(fromScreen, false);
      setScreenAccessibility(fromScreen, false);
      setScreenAccessibility(toScreen, true);

      if (focusTarget?.focus) {
        try {
          focusTarget.focus({ preventScroll: true });
        } catch {
          focusTarget.focus();
        }
      }

      return true;
    } finally {
      fromScreen.classList?.remove("is-pre-game-transitioning");
      toScreen.classList?.remove("is-pre-game-transitioning");
      this.busy = false;
    }
  }
}
