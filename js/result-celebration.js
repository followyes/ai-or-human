const DEFAULT_OPTIONS = Object.freeze({
  firstTurnDelayMinMs: 1700,
  firstTurnDelayMaxMs: 3500,
  idleTurnDelayMinMs: 1800,
  idleTurnDelayMaxMs: 5200,
  oneTurnDurationMinMs: 1050,
  oneTurnDurationMaxMs: 1450,
  extraTurnDurationMinMs: 650,
  extraTurnDurationMaxMs: 900,
  firstAmbientFireworkDelayMinMs: 2200,
  firstAmbientFireworkDelayMaxMs: 3000,
  ambientFireworkDelayMinMs: 500,
  ambientFireworkDelayMaxMs: 1350,
  followUpFireworkChance: 0.62,
  secondFollowUpFireworkChance: 0.30,
  followUpFireworkDelayMinMs: 120,
  followUpFireworkDelayMaxMs: 360,
  fireworkParticleDurationMinMs: 1050,
  fireworkParticleDurationMaxMs: 1800,
  entryFireworkParticleDurationMinMs: 1300,
  entryFireworkParticleDurationMaxMs: 2100,
  fireworkParticleStaggerMinMs: 8,
  fireworkParticleStaggerMaxMs: 30,
  fireworkDistanceMinPx: 48,
  fireworkDistanceMaxPx: 120,
  fireworkCandidateAttempts: 32,
  ambientHaloDelayMinMs: 4000,
  ambientHaloDelayMaxMs: 8000,
  haloDurationMinMs: 1500,
  haloDurationMaxMs: 2200,
  ambientStarDelayMinMs: 4000,
  ambientStarDelayMaxMs: 9000,
  starDurationMinMs: 800,
  starDurationMaxMs: 1300
});

export const FIREWORK_FAMILIES = Object.freeze(["warm", "cool", "mixed"]);
export const FIREWORK_TONES = Object.freeze(["gold", "cream", "blue", "ice"]);

const FIREWORK_FAMILY_TONES = Object.freeze({
  warm: Object.freeze(["gold", "cream"]),
  cool: Object.freeze(["blue", "ice"]),
  mixed: Object.freeze(["gold", "blue", "cream", "ice"])
});

const FIREWORK_FALLBACK_POINTS = Object.freeze([
  Object.freeze({ x: 0.18, y: 0.18 }),
  Object.freeze({ x: 0.82, y: 0.22 }),
  Object.freeze({ x: 0.14, y: 0.50 }),
  Object.freeze({ x: 0.86, y: 0.50 }),
  Object.freeze({ x: 0.20, y: 0.78 }),
  Object.freeze({ x: 0.80, y: 0.78 })
]);

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

export function chooseFireworkParticleCount(random) {
  const roll = random();
  if (roll < 0.10) return 7;
  if (roll < 0.24) return 8;
  if (roll < 0.42) return 9;
  if (roll < 0.62) return 10;
  if (roll < 0.82) return 11;
  return 12;
}

export function chooseFireworkFamily(random) {
  const roll = random();
  if (roll < 0.42) return "warm";
  if (roll < 0.84) return "cool";
  return "mixed";
}

export function chooseFireworkTone(random, family = "warm", particleIndex = 0) {
  if (family === "mixed") {
    const mixedBase = particleIndex % 2 === 0 ? ["gold", "cream"] : ["blue", "ice"];
    return mixedBase[randomInteger(random, 0, mixedBase.length - 1)];
  }
  const tones = FIREWORK_FAMILY_TONES[family] ?? FIREWORK_FAMILY_TONES.warm;
  return tones[randomInteger(random, 0, tones.length - 1)];
}

export function expandRect(rect, padding = 0) {
  const safePadding = Math.max(0, Number(padding) || 0);
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const right = Number(rect?.right) || left + (Number(rect?.width) || 0);
  const bottom = Number(rect?.bottom) || top + (Number(rect?.height) || 0);
  return Object.freeze({
    left: left - safePadding,
    top: top - safePadding,
    right: right + safePadding,
    bottom: bottom + safePadding
  });
}

