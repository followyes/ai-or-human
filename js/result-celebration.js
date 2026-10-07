const DEFAULT_OPTIONS = Object.freeze({
  firstTurnDelayMinMs: 420,
  firstTurnDelayMaxMs: 2400,
  idleTurnDelayMinMs: 1800,
  idleTurnDelayMaxMs: 5200,
  oneTurnDurationMinMs: 1050,
  oneTurnDurationMaxMs: 1450,
  extraTurnDurationMinMs: 650,
  extraTurnDurationMaxMs: 900,
  ambientSparkleDelayMinMs: 2000,
  ambientSparkleDelayMaxMs: 5000,
  sparkleDurationMinMs: 1000,
  sparkleDurationMaxMs: 1600,
  ambientHaloDelayMinMs: 4000,
  ambientHaloDelayMaxMs: 8000,
  haloDurationMinMs: 1500,
  haloDurationMaxMs: 2200,
  ambientStarDelayMinMs: 4000,
  ambientStarDelayMaxMs: 9000,
  starDurationMinMs: 800,
  starDurationMaxMs: 1300
});

export function randomInteger(random, min, max) {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return Math.floor(random() * (upper - lower + 1)) + lower;
}

export function chooseFullTurns(random) {
  const roll = random();
  if (roll < 0.72) return 1;
  if (roll < 0.96) return 2;
  return 3;
}

export function getFullTurnAngle(random, turns = chooseFullTurns(random)) {
  const direction = random() < 0.5 ? -1 : 1;
  return direction * Math.max(1, Math.round(turns)) * 360;
}

function animationFinished(animation) {
  return Promise.resolve(animation?.finished).catch(() => undefined);
}

function canPauseAnimation(animation) {
  return animation && typeof animation.pause === "function" && typeof animation.play === "function";
}

export class ResultCelebrationController {
  constructor({
    cardSurfaces = [],
    sparkles = [],
    halo = null,
    dividerStar = null,
    canSchedule = () => true,
    windowRef = globalThis.window,
    motionMedia = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null,
    random = Math.random,
    options = {}
  } = {}) {
    this.cardSurfaces = [...cardSurfaces];
    this.sparkles = [...sparkles];
    this.halo = halo;
    this.dividerStar = dividerStar;
    this.canSchedule = canSchedule;
    this.windowRef = windowRef;
    this.motionMedia = motionMedia;
    this.random = random;
    this.options = Object.freeze({ ...DEFAULT_OPTIONS, ...options });

    this.active = false;
    this.suspended = false;
    this.cardTimers = new Map();
    this.activeCardAnimations = new Map();
    this.activeDecorationAnimations = new Set();
    this.pausedAnimations = new Set();
    this.sparkleTimer = null;
    this.haloTimer = null;
    this.starTimer = null;
    this.destroyed = false;

    this.handleMotionPreferenceChange = this.handleMotionPreferenceChange.bind(this);
    if (this.motionMedia?.addEventListener) {
      this.motionMedia.addEventListener("change", this.handleMotionPreferenceChange);
    } else if (this.motionMedia?.addListener) {
      this.motionMedia.addListener(this.handleMotionPreferenceChange);
    }
  }

  get reducedMotion() {
    return Boolean(this.motionMedia?.matches);
  }

  isSchedulingAllowed() {
    return !this.destroyed && this.active && !this.suspended && !this.reducedMotion && Boolean(this.canSchedule?.());
  }

  enter() {
    if (this.destroyed) return false;
    this.active = true;

    if (!this.isSchedulingAllowed()) return false;

    this.playEntrySparkles();
    this.playDividerFlare({ entry: true });
    this.scheduleAllCards({ first: true });
    this.scheduleAmbientSparkle();
    this.scheduleAmbientHalo();
    this.scheduleAmbientStar();
    return true;
  }

  leave() {
    this.active = false;
    this.clearPendingSchedules();
    return true;
  }

  destroy() {
    this.leave();
    this.destroyed = true;
    this.suspended = false;
    this.pausedAnimations.clear();

    if (this.motionMedia?.removeEventListener) {
      this.motionMedia.removeEventListener("change", this.handleMotionPreferenceChange);
    } else if (this.motionMedia?.removeListener) {
      this.motionMedia.removeListener(this.handleMotionPreferenceChange);
    }
  }

  handleMotionPreferenceChange() {
    if (this.reducedMotion) {
      // Stop only future work. Finite animations already in progress finish naturally.
      this.clearPendingSchedules();
      return;
    }

    if (!this.isSchedulingAllowed()) return;
    this.armPersistentSchedules();
  }

  suspendForThemeTransition() {
    if (this.destroyed || this.suspended) return false;
    this.suspended = true;
    this.clearPendingSchedules();
    this.pauseActiveAnimations();
    return true;
  }

