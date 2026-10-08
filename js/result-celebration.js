const DEFAULT_OPTIONS = Object.freeze({
  firstTurnDelayMinMs: 1700,
  firstTurnDelayMaxMs: 3500,
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
  sparkleClusterStaggerMinMs: 90,
  sparkleClusterStaggerMaxMs: 220,
  entrySparkleCountMin: 6,
  entrySparkleCountMax: 8,
  ambientHaloDelayMinMs: 4000,
  ambientHaloDelayMaxMs: 8000,
  haloDurationMinMs: 1500,
  haloDurationMaxMs: 2200,
  ambientStarDelayMinMs: 4000,
  ambientStarDelayMaxMs: 9000,
  starDurationMinMs: 800,
  starDurationMaxMs: 1300
});

export const SPARKLE_SAFE_ZONES = Object.freeze([
  Object.freeze({ id: "upper-left", xMin: 5, xMax: 28, yMin: 7, yMax: 28 }),
  Object.freeze({ id: "upper-center", xMin: 37, xMax: 63, yMin: 2, yMax: 12 }),
  Object.freeze({ id: "upper-right", xMin: 72, xMax: 95, yMin: 7, yMax: 28 }),
  Object.freeze({ id: "mid-left", xMin: 3, xMax: 23, yMin: 32, yMax: 69 }),
  Object.freeze({ id: "mid-right", xMin: 77, xMax: 97, yMin: 32, yMax: 69 })
]);

export const SPARKLE_TONES = Object.freeze(["gold", "blue", "cream", "ice"]);

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

export function chooseSparkleClusterCount(random) {
  const roll = random();
  if (roll < 0.68) return 1;
  if (roll < 0.93) return 2;
  return 3;
}

export function chooseSparkleTone(random) {
  const roll = random();
  if (roll < 0.46) return "gold";
  if (roll < 0.75) return "blue";
  if (roll < 0.90) return "cream";
  return "ice";
}