export function isPointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function isFireworkCenterSafe({ x, y, width, height, edgePadding, exclusions = [] }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < edgePadding || x > width - edgePadding || y < edgePadding || y > height - edgePadding) return false;
  return !exclusions.some((rect) => isPointInsideRect(x, y, rect));
}

export function createFireworkGeometry({ width, height, exclusionRects = [] } = {}) {
  const viewportWidth = Math.max(0, Number(width) || 0);
  const viewportHeight = Math.max(0, Number(height) || 0);
  const maxDistance = viewportWidth <= 340 ? 74 : viewportWidth <= 390 ? 92 : viewportWidth <= 430 ? 108 : 120;
  const edgePadding = viewportWidth <= 340 ? 18 : 22;
  const exclusionPadding = viewportWidth <= 340 ? 32 : 40;
  return Object.freeze({
    width: viewportWidth,
    height: viewportHeight,
    maxDistance,
    edgePadding,
    exclusions: Object.freeze(exclusionRects.map((rect) => expandRect(rect, exclusionPadding)))
  });
}

export function chooseFireworkCenter(random, geometry, attempts = 24) {
  const width = geometry?.width ?? 0;
  const height = geometry?.height ?? 0;
  const edgePadding = geometry?.edgePadding ?? 0;
  const exclusions = geometry?.exclusions ?? [];
  if (width <= edgePadding * 2 || height <= edgePadding * 2) return null;

  const maxAttempts = Math.max(1, Math.round(attempts));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const x = randomInteger(random, edgePadding, width - edgePadding);
    const y = randomInteger(random, edgePadding, height - edgePadding);
    if (isFireworkCenterSafe({ x, y, width, height, edgePadding, exclusions })) return { x, y };
  }

  const offset = randomInteger(random, 0, FIREWORK_FALLBACK_POINTS.length - 1);
  for (let index = 0; index < FIREWORK_FALLBACK_POINTS.length; index += 1) {
    const point = FIREWORK_FALLBACK_POINTS[(index + offset) % FIREWORK_FALLBACK_POINTS.length];
    const x = Math.round(width * point.x);
    const y = Math.round(height * point.y);
    if (isFireworkCenterSafe({ x, y, width, height, edgePadding, exclusions })) return { x, y };
  }
  return null;
}

export function createFireworkParticlePresentation(random, {
  index,
  count,
  family,
  maxDistance = 120,
  minDistance = 48
} = {}) {
  const particleCount = Math.max(1, Math.round(count || 1));
  const particleIndex = Math.max(0, Math.round(index || 0));
  const baseAngle = (360 / particleCount) * particleIndex;
  const jitter = randomInteger(random, -14, 14);
  const angle = baseAngle + jitter;
  const radians = angle * Math.PI / 180;
  const distance = randomInteger(random, Math.min(minDistance, maxDistance), Math.max(minDistance, maxDistance));
  const size = random() < 0.20 ? randomInteger(random, 14, 18) : randomInteger(random, 6, 13);
  const tone = chooseFireworkTone(random, family, particleIndex);
  return Object.freeze({
    angle,
    distance,
    dx: Math.round(Math.cos(radians) * distance),
    dy: Math.round(Math.sin(radians) * distance),
    size,
    rotation: randomInteger(random, -52, 52),
    tone
  });
}

function animationFinished(animation) {
  return Promise.resolve(animation?.finished).catch(() => undefined);
}

function resolveSurfaceTheme(surface) {
  return surface?.ownerDocument?.documentElement?.dataset?.theme === "dark" ? "dark" : "light";
}

