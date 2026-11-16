// Speed Run rules are isolated from the classic fixed-session rules.
export const SPEED_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ id: "easy", label: "Łatwy", seconds: 7, lives: 3 }),
  medium: Object.freeze({ id: "medium", label: "Średni", seconds: 5, lives: 2 }),
  hard: Object.freeze({ id: "hard", label: "Trudny", seconds: 3, lives: 1 })
});

export const DEFAULT_SPEED_DIFFICULTY = "medium";

export function getSpeedDifficulty(id) {
  return SPEED_DIFFICULTIES[id] ?? null;
}

export function createSpeedRunState(difficultyId) {
  const difficulty = getSpeedDifficulty(difficultyId);
  if (!difficulty) throw new RangeError(`Unsupported Speed Run difficulty: ${difficultyId}`);
  return { difficultyId, score: 0, lives: difficulty.lives, attempts: 0, finished: false };
}

export function resolveSpeedRunOutcome(state, outcome) {
  if (!state || state.finished || !["correct", "incorrect", "timeout"].includes(outcome)) {
    throw new Error("Speed Run cannot resolve this outcome");
  }
  const lives = outcome === "correct" ? state.lives : Math.max(0, state.lives - 1);
  return {
    ...state,
    score: state.score + Number(outcome === "correct"),
    attempts: state.attempts + 1,
    lives,
    finished: lives === 0
  };
}

// Presentation is a projection of the existing monotonic deadline, never an
// independent timer. The 2-second warning is independent of difficulty.
export function getSpeedTimerView(remainingMs, totalMs) {
  if (!Number.isFinite(remainingMs) || !Number.isFinite(totalMs) || totalMs <= 0) {
    throw new RangeError("Invalid Speed Run timer values");
  }
  const remaining = Math.max(0, Math.min(totalMs, remainingMs));
  const seconds = Math.ceil(remaining / 100) / 10;
  return {
    progress: remaining / totalMs,
    display: `${seconds.toFixed(1).replace(".", ",")} s`,
    ariaSeconds: Math.ceil(remaining / 1000),
    urgency: remaining > 0 && remaining <= 1000 ? "critical" :
      remaining > 0 && remaining <= 2000 ? "urgent" : "normal"
  };
}

// Deadline is based on the monotonic clock. The click path checks the deadline
// synchronously, independent from RAF throttling when a browser is backgrounded.
export class SpeedDeadlineClock {
  constructor({ now = () => performance.now(), requestFrame = (cb) => requestAnimationFrame(cb), cancelFrame = (id) => cancelAnimationFrame(id) } = {}) {
    this.now = now;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.frame = null;
    this.deadline = null;
    this.onTick = null;
    this.onExpire = null;
    this.generation = 0;
  }

  start(seconds, { onTick, onExpire }) {
    if (!(seconds > 0) || !Number.isFinite(seconds)) throw new RangeError("seconds must be positive");
    this.stop();
    const generation = this.generation;
    this.deadline = this.now() + seconds * 1000;
    this.onTick = onTick;
    this.onExpire = onExpire;
    const tick = () => {
      if (generation !== this.generation || this.deadline === null) return;
      const remaining = Math.max(0, this.deadline - this.now());
      this.onTick?.(remaining, seconds * 1000);
      if (remaining === 0) {
        const expire = this.onExpire;
        this.stop();
        expire?.();
        return;
      }
      this.frame = this.requestFrame(tick);
    };
    tick();
  }

  // Called before handling every answer, including a pending touch/swipe decision.
  // A late answer always loses to the deadline, even if RAF did not run.
  claimBeforeDeadline() {
    if (this.deadline === null) return false;
    if (this.now() >= this.deadline) {
      const expire = this.onExpire;
      this.stop();
      expire?.();
      return false;
    }
    this.stop();
    return true;
  }

  check() {
    if (this.deadline !== null && this.now() >= this.deadline) {
      const expire = this.onExpire;
      this.stop();
      expire?.();
    }
  }

  stop() {
    this.generation += 1;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.deadline = null;
    this.onTick = null;
    this.onExpire = null;
  }
}

// Bounded prefetch driven by the same Player ID rotation as Classic.
// Pending images are only virtual exposures. Only the game's successful reveal
// commits to ImageRotation; cancelled / failed preload never consumes an image.
export class SpeedRunDeck {
  constructor(rotation, { preload, ahead = 3 } = {}) {
    if (!rotation || typeof rotation.select !== "function" ||
        !Array.isArray(rotation.images) || !rotation.images.length || typeof preload !== "function") {
      throw new TypeError("SpeedRunDeck requires an ImageRotation and preload function");
    }
    if (!Number.isInteger(ahead) || ahead < 1) throw new RangeError("ahead must be positive");
    this.rotation = rotation;
    this.preload = preload;
    this.ahead = Math.min(ahead, rotation.images.length);
    this.invalidIds = new Set();
    this.pending = [];
    this.cancelled = false;
  }

  fill() {
    while (!this.cancelled && this.pending.length < this.ahead) {
      let item;
      try {
        item = this.rotation.select(1, {
          priorIds: this.pending.map((entry) => entry.item.id),
          invalidIds: this.invalidIds
        })[0];
      } catch {
        // Every eligible image may already be reserved by bounded prefetch.
        break;
      }
      if (!item) break;
      const promise = Promise.resolve()
        .then(() => this.preload(item.src))
        .then(() => this.cancelled ? null : item)
        .catch(() => {
          this.invalidIds.add(item.id);
          return null;
        });
      this.pending.push({ item, promise });
    }
  }

  async next() {
    while (!this.cancelled) {
      this.fill();
      if (!this.pending.length) throw new Error("Brak dostępnych obrazów do Speed Run.");
      const entry = this.pending.shift();
      const item = await entry.promise;
      if (this.cancelled) return null;
      // Do not fill here: the returned card has not yet been revealed, so its
      // ID has not been recorded. The next() call follows the reveal in game.js.
      if (item && !this.invalidIds.has(item.id)) return item;
      if (this.invalidIds.size >= this.rotation.images.length) {
        throw new Error("Nie udało się pobrać żadnego poprawnego obrazu do Speed Run.");
      }
    }
    return null;
  }

  cancel() {
    this.cancelled = true;
    this.pending.length = 0;
  }
}