  resumeAfterThemeTransition() {
    if (this.destroyed || !this.suspended) return false;
    this.suspended = false;
    this.resumePausedAnimations();

    if (this.isSchedulingAllowed()) {
      this.armPersistentSchedules();
    }
    return true;
  }

  pauseActiveAnimations() {
    const activeAnimations = [
      ...this.activeCardAnimations.values(),
      ...this.activeDecorationAnimations
    ];

    for (const animation of activeAnimations) {
      if (!canPauseAnimation(animation)) continue;
      const playState = animation.playState;
      if (playState === "finished" || playState === "idle") continue;
      try {
        animation.pause();
        this.pausedAnimations.add(animation);
      } catch {
        // A browser animation may finish between the state read and pause().
      }
    }
  }

  resumePausedAnimations() {
    for (const animation of this.pausedAnimations) {
      if (!canPauseAnimation(animation)) continue;
      const playState = animation.playState;
      if (playState === "finished" || playState === "idle") continue;
      try {
        animation.play();
      } catch {
        // Ignore stale animations that completed while the theme transition settled.
      }
    }
    this.pausedAnimations.clear();
  }

  trackDecorationAnimation(animation) {
    if (!animation) return null;
    this.activeDecorationAnimations.add(animation);
    animationFinished(animation).finally(() => {
      this.activeDecorationAnimations.delete(animation);
      this.pausedAnimations.delete(animation);
    });
    return animation;
  }

  clearPendingSchedules() {
    for (const timerId of this.cardTimers.values()) {
      this.windowRef?.clearTimeout?.(timerId);
    }
    this.cardTimers.clear();

    for (const timerKey of ["sparkleTimer", "haloTimer", "starTimer"]) {
      const timerId = this[timerKey];
      if (timerId !== null) {
        this.windowRef?.clearTimeout?.(timerId);
        this[timerKey] = null;
      }
    }
  }

  armPersistentSchedules() {
    this.scheduleAllCards({ first: false });
    this.scheduleAmbientSparkle();
    this.scheduleAmbientHalo();
    this.scheduleAmbientStar();
  }

