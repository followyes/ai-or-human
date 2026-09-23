const DEFAULTS = Object.freeze({
  duration: 430,
  reducedDuration: 120
});

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export class AnswerFeedbackController {
  constructor(root, { options = {} } = {}) {
    if (!root) throw new Error("AnswerFeedbackController requires a root element");

    this.root = root;
    this.icon = root.querySelector("[data-feedback-icon]");
    this.label = root.querySelector("[data-feedback-label]");
    this.ring = root.querySelector("[data-feedback-ring]");
    this.options = { ...DEFAULTS, ...options };
    this.animations = [];
    this.revision = 0;
  }

  clear() {
    this.revision += 1;

    for (const animation of this.animations) {
      try {
        animation.cancel();
      } catch {
        // Already finished/cancelled.
      }
    }

    this.animations = [];
    this.root.classList.remove("is-active", "is-correct", "is-incorrect");
    this.root.setAttribute("aria-hidden", "true");
    this.root.removeAttribute("data-result");

    if (this.icon) this.icon.textContent = "";
    if (this.label) this.label.textContent = "";
  }

  async play(correct) {
    this.clear();

    const revision = ++this.revision;
    const reduced = prefersReducedMotion();
    const duration = reduced ? this.options.reducedDuration : this.options.duration;
    const stateClass = correct ? "is-correct" : "is-incorrect";

    this.root.classList.add("is-active", stateClass);
    this.root.dataset.result = correct ? "correct" : "incorrect";
    this.root.setAttribute("aria-hidden", "false");

    if (this.icon) this.icon.textContent = correct ? "✓" : "×";
    if (this.label) this.label.textContent = correct ? "DOBRZE" : "ŹLE";

    if (reduced) {
      const animation = this.root.animate(
        [
          { opacity: 0, transform: "translate3d(0,0,0) scale(.98)" },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.18 },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.72 },
          { opacity: 0, transform: "translate3d(0,0,0) scale(1)" }
        ],
        { duration, easing: "ease-out", fill: "forwards" }
      );
      this.animations = [animation];
    } else {
      const frames = correct
        ? [
            { opacity: 0, transform: "translate3d(0,0,0) scale(.90)" },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1.03)", offset: 0.22 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.72 },
            { opacity: 0, transform: "translate3d(0,0,0) scale(1.02)" }
          ]
        : [
            { opacity: 0, transform: "translate3d(0,0,0) scale(.96)" },
            { opacity: 1, transform: "translate3d(-7px,0,0) scale(1)", offset: 0.16 },
            { opacity: 1, transform: "translate3d(7px,0,0) scale(1)", offset: 0.28 },
            { opacity: 1, transform: "translate3d(-4px,0,0) scale(1)", offset: 0.40 },
            { opacity: 1, transform: "translate3d(4px,0,0) scale(1)", offset: 0.52 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.72 },
            { opacity: 0, transform: "translate3d(0,0,0) scale(1)" }
          ];

      const main = this.root.animate(frames, {
        duration,
        easing: "cubic-bezier(.2,.75,.3,1)",
        fill: "forwards"
      });

      const ring = this.ring?.animate(
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(.72)" },
          { opacity: .9, transform: "translate(-50%, -50%) scale(.92)", offset: 0.18 },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.35)" }
        ],
        { duration, easing: "cubic-bezier(.15,.7,.25,1)", fill: "forwards" }
      );

      this.animations = ring ? [main, ring] : [main];
    }

    try {
      await Promise.all(this.animations.map((animation) => animation.finished));
    } catch {
      // A new transition may intentionally cancel the feedback.
    }

    if (revision !== this.revision) return false;

    this.clear();
    return true;
  }
}
