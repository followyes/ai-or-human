/** Visual-only login examples. They never become the input value or a saved name. */
export const LOGIN_EXAMPLES = Object.freeze([
  "PixelFox", "NeonRider", "CyberWolf", "NovaByte",
  "StarPilot", "Quantum7", "ByteNinja"
]);

export function containsLoginWhitespace(value) {
  return typeof value === "string" && /\s/u.test(value);
}

export function rejectWhitespaceEdit(proposed, previous = "") {
  return containsLoginWhitespace(proposed) ? previous : proposed;
}

export class LoginPlaceholderController {
  constructor(input, {
    aliases = LOGIN_EXAMPLES,
    rng = Math.random,
    reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer)
  } = {}) {
    if (!input || !Array.isArray(aliases) || aliases.length === 0) {
      throw new TypeError("LoginPlaceholderController requires an input and aliases");
    }
    this.input = input;
    this.rng = rng;
    this.aliases = [...aliases];
    this.reducedMotion = reducedMotion;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.running = false;
    this.position = 0;
    this.characters = 0;
    this.phase = "typing";
    this.order = [];
  }

  shuffle() {
    this.order = [...this.aliases];
    for (let index = this.order.length - 1; index > 0; index -= 1) {
      const random = this.rng();
      const swap = Number.isFinite(random) ? Math.max(0, Math.min(index, Math.floor(random * (index + 1)))) : 0;
      [this.order[index], this.order[swap]] = [this.order[swap], this.order[index]];
    }
  }

  start() {
    this.stop();
    if (this.input.readOnly || this.input.value) return;
    this.shuffle();
    if (this.reducedMotion()) {
      this.input.placeholder = this.order[0];
      return;
    }
    this.running = true;
    this.position = 0;
    this.characters = 0;
    this.phase = "typing";
    this.tick();
  }

  tick() {
    if (!this.running || this.input.readOnly || this.input.value) {
      this.stop();
      return;
    }
    const alias = this.order[this.position];
    let delay = 75;
    if (this.phase === "typing") {
      this.characters += 1;
      if (this.characters >= alias.length) {
        this.characters = alias.length;
        this.phase = "holding";
        delay = 900;
      }
    } else if (this.phase === "holding") {
      this.phase = "deleting";
      delay = 55;
    } else {
      this.characters = Math.max(0, this.characters - 1);
      delay = 45;
      if (this.characters === 0) {
        this.position = (this.position + 1) % this.order.length;
        this.phase = "typing";
        delay = 260;
      }
    }
    this.input.placeholder = alias.slice(0, this.characters);
    this.timer = this.schedule(() => this.tick(), delay);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.input.placeholder = "Login";
  }

  destroy() { this.stop(); }
}
