const DEFAULT_OPTIONS = Object.freeze({
  firstTurnDelayMinMs: 420,
  firstTurnDelayMaxMs: 2400,
  idleTurnDelayMinMs: 1800,
  idleTurnDelayMaxMs: 5200,
  oneTurnDurationMinMs: 1050,
  oneTurnDurationMaxMs: 1450,
  extraTurnDurationMinMs: 650,
  extraTurnDurationMaxMs: 900,
  ambientSparkleDelayMinMs: 2400,
  ambientSparkleDelayMaxMs: 5600,
  sparkleDurationMinMs: 620,
  sparkleDurationMaxMs: 880
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

export class ResultCelebrationController {
  constructor({
    cardSurfaces = [],
    sparkles = [],
    canSchedule = () => true,
    windowRef = globalThis.window,
    motionMedia = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null,
    random = Math.random,
    options = {}
  } = {}) {
    this.cardSurfaces = [...cardSurfaces];
    this.sparkles = [...sparkles];
    this.canSchedule = canSchedule;
    this.windowRef = windowRef;
    this.motionMedia = motionMedia;
    this.random = random;
    this.options = Object.freeze({ ...DEFAULT_OPTIONS, ...options });

    this.active = false;
    this.cardTimers = new Map();
    this.activeCardAnimations = new Map();
    this.sparkleTimer = null;
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
    return !this.destroyed && this.active && !this.reducedMotion && Boolean(this.canSchedule?.());
  }

  enter() {
    if (this.destroyed) return false;
    this.active = true;

    if (!this.isSchedulingAllowed()) return false;

    this.playEntrySparkles();
    this.scheduleAllCards({ first: true });
    this.scheduleAmbientSparkle();
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

    if (this.motionMedia?.removeEventListener) {
      this.motionMedia.removeEventListener("change", this.handleMotionPreferenceChange);
    } else if (this.motionMedia?.removeListener) {
      this.motionMedia.removeListener(this.handleMotionPreferenceChange);
    }
  }

  handleMotionPreferenceChange() {
    if (this.reducedMotion) {
      // Stop only future work. Finite rotations already in progress finish naturally.
      this.clearPendingSchedules();
      return;
    }

    if (!this.isSchedulingAllowed()) return;
    this.scheduleAllCards({ first: false });
    this.scheduleAmbientSparkle();
  }

  clearPendingSchedules() {
    for (const timerId of this.cardTimers.values()) {
      this.windowRef?.clearTimeout?.(timerId);
    }
    this.cardTimers.clear();

    if (this.sparkleTimer !== null) {
      this.windowRef?.clearTimeout?.(this.sparkleTimer);
      this.sparkleTimer = null;
    }
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
    if (!this.isSchedulingAllowed() || !this.sparkles.length) return;

    this.sparkles.forEach((sparkle, index) => {
      if (typeof sparkle.animate !== "function") return;
      const duration = randomInteger(this.random, 520, 760);
      const delay = index * 70 + randomInteger(this.random, 0, 90);
      sparkle.animate(
        [
          { opacity: 0, transform: "scale(.35) rotate(-16deg)" },
          { opacity: 1, transform: "scale(1.28) rotate(5deg)", offset: 0.48 },
          { opacity: 0, transform: "scale(.88) rotate(14deg)" }
        ],
        {
          duration,
          delay,
          easing: "cubic-bezier(.22, .78, .30, 1)",
          fill: "none"
        }
      );
    });
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

    sparkle.animate(
      [
        { opacity: 0, transform: "scale(.55) rotate(-8deg)" },
        { opacity: 0.82, transform: "scale(1.08) rotate(2deg)", offset: 0.46 },
        { opacity: 0, transform: "scale(.72) rotate(9deg)" }
      ],
      {
        duration,
        easing: "ease-out",
        fill: "none"
      }
    );
    return true;
  }
}
