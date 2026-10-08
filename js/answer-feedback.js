const DEFAULTS = Object.freeze({
  duration: 950,
  reducedDuration: 700
});

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function compactAnimations(...animations) {
  return animations.filter(Boolean);
}

export class AnswerFeedbackController {
  constructor(root, { options = {} } = {}) {
    if (!root) throw new Error("AnswerFeedbackController requires a root element");

    this.root = root;
    this.icon = root.querySelector("[data-feedback-icon]");
    this.label = root.querySelector("[data-feedback-label]");
    this.ring = root.querySelector("[data-feedback-ring]");
    this.burst = root.querySelector("[data-feedback-burst]");
    this.pill = root.querySelector("[data-feedback-pill]");
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
          { opacity: 0, transform: "translate3d(0,0,0) scale(.995)" },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.14 },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.80 },
          { opacity: 0, transform: "translate3d(0,0,0) scale(1)" }
        ],
        { duration, easing: "ease-out", fill: "forwards" }
      );
      this.animations = [animation];
    } else {
      const main = this.root.animate(
        [
          { opacity: 0, transform: "translate3d(0,0,0) scale(.985)" },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.12 },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.78 },
          { opacity: 0, transform: "translate3d(0,0,0) scale(1.008)" }
        ],
        { duration, easing: "cubic-bezier(.2,.75,.3,1)", fill: "forwards" }
      );

      const ringFrames = correct
        ? [
            { opacity: 0, transform: "translate(-50%, -50%) scale(.56)" },
            { opacity: 1, transform: "translate(-50%, -50%) scale(.88)", offset: 0.16 },
            { opacity: .72, transform: "translate(-50%, -50%) scale(1.14)", offset: 0.50 },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.48)" }
          ]
        : [
            { opacity: 0, transform: "translate(-50%, -50%) scale(.62)" },
            { opacity: 1, transform: "translate(-50%, -50%) scale(.94)", offset: 0.14 },
            { opacity: .78, transform: "translate(-50%, -50%) scale(1.08)", offset: 0.34 },
            { opacity: .42, transform: "translate(-50%, -50%) scale(1.18)", offset: 0.58 },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.42)" }
          ];

      const ring = this.ring?.animate?.(ringFrames, {
        duration,
        easing: "cubic-bezier(.15,.7,.25,1)",
        fill: "forwards"
      });

      const burst = this.burst?.animate?.(
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(.38)" },
          { opacity: correct ? .92 : .88, transform: "translate(-50%, -50%) scale(.82)", offset: 0.16 },
          { opacity: correct ? .48 : .54, transform: "translate(-50%, -50%) scale(1.08)", offset: 0.48 },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.34)" }
        ],
        { duration, easing: "cubic-bezier(.16,.75,.22,1)", fill: "forwards" }
      );

      const pillFrames = correct
        ? [
            { opacity: 0, transform: "translate3d(0,10px,0) scale(.78)" },
            { opacity: 1, transform: "translate3d(0,-2px,0) scale(1.08)", offset: 0.16 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.34 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.78 },
            { opacity: 0, transform: "translate3d(0,-2px,0) scale(1.02)" }
          ]
        : [
            { opacity: 0, transform: "translate3d(0,0,0) scale(.88)" },
            { opacity: 1, transform: "translate3d(-11px,0,0) scale(1.02)", offset: 0.13 },
            { opacity: 1, transform: "translate3d(10px,0,0) scale(1.02)", offset: 0.22 },
            { opacity: 1, transform: "translate3d(-7px,0,0) scale(1)", offset: 0.31 },
            { opacity: 1, transform: "translate3d(6px,0,0) scale(1)", offset: 0.40 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.52 },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)", offset: 0.78 },
            { opacity: 0, transform: "translate3d(0,0,0) scale(1.015)" }
          ];

      const pill = this.pill?.animate?.(pillFrames, {
        duration,
        easing: "cubic-bezier(.2,.78,.28,1)",
        fill: "forwards"
      });

      const icon = this.icon?.animate?.(
        correct
          ? [
              { transform: "rotate(-18deg) scale(.55)" },
              { transform: "rotate(4deg) scale(1.25)", offset: 0.22 },
              { transform: "rotate(0deg) scale(1)", offset: 0.42 },
              { transform: "rotate(0deg) scale(1)" }
            ]
          : [
              { transform: "rotate(-10deg) scale(.68)" },
              { transform: "rotate(7deg) scale(1.20)", offset: 0.22 },
              { transform: "rotate(0deg) scale(1)", offset: 0.44 },
              { transform: "rotate(0deg) scale(1)" }
            ],
        { duration, easing: "cubic-bezier(.2,.78,.28,1)", fill: "forwards" }
      );

      this.animations = compactAnimations(main, ring, burst, pill, icon);
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