function normalizeFireworkSlot(slot) {
  if (!slot) return null;
  if (slot.element && Array.isArray(slot.particles)) {
    return {
      element: slot.element,
      core: slot.core ?? null,
      particles: [...slot.particles]
    };
  }
  return {
    element: slot,
    core: slot.querySelector?.("[data-firework-core]") ?? null,
    particles: [...(slot.querySelectorAll?.("[data-firework-particle]") ?? [])]
  };
}

export class ResultCelebrationController {
  constructor({
    cardSurfaces = [],
    fireworkBursts = [],
    fireworkExclusions = [],
    halo = null,
    dividerStar = null,
    canSchedule = () => true,
    windowRef = globalThis.window,
    motionMedia = windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null,
    random = Math.random,
    options = {}
  } = {}) {
    this.cardSurfaces = [...cardSurfaces];
    this.fireworkSlots = fireworkBursts.map(normalizeFireworkSlot).filter(Boolean);
    this.fireworkExclusions = [...fireworkExclusions].filter(Boolean);
    this.halo = halo;
    this.dividerStar = dividerStar;
    this.canSchedule = canSchedule;
    this.windowRef = windowRef;
    this.motionMedia = motionMedia;
    this.random = random;
    this.options = Object.freeze({ ...DEFAULT_OPTIONS, ...options });

    this.active = false;
    this.cardTimers = new Map();
    this.activeCardAnimations = new Map();
    // A shared theme transaction may request a stable visual frame. This
    // lease suspends future decorative events but NEVER cancels active turns.
    this.visualHoldCount = 0;
    this.visualIdleWaiters = new Set();
    this.activeDecorationAnimations = new Set();
    this.activeFireworkSlots = new Set();
    this.fireworkEventTimers = new Set();
    this.ambientFireworkTimer = null;
    this.haloTimer = null;
    this.starTimer = null;
    this.fireworkGeometry = null;
    this.destroyed = false;

    this.handleMotionPreferenceChange = this.handleMotionPreferenceChange.bind(this);
    this.handleViewportChange = this.handleViewportChange.bind(this);
    if (this.motionMedia?.addEventListener) {
      this.motionMedia.addEventListener("change", this.handleMotionPreferenceChange);
    } else if (this.motionMedia?.addListener) {
      this.motionMedia.addListener(this.handleMotionPreferenceChange);
    }
    this.windowRef?.addEventListener?.("resize", this.handleViewportChange, { passive: true });
    this.windowRef?.addEventListener?.("orientationchange", this.handleViewportChange, { passive: true });
  }

  get reducedMotion() {
    return Boolean(this.motionMedia?.matches);
  }

  isSchedulingAllowed() {
    return !this.destroyed && this.active && this.visualHoldCount === 0 && !this.reducedMotion && Boolean(this.canSchedule?.());
  }

  enter() {
    if (this.destroyed) return false;
    this.active = true;
    this.updateFireworkGeometry();
    if (!this.isSchedulingAllowed()) return false;

    this.playEntryFireworks();
    this.playDividerFlare({ entry: true });
    this.scheduleAllCards({ first: true });
    this.scheduleAmbientFirework({ first: true });
    this.scheduleAmbientHalo();
    this.scheduleAmbientStar();
    return true;
  }

  leave() {
    this.active = false;
    this.clearPendingSchedules();
    return true;
  }

  // Screen-agnostic visual-stability lease for the canonical theme reveal.
  // Acquire synchronously so no new event can begin between the user's click
  // and the async waiting period. The lease is fulfilled only after every
  // already-started finite decoration is finished and the cards are flat.
  acquireVisualStability() {
    this.visualHoldCount += 1;
    this.clearPendingSchedules();
    const ready = new Promise((resolve) => {
      if (this.activeCardAnimations.size === 0 && this.activeDecorationAnimations.size === 0) {
        resolve();
      } else {
        this.visualIdleWaiters.add(resolve);
      }
    });
    let released = false;
    return {
      ready,
      release: () => {
        if (released) return;
        released = true;
        this.visualHoldCount = Math.max(0, this.visualHoldCount - 1);
        if (this.isSchedulingAllowed()) this.armPersistentSchedules();
      }
    };
  }