  scheduleAllCards({ first }) {
    this.cardSurfaces.forEach((surface, index) => {
      if (this.cardTimers.has(surface) || this.activeCardAnimations.has(surface)) return;
      const delay = first
        ? randomInteger(this.random, this.options.firstTurnDelayMinMs, this.options.firstTurnDelayMaxMs)
        : randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, delay);
    });
  }

  scheduleCard(surface, index, delayMs) {
    if (!surface || !this.isSchedulingAllowed() || this.cardTimers.has(surface) || this.activeCardAnimations.has(surface)) {
      return false;
    }

    const timerId = this.windowRef.setTimeout(() => {
      this.cardTimers.delete(surface);
      if (!this.isSchedulingAllowed()) return;
      this.startCardTurn(surface, index);
    }, delayMs);

    this.cardTimers.set(surface, timerId);
    return true;
  }

  startCardTurn(surface, index) {
    if (!surface || !this.isSchedulingAllowed() || this.activeCardAnimations.has(surface)) return false;
    if (typeof surface.animate !== "function") {
      const nextDelay = randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, nextDelay);
      return false;
    }

    const turns = chooseFullTurns(this.random);
    const angle = getFullTurnAngle(this.random, turns);
    const duration = randomInteger(
      this.random,
      this.options.oneTurnDurationMinMs,
      this.options.oneTurnDurationMaxMs
    ) + (turns - 1) * randomInteger(
      this.random,
      this.options.extraTurnDurationMinMs,
      this.options.extraTurnDurationMaxMs
    );

    const animation = surface.animate(
      [
        { transform: "rotateY(0deg) translateZ(0)" },
        { transform: `rotateY(${angle}deg) translateZ(0)` }
      ],
      {
        duration,
        easing: "cubic-bezier(.45, .05, .24, 1)",
        fill: "none"
      }
    );

    this.activeCardAnimations.set(surface, animation);
    surface.dataset.resultTurnCard = String(index + 1);

    animationFinished(animation).finally(() => {
      if (this.activeCardAnimations.get(surface) === animation) {
        this.activeCardAnimations.delete(surface);
      }
      this.pausedAnimations.delete(animation);
      delete surface.dataset.resultTurnCard;

      // The completed angle is an integer multiple of 360deg, so returning to the
      // resting transform is visually equivalent and cannot snap.
      if (!this.isSchedulingAllowed()) return;
      const nextDelay = randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, nextDelay);
    });

    return true;
  }

  playEntrySparkles() {
    if (!this.isSchedulingAllowed() || !this.sparkles.length) return false;

    this.sparkles.forEach((sparkle, index) => {
      if (typeof sparkle.animate !== "function") return;
      const duration = randomInteger(this.random, 1100, 1600);
      const delay = index * 120 + randomInteger(this.random, 0, 160);
      const animation = sparkle.animate(
        [
          { opacity: 0, transform: "scale(.25) rotate(-20deg)" },
          { opacity: 0.96, transform: "scale(1.58) rotate(7deg)", offset: 0.44 },
          { opacity: 0.56, transform: "scale(1.12) rotate(13deg)", offset: 0.68 },
          { opacity: 0, transform: "scale(.82) rotate(20deg)" }
        ],
        {
          duration,
          delay,
          easing: "cubic-bezier(.18, .82, .24, 1)",
          fill: "none"
        }
      );
      this.trackDecorationAnimation(animation);
    });
    return true;
  }

  scheduleAmbientSparkle() {
    if (!this.isSchedulingAllowed() || !this.sparkles.length || this.sparkleTimer !== null) return false;

    const delay = randomInteger(
      this.random,
      this.options.ambientSparkleDelayMinMs,
      this.options.ambientSparkleDelayMaxMs
    );

    this.sparkleTimer = this.windowRef.setTimeout(() => {
      this.sparkleTimer = null;
      if (!this.isSchedulingAllowed()) return;

      const sparkle = this.sparkles[randomInteger(this.random, 0, this.sparkles.length - 1)];
      this.playAmbientSparkle(sparkle);
      this.scheduleAmbientSparkle();
    }, delay);

    return true;
  }

  playAmbientSparkle(sparkle) {
    if (!sparkle || typeof sparkle.animate !== "function") return false;

    const duration = randomInteger(
      this.random,
      this.options.sparkleDurationMinMs,
      this.options.sparkleDurationMaxMs
    );

    const animation = sparkle.animate(
      [
        { opacity: 0, transform: "scale(.42) rotate(-10deg)" },
        { opacity: 0.92, transform: "scale(1.28) rotate(3deg)", offset: 0.46 },
        { opacity: 0, transform: "scale(.72) rotate(12deg)" }
      ],
      {
        duration,
        easing: "cubic-bezier(.2, .72, .25, 1)",
        fill: "none"
      }
    );
    this.trackDecorationAnimation(animation);
    return true;
  }

  scheduleAmbientHalo() {
    if (!this.isSchedulingAllowed() || !this.halo || this.haloTimer !== null) return false;

    const delay = randomInteger(
      this.random,
      this.options.ambientHaloDelayMinMs,
      this.options.ambientHaloDelayMaxMs
    );

    this.haloTimer = this.windowRef.setTimeout(() => {
      this.haloTimer = null;
      if (!this.isSchedulingAllowed()) return;
      this.playAmbientHalo();
      this.scheduleAmbientHalo();
    }, delay);

    return true;
  }

  playAmbientHalo() {
    if (!this.halo || typeof this.halo.animate !== "function") return false;

    const duration = randomInteger(
      this.random,
      this.options.haloDurationMinMs,
      this.options.haloDurationMaxMs
    );

    const animation = this.halo.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(.86)" },
        { opacity: 0.34, transform: "translate(-50%, -50%) scale(1.02)", offset: 0.46 },
        { opacity: 0.14, transform: "translate(-50%, -50%) scale(1.08)", offset: 0.72 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.16)" }
      ],
      {
        duration,
        easing: "cubic-bezier(.22, .70, .28, 1)",
        fill: "none"
      }
    );
    this.trackDecorationAnimation(animation);
    return true;
  }

  scheduleAmbientStar() {
    if (!this.isSchedulingAllowed() || !this.dividerStar || this.starTimer !== null) return false;

    const delay = randomInteger(
      this.random,
      this.options.ambientStarDelayMinMs,
      this.options.ambientStarDelayMaxMs
    );

    this.starTimer = this.windowRef.setTimeout(() => {
      this.starTimer = null;
      if (!this.isSchedulingAllowed()) return;
      this.playDividerFlare({ entry: false });
      this.scheduleAmbientStar();
    }, delay);

    return true;
  }

  playDividerFlare({ entry = false } = {}) {
    if (!this.dividerStar || typeof this.dividerStar.animate !== "function" || !this.isSchedulingAllowed()) return false;

    const duration = entry
      ? randomInteger(this.random, 1100, 1450)
      : randomInteger(this.random, this.options.starDurationMinMs, this.options.starDurationMaxMs);
    const peakScale = entry ? 2.15 : 1.62;

    const animation = this.dividerStar.animate(
      [
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
        { opacity: 1, transform: `translate(-50%, -50%) scale(${peakScale})`, offset: entry ? 0.44 : 0.50 },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)" }
      ],
      {
        duration,
        easing: "cubic-bezier(.18, .82, .24, 1)",
        fill: "none"
      }
    );
    this.trackDecorationAnimation(animation);
    return true;
  }
}