export function createSparklePresentation(random) {
  const zone = SPARKLE_SAFE_ZONES[randomInteger(random, 0, SPARKLE_SAFE_ZONES.length - 1)];
  return {
    zoneId: zone.id,
    x: randomInteger(random, zone.xMin, zone.xMax),
    y: randomInteger(random, zone.yMin, zone.yMax),
    size: randomInteger(random, 8, 15),
    rotation: randomInteger(random, -24, 24),
    tone: chooseSparkleTone(random)
  };
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
    this.activeSparkleSlots = new Set();
    this.sparkleStartTimers = new Map();
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
      this.clearPendingSchedules();
      return;
    }
    if (!this.isSchedulingAllowed()) return;
    this.armPersistentSchedules();
  }

  suspendForThemeTransition({ pauseActiveAnimations = true } = {}) {
    if (this.destroyed || this.suspended) return false;
    this.suspended = true;
    this.clearPendingSchedules();
    if (pauseActiveAnimations) this.pauseActiveAnimations();
    return true;
  }

  get hasActiveAnimations() {
    return this.activeCardAnimations.size > 0 || this.activeDecorationAnimations.size > 0;
  }

  resumeAfterThemeTransition() {
    if (this.destroyed || !this.suspended) return false;
    this.suspended = false;
    this.resumePausedAnimations();
    if (this.isSchedulingAllowed()) this.armPersistentSchedules();
    return true;
  }

  pauseActiveAnimations() {
    const activeAnimations = [...this.activeCardAnimations.values(), ...this.activeDecorationAnimations];
    for (const animation of activeAnimations) {
      if (!canPauseAnimation(animation)) continue;
      const playState = animation.playState;
      if (playState === "finished" || playState === "idle") continue;
      try {
        animation.pause();
        this.pausedAnimations.add(animation);
      } catch {}
    }
  }

  resumePausedAnimations() {
    for (const animation of this.pausedAnimations) {
      if (!canPauseAnimation(animation)) continue;
      const playState = animation.playState;
      if (playState === "finished" || playState === "idle") continue;
      try { animation.play(); } catch {}
    }
    this.pausedAnimations.clear();
  }

  trackDecorationAnimation(animation, onFinish = null) {
    if (!animation) return null;
    this.activeDecorationAnimations.add(animation);
    animationFinished(animation).finally(() => {
      this.activeDecorationAnimations.delete(animation);
      this.pausedAnimations.delete(animation);
      onFinish?.();
    });
    return animation;
  }

  clearPendingSchedules() {
    for (const timerId of this.cardTimers.values()) this.windowRef?.clearTimeout?.(timerId);
    this.cardTimers.clear();

    for (const [timerId, sparkle] of this.sparkleStartTimers) {
      this.windowRef?.clearTimeout?.(timerId);
      this.activeSparkleSlots.delete(sparkle);
    }
    this.sparkleStartTimers.clear();

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
    if (!surface || !this.isSchedulingAllowed() || this.cardTimers.has(surface) || this.activeCardAnimations.has(surface)) return false;
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
    const duration = randomInteger(this.random, this.options.oneTurnDurationMinMs, this.options.oneTurnDurationMaxMs)
      + (turns - 1) * randomInteger(this.random, this.options.extraTurnDurationMinMs, this.options.extraTurnDurationMaxMs);
    const animation = surface.animate(
      [{ transform: "rotateY(0deg) translateZ(0)" }, { transform: `rotateY(${angle}deg) translateZ(0)` }],
      { duration, easing: "cubic-bezier(.45, .05, .24, 1)", fill: "none" }
    );

    this.activeCardAnimations.set(surface, animation);
    surface.dataset.resultTurnCard = String(index + 1);
    animationFinished(animation).finally(() => {
      if (this.activeCardAnimations.get(surface) === animation) this.activeCardAnimations.delete(surface);
      this.pausedAnimations.delete(animation);
      delete surface.dataset.resultTurnCard;
      if (!this.isSchedulingAllowed()) return;
      const nextDelay = randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, nextDelay);
    });
    return true;
  }

  getIdleSparkleSlots() {
    return this.sparkles.filter((sparkle) => !this.activeSparkleSlots.has(sparkle));
  }

  reserveSparkleSlots(requestedCount) {
    const available = this.getIdleSparkleSlots();
    const count = Math.min(Math.max(0, requestedCount), available.length);
    const reserved = [];
    for (let i = 0; i < count; i += 1) {
      const pickIndex = randomInteger(this.random, 0, available.length - 1);
      const [sparkle] = available.splice(pickIndex, 1);
      this.activeSparkleSlots.add(sparkle);
      reserved.push(sparkle);
    }
    return reserved;
  }

  prepareSparkleSlot(sparkle) {
    if (!sparkle) return null;
    const presentation = createSparklePresentation(this.random);
    sparkle.dataset.sparkleTone = presentation.tone;
    sparkle.dataset.sparkleZone = presentation.zoneId;
    sparkle.style?.setProperty?.("--sparkle-x", `${presentation.x}%`);
    sparkle.style?.setProperty?.("--sparkle-y", `${presentation.y}%`);
    sparkle.style?.setProperty?.("--sparkle-size", `${presentation.size}px`);
    return presentation;
  }

  releaseSparkleSlot(sparkle) {
    if (!sparkle) return;
    this.activeSparkleSlots.delete(sparkle);
  }

  scheduleSparkleStart(sparkle, delayMs, { entry = false } = {}) {
    if (!sparkle || !this.activeSparkleSlots.has(sparkle)) return false;
    if (delayMs <= 0) return this.startSparkleAnimation(sparkle, { entry });

    const timerId = this.windowRef.setTimeout(() => {
      this.sparkleStartTimers.delete(timerId);
      if (!this.isSchedulingAllowed()) {
        this.releaseSparkleSlot(sparkle);
        return;
      }
      this.startSparkleAnimation(sparkle, { entry });
    }, delayMs);
    this.sparkleStartTimers.set(timerId, sparkle);
    return true;
  }

  startSparkleAnimation(sparkle, { entry = false } = {}) {
    if (!sparkle || typeof sparkle.animate !== "function") {
      this.releaseSparkleSlot(sparkle);
      return false;
    }

    const presentation = this.prepareSparkleSlot(sparkle);
    const duration = entry
      ? randomInteger(this.random, 1180, 1700)
      : randomInteger(this.random, this.options.sparkleDurationMinMs, this.options.sparkleDurationMaxMs);
    const baseRotation = presentation?.rotation ?? 0;
    const peakScale = entry ? 1.68 : 1.34;
    const peakOpacity = entry ? 1 : 0.94;

    const animation = sparkle.animate(
      [
        { opacity: 0, transform: `scale(.28) rotate(${baseRotation - 18}deg)` },
        { opacity: peakOpacity, transform: `scale(${peakScale}) rotate(${baseRotation + 5}deg)`, offset: entry ? 0.42 : 0.46 },
        { opacity: entry ? 0.62 : 0.52, transform: `scale(${entry ? 1.16 : 1.02}) rotate(${baseRotation + 12}deg)`, offset: 0.70 },
        { opacity: 0, transform: `scale(.74) rotate(${baseRotation + 22}deg)` }
      ],
      { duration, easing: "cubic-bezier(.18, .82, .24, 1)", fill: "none" }
    );
    this.trackDecorationAnimation(animation, () => this.releaseSparkleSlot(sparkle));
    return true;
  }

  playEntrySparkles() {
    if (!this.isSchedulingAllowed() || !this.sparkles.length) return false;
    const requestedCount = randomInteger(this.random, this.options.entrySparkleCountMin, this.options.entrySparkleCountMax);
    const slots = this.reserveSparkleSlots(requestedCount);
    slots.forEach((sparkle, index) => {
      const stagger = index === 0 ? 0 : index * randomInteger(this.random, 105, 185);
      this.scheduleSparkleStart(sparkle, stagger, { entry: true });
    });
    return slots.length > 0;
  }

  scheduleAmbientSparkle() {
    if (!this.isSchedulingAllowed() || !this.sparkles.length || this.sparkleTimer !== null) return false;
    const delay = randomInteger(this.random, this.options.ambientSparkleDelayMinMs, this.options.ambientSparkleDelayMaxMs);
    this.sparkleTimer = this.windowRef.setTimeout(() => {
      this.sparkleTimer = null;
      if (!this.isSchedulingAllowed()) return;
      this.playAmbientSparkleEvent();
      this.scheduleAmbientSparkle();
    }, delay);
    return true;
  }

  playAmbientSparkleEvent() {
    if (!this.isSchedulingAllowed()) return false;
    const slots = this.reserveSparkleSlots(chooseSparkleClusterCount(this.random));
    slots.forEach((sparkle, index) => {
      const stagger = index === 0 ? 0 : index * randomInteger(
        this.random,
        this.options.sparkleClusterStaggerMinMs,
        this.options.sparkleClusterStaggerMaxMs
      );
      this.scheduleSparkleStart(sparkle, stagger, { entry: false });
    });
    return slots.length > 0;
  }

  scheduleAmbientHalo() {
    if (!this.isSchedulingAllowed() || !this.halo || this.haloTimer !== null) return false;
    const delay = randomInteger(this.random, this.options.ambientHaloDelayMinMs, this.options.ambientHaloDelayMaxMs);
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
    const duration = randomInteger(this.random, this.options.haloDurationMinMs, this.options.haloDurationMaxMs);
    const animation = this.halo.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(.86)" },
        { opacity: 0.34, transform: "translate(-50%, -50%) scale(1.02)", offset: 0.46 },
        { opacity: 0.14, transform: "translate(-50%, -50%) scale(1.08)", offset: 0.72 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.16)" }
      ],
      { duration, easing: "cubic-bezier(.22, .70, .28, 1)", fill: "none" }
    );
    this.trackDecorationAnimation(animation);
    return true;
  }

  scheduleAmbientStar() {
    if (!this.isSchedulingAllowed() || !this.dividerStar || this.starTimer !== null) return false;
    const delay = randomInteger(this.random, this.options.ambientStarDelayMinMs, this.options.ambientStarDelayMaxMs);
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
      { duration, easing: "cubic-bezier(.18, .82, .24, 1)", fill: "none" }
    );
    this.trackDecorationAnimation(animation);
    return true;
  }
}
