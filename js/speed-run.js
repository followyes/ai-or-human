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

// Rolling, bounded prefetch. Preloads in a new cycle may overlap with the
// current cycle, but each item is issued once per cycle. Broken images are
// retired from the current run, rather than showing a broken card.
export class SpeedRunDeck {
  constructor(images, { preload, rng = Math.random, ahead = 3 } = {}) {
    if (!Array.isArray(images) || !images.length || typeof preload !== "function") {
      throw new TypeError("SpeedRunDeck requires images and a preload function");
    }
    if (!Number.isInteger(ahead) || ahead < 1) throw new RangeError("ahead must be positive");
    this.images = [...images];
    this.preload = preload;
    this.rng = rng;
    this.ahead = Math.min(ahead, images.length);
    this.invalidIds = new Set();
    this.cycle = [];
    this.cursor = 0;
    this.lastIssuedId = null;
    this.pending = [];
    this.cancelled = false;
  }

  shuffle() {
    const items = this.images.filter((item) => !this.invalidIds.has(item.id));
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.rng() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    if (items.length > 1 && items[0].id === this.lastIssuedId) {
      [items[0], items[1]] = [items[1], items[0]];
    }
    this.cycle = items;
    this.cursor = 0;
  }

  issue() {
    if (this.cancelled) return null;
    if (this.cursor >= this.cycle.length) this.shuffle();
    while (this.cursor < this.cycle.length) {
      const item = this.cycle[this.cursor++];
      if (this.invalidIds.has(item.id)) continue;
      this.lastIssuedId = item.id;
      return item;
    }
    // Remaining images may have failed after the cycle was made.
    this.shuffle();
    const item = this.cycle[this.cursor++];
    if (item) {
      this.lastIssuedId = item.id;
    }
    return item ?? null;
  }

  fill() {
    while (!this.cancelled && this.pending.length < this.ahead) {
      const item = this.issue();
      if (!item) break;
      const result = Promise.resolve()
        .then(() => this.preload(item.src))
        .then(() => (this.cancelled ? null : item))
        .catch(() => {
          this.invalidIds.add(item.id);
          return null;
        });
      this.pending.push(result);
    }
  }

  async next() {
    while (!this.cancelled) {
      this.fill();
      if (!this.pending.length) throw new Error("Brak dostępnych obrazów do Speed Run.");
      const item = await this.pending.shift();
      if (this.cancelled) return null;
      this.fill();
      if (item && !this.invalidIds.has(item.id)) return item;
      if (this.invalidIds.size >= this.images.length) {
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