  notifyVisualIdle() {
    if (this.activeCardAnimations.size || this.activeDecorationAnimations.size) return;
    for (const resolve of this.visualIdleWaiters) resolve();
    this.visualIdleWaiters.clear();
  }

  destroy() {
    this.leave();
    this.destroyed = true;

    if (this.motionMedia?.removeEventListener) {
      this.motionMedia.removeEventListener("change", this.handleMotionPreferenceChange);
    } else if (this.motionMedia?.removeListener) {
      this.motionMedia.removeListener(this.handleMotionPreferenceChange);
    }
    this.windowRef?.removeEventListener?.("resize", this.handleViewportChange);
    this.windowRef?.removeEventListener?.("orientationchange", this.handleViewportChange);
  }

  handleViewportChange() {
    if (!this.active) return;
    this.updateFireworkGeometry();
  }

  handleMotionPreferenceChange() {
    if (this.reducedMotion) {
      this.clearPendingSchedules();
      return;
    }
    if (!this.isSchedulingAllowed()) return;
    this.updateFireworkGeometry();
    this.armPersistentSchedules();
  }

  trackDecorationAnimation(animation, onFinish = null) {
    if (!animation) return null;
    this.activeDecorationAnimations.add(animation);
    animationFinished(animation).finally(() => {
      this.activeDecorationAnimations.delete(animation);
      onFinish?.();
      this.notifyVisualIdle();
    });
    return animation;
  }

  clearPendingSchedules() {
    for (const timerId of this.cardTimers.values()) this.windowRef?.clearTimeout?.(timerId);
    this.cardTimers.clear();

    for (const timerId of this.fireworkEventTimers) this.windowRef?.clearTimeout?.(timerId);
    this.fireworkEventTimers.clear();
    this.ambientFireworkTimer = null;

    for (const timerKey of ["haloTimer", "starTimer"]) {
      const timerId = this[timerKey];
      if (timerId !== null) {
        this.windowRef?.clearTimeout?.(timerId);
        this[timerKey] = null;
      }
    }
  }

  armPersistentSchedules() {
    this.scheduleAllCards({ first: false });
    this.scheduleAmbientFirework({ first: false });
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
    const turnTheme = resolveSurfaceTheme(surface);
    surface.dataset.cardTurning = "true";
    surface.dataset.turnArtwork = turnTheme;

    let animation;
    try {
      animation = surface.animate(
        [{ transform: "rotateY(0deg) translateZ(0)" }, { transform: `rotateY(${angle}deg) translateZ(0)` }],
        { duration, easing: "cubic-bezier(.45, .05, .24, 1)", fill: "none" }
      );
    } catch {
      delete surface.dataset.cardTurning;
      delete surface.dataset.turnArtwork;
      const nextDelay = randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, nextDelay);
      return false;
    }

