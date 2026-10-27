/** A distinct reward phase AFTER ordinary correct-answer feedback.
 * No scoring, timer or card motion is owned by this controller. */
const DURATIONS = Object.freeze({
  3: { normal: 1750, reduced: 1650 },
  10: { normal: 2300, reduced: 2000 }
});

export class StreakCelebrationController {
  constructor(root) {
    if (!root) throw new Error("StreakCelebrationController requires a root element");
    this.root = root;
    this.count = root.querySelector("[data-streak-count]");
    this.heading = root.querySelector("[data-streak-heading]");
    this.symbol = root.querySelector("[data-streak-symbol]");
    this.animations = [];
    this.revision = 0;
  }

  clear() {
    ++this.revision;
    for (const animation of this.animations) {
      try { animation.cancel(); } catch { /* Already ended. */ }
    }
    this.animations = [];
    this.root.classList.remove("is-active", "is-major");
    this.root.setAttribute("aria-hidden", "true");
    this.root.removeAttribute("data-milestone");
  }

  async play(milestone) {
    if (!Object.hasOwn(DURATIONS, milestone)) return true;
    this.clear();
    const revision = ++this.revision;
    const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const duration = DURATIONS[milestone][reduced ? "reduced" : "normal"];
    const major = milestone === 10;

    this.root.classList.add("is-active");
    if (major) this.root.classList.add("is-major");
    this.root.dataset.milestone = String(milestone);
    this.count.textContent = `${milestone} Z RZĘDU`;
    this.heading.textContent = major ? "NIESAMOWITA SERIA!" : "DOBRA ROBOTA!";
    this.symbol.textContent = major ? "🏆" : "★";
    this.root.setAttribute("aria-hidden", "false");

    const overlay = this.root.animate([
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: .12 },
      { opacity: 1, offset: .85 },
      { opacity: 0, offset: 1 }
    ], { duration, easing: "ease-out", fill: "forwards" });
    this.animations = [overlay];

    if (!reduced) {
      const emblem = this.root.querySelector("[data-streak-emblem]");
      const text = this.root.querySelector("[data-streak-message]");
      const glints = [...this.root.querySelectorAll("[data-streak-glint]")];
      const emblemMotion = emblem?.animate([
        { opacity: 0, transform: "translateY(18px) scale(.55) rotate(-16deg)" },
        { opacity: 1, transform: "translateY(-5px) scale(1.12) rotate(5deg)", offset: .22 },
        { opacity: 1, transform: "translateY(0) scale(1) rotate(0deg)", offset: .43 },
        { opacity: 1, transform: "translateY(0) scale(1) rotate(0deg)" }
      ], { duration, easing: "cubic-bezier(.18,.8,.23,1)", fill: "forwards" });
      const textMotion = text?.animate([
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 0, transform: "translateY(12px)", offset: .12 },
        { opacity: 1, transform: "translateY(0)", offset: .3 },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration, easing: "ease-out", fill: "forwards" });
      this.animations.push(...[emblemMotion, textMotion].filter(Boolean));
      for (const [index, glint] of glints.entries()) {
        this.animations.push(glint.animate([
          { opacity: 0, transform: "translate3d(0,12px,0) scale(.45) rotate(0deg)" },
          { opacity: 1, transform: "translate3d(0,-10px,0) scale(1.12) rotate(35deg)", offset: .3 },
          { opacity: .65, transform: "translate3d(0,-24px,0) scale(.8) rotate(65deg)", offset: .6 },
          { opacity: 0, transform: "translate3d(0,-38px,0) scale(.4) rotate(90deg)" }
        ], { duration: major ? 1300 : 1000, delay: 110 + index * 85, easing: "ease-out", fill: "both" }));
      }
    }

    try {
      await Promise.all(this.animations.map((animation) => animation.finished));
    } catch {
      // A new game or error screen can cancel the reward without advancing the card.
    }
    if (revision !== this.revision) return false;
    this.clear();
    return true;
  }
}
