/** Small, non-blocking streak toast after the ordinary answer feedback.
 * The gameplay controller never awaits this message before revealing a card.
 * It owns no score, deadline, card motion or input locks. */
const DURATIONS = Object.freeze({
  3: { normal: 1450, reduced: 1300 },
  10: { normal: 1650, reduced: 1450 }
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
      try { animation.cancel(); } catch { /* Animation may have completed. */ }
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

    this.heading.textContent = major ? "Świetna robota!" : "Super Ci idzie!";
    this.count.textContent = `${milestone} trafienia z rzędu`;
    if (major) this.count.textContent = "10 trafień z rzędu";
    this.symbol.textContent = major ? "✦" : "★";
    this.root.classList.add("is-active");
    if (major) this.root.classList.add("is-major");
    this.root.dataset.milestone = String(milestone);
    this.root.setAttribute("aria-hidden", "false");

    const toast = this.root.animate([
      { opacity: 0, transform: "translate3d(-50%, -10px, 0)", offset: 0 },
      { opacity: 1, transform: "translate3d(-50%, 0, 0)", offset: reduced ? .08 : .14 },
      { opacity: 1, transform: "translate3d(-50%, 0, 0)", offset: .76 },
      { opacity: 0, transform: "translate3d(-50%, -6px, 0)", offset: 1 }
    ], { duration, easing: "ease-out", fill: "forwards" });
    this.animations = [toast];
    try {
      await toast.finished;
    } catch {
      // Session reset or a subsequent toast cancelled this notification.
    }
    if (revision !== this.revision) return false;
    this.clear();
    return true;
  }
}