    this.activeCardAnimations.set(surface, animation);
    surface.dataset.resultTurnCard = String(index + 1);
    animationFinished(animation).finally(() => {
      if (this.activeCardAnimations.get(surface) === animation) this.activeCardAnimations.delete(surface);
      delete surface.dataset.resultTurnCard;
      delete surface.dataset.cardTurning;
      delete surface.dataset.turnArtwork;
      this.notifyVisualIdle();
      if (!this.isSchedulingAllowed()) return;
      const nextDelay = randomInteger(this.random, this.options.idleTurnDelayMinMs, this.options.idleTurnDelayMaxMs);
      this.scheduleCard(surface, index, nextDelay);
    });
    return true;
  }

  updateFireworkGeometry() {
    const width = Number(this.windowRef?.innerWidth) || 390;
    const height = Number(this.windowRef?.innerHeight) || 844;
    const exclusionRects = this.fireworkExclusions
      .filter((element) => !element.hidden)
      .map((element) => element.getBoundingClientRect?.())
      .filter((rect) => rect && Number(rect.width) > 0 && Number(rect.height) > 0);
    this.fireworkGeometry = createFireworkGeometry({ width, height, exclusionRects });
    return this.fireworkGeometry;
  }

  getIdleFireworkSlot() {
    const available = this.fireworkSlots.filter((slot) => !this.activeFireworkSlots.has(slot));
    if (!available.length) return null;
    return available[randomInteger(this.random, 0, available.length - 1)];
  }

  scheduleFireworkEvent(delayMs, callback) {
    if (!this.isSchedulingAllowed()) return null;
    const timerId = this.windowRef.setTimeout(() => {
      this.fireworkEventTimers.delete(timerId);
      if (!this.isSchedulingAllowed()) return;
      callback?.();
    }, Math.max(0, delayMs));
    this.fireworkEventTimers.add(timerId);
    return timerId;
  }

  playEntryFireworks() {
    if (!this.isSchedulingAllowed() || !this.fireworkSlots.length) return false;
    const delays = [
      randomInteger(this.random, 120, 220),
      randomInteger(this.random, 300, 440),
      randomInteger(this.random, 520, 700),
      randomInteger(this.random, 760, 980),
      randomInteger(this.random, 1040, 1280),
      randomInteger(this.random, 1360, 1640),
      randomInteger(this.random, 1740, 2050)
    ];
    delays.forEach((delay) => {
      this.scheduleFireworkEvent(delay, () => this.startFireworkBurst({ entry: true }));
    });
    return true;
  }

  scheduleAmbientFirework({ first = false } = {}) {
    if (!this.isSchedulingAllowed() || !this.fireworkSlots.length || this.ambientFireworkTimer !== null) return false;
    const delay = first
      ? randomInteger(this.random, this.options.firstAmbientFireworkDelayMinMs, this.options.firstAmbientFireworkDelayMaxMs)
      : randomInteger(this.random, this.options.ambientFireworkDelayMinMs, this.options.ambientFireworkDelayMaxMs);
    const timerId = this.scheduleFireworkEvent(delay, () => {
      if (this.ambientFireworkTimer === timerId) this.ambientFireworkTimer = null;
      this.playAmbientFireworkEvent();
      this.scheduleAmbientFirework({ first: false });
    });
    this.ambientFireworkTimer = timerId;
    return timerId !== null;
  }

  playAmbientFireworkEvent() {
    if (!this.isSchedulingAllowed()) return false;
    const started = this.startFireworkBurst({ entry: false });
    if (!started) return false;

    let followUpCount = 0;
    if (this.random() < this.options.followUpFireworkChance) followUpCount = 1;
    if (followUpCount && this.random() < this.options.secondFollowUpFireworkChance) followUpCount = 2;

    let accumulatedDelay = 0;
    for (let index = 0; index < followUpCount; index += 1) {
      accumulatedDelay += randomInteger(
        this.random,
        this.options.followUpFireworkDelayMinMs,
        this.options.followUpFireworkDelayMaxMs
      );
      this.scheduleFireworkEvent(accumulatedDelay, () => this.startFireworkBurst({ entry: false }));
    }
    return true;
  }

  startFireworkBurst({ entry = false } = {}) {
    if (!this.isSchedulingAllowed() || !this.fireworkSlots.length) return false;
    const slot = this.getIdleFireworkSlot();
    if (!slot || !slot.particles.length) return false;

    const geometry = this.fireworkGeometry ?? this.updateFireworkGeometry();
    const center = chooseFireworkCenter(this.random, geometry, this.options.fireworkCandidateAttempts);
    if (!center) return false;

    const family = chooseFireworkFamily(this.random);
    const particleCount = entry ? randomInteger(this.random, 10, 12) : chooseFireworkParticleCount(this.random);
    const activeParticles = slot.particles.slice(0, Math.min(12, particleCount));
    if (!activeParticles.length) return false;

    this.activeFireworkSlots.add(slot);
    slot.element.dataset.fireworkFamily = family;
    slot.element.dataset.fireworkActive = "true";
    slot.element.style?.setProperty?.("--firework-x", `${center.x}px`);
    slot.element.style?.setProperty?.("--firework-y", `${center.y}px`);

    const animations = [];
    if (slot.core && typeof slot.core.animate === "function") {
      const coreDuration = entry ? randomInteger(this.random, 1050, 1450) : randomInteger(this.random, 820, 1180);
      const coreAnimation = slot.core.animate(
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(.18)" },
          { opacity: 1, transform: `translate(-50%, -50%) scale(${entry ? 2.45 : 1.95})`, offset: 0.24 },
          { opacity: 0.72, transform: `translate(-50%, -50%) scale(${entry ? 3.05 : 2.50})`, offset: 0.52 },
          { opacity: 0, transform: `translate(-50%, -50%) scale(${entry ? 3.85 : 3.20})` }
        ],
        { duration: coreDuration, easing: "cubic-bezier(.16, .82, .22, 1)", fill: "none" }
      );
      animations.push(coreAnimation);
      this.trackDecorationAnimation(coreAnimation);
    }

    activeParticles.forEach((particle, index) => {
      if (typeof particle.animate !== "function") return;
      const presentation = createFireworkParticlePresentation(this.random, {
        index,
        count: activeParticles.length,
        family,
        maxDistance: Math.min(this.options.fireworkDistanceMaxPx, geometry.maxDistance),
        minDistance: this.options.fireworkDistanceMinPx
      });
      particle.dataset.fireworkTone = presentation.tone;
      particle.style?.setProperty?.("--firework-particle-size", `${presentation.size}px`);
      const duration = entry
        ? randomInteger(this.random, this.options.entryFireworkParticleDurationMinMs, this.options.entryFireworkParticleDurationMaxMs)
        : randomInteger(this.random, this.options.fireworkParticleDurationMinMs, this.options.fireworkParticleDurationMaxMs);
      const delay = index * randomInteger(
        this.random,
        this.options.fireworkParticleStaggerMinMs,
        this.options.fireworkParticleStaggerMaxMs
      );
      const rotateStart = presentation.rotation - 16;
      const rotateEnd = presentation.rotation + 22;
      const animation = particle.animate(
        [
          {
            opacity: 0,
            transform: `translate(-50%, -50%) translate3d(0px, 0px, 0) scale(.22) rotate(${rotateStart}deg)`
          },
          {
            opacity: 1,
            transform: `translate(-50%, -50%) translate3d(${Math.round(presentation.dx * 0.18)}px, ${Math.round(presentation.dy * 0.18)}px, 0) scale(1.42) rotate(${presentation.rotation}deg)`,
            offset: 0.18
          },
          {
            opacity: 0.84,
            transform: `translate(-50%, -50%) translate3d(${Math.round(presentation.dx * 0.72)}px, ${Math.round(presentation.dy * 0.72)}px, 0) scale(1.08) rotate(${presentation.rotation + 12}deg)`,
            offset: 0.62
          },
          {
            opacity: 0,
            transform: `translate(-50%, -50%) translate3d(${presentation.dx}px, ${presentation.dy}px, 0) scale(.44) rotate(${rotateEnd}deg)`
          }
        ],
        { duration, delay, easing: "cubic-bezier(.18, .78, .20, 1)", fill: "none" }
      );
      animations.push(animation);
      this.trackDecorationAnimation(animation);
    });

    if (!animations.length) {
      this.releaseFireworkSlot(slot);
      return false;
    }

    Promise.all(animations.map(animationFinished)).finally(() => this.releaseFireworkSlot(slot));
    return true;
  }

  releaseFireworkSlot(slot) {
    if (!slot) return;
    this.activeFireworkSlots.delete(slot);
    delete slot.element.dataset.fireworkActive;
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
