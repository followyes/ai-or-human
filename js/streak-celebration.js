/** Finite, card-local streak reward after the ordinary DOBRZE + swipe handoff.
 * Does not own a timer, input listeners, scoring, images or the swipe animation.
 * The caller awaits this short beat while the outgoing card is already gone. */
const DURATIONS = Object.freeze({
  3: Object.freeze({ normal: 1250, reduced: 480 }),
  10: Object.freeze({ normal: 1470, reduced: 570 })
});

// Fixed, bounded decoration: no emitter, repeated DOM creation or animation loop.
const PARTICLE_OFFSETS = Object.freeze([
  [-92, -78], [86, -72], [-133, -26], [128, -16], [-117, 56], [118, 64],
  [-56, -113], [55, -112], [-65, 112], [69, 108], [-163, 15], [162, 18],
  [-147, -87], [146, -85], [-24, -137], [27, -134], [-141, 100], [139, 98]
]);

export class StreakCelebrationController {
  constructor(root) {
    if (!root) throw new Error("StreakCelebrationController requires a root element");
    this.root = root;
    this.heading = root.querySelector("[data-streak-heading]");
    this.kicker = root.querySelector("[data-streak-kicker]");
    this.particles = root.querySelector("[data-streak-particles]");
    if (!this.heading || !this.kicker || !this.particles) {
      throw new Error("Incomplete streak celebration markup");
    }
    this.animation = null;
    this.revision = 0;
    // Construct once. No detached fragments and no event handlers per particle.
    for (const [index, [x, y]] of PARTICLE_OFFSETS.entries()) {
      const node = root.ownerDocument.createElement("i");
      node.className = "streak-reward__particle";
      node.setAttribute("aria-hidden", "true");
      node.style.setProperty("--scatter-x", `${x}px`);
      node.style.setProperty("--scatter-y", `${y}px`);
      node.style.setProperty("--scatter-mid-x", `${Math.round(x * .45)}px`);
      node.style.setProperty("--scatter-mid-y", `${Math.round(y * .45)}px`);
      node.style.setProperty("--particle-delay", `${(index % 6) * 28}ms`);
      if (index >= 12) node.classList.add("streak-reward__particle--major");
      this.particles.appendChild(node);
    }
  }

  clear() {
    ++this.revision;
    if (this.animation) {
      try { this.animation.cancel(); } catch { /* Already finished. */ }
      this.animation = null;
    }
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

    this.heading.textContent = major ? "Niesamowita seria!" : "Świetna robota!";
    this.kicker.textContent = major ? "10 poprawnych z rzędu" : "3 poprawne z rzędu";
    this.root.dataset.milestone = String(milestone);
    this.root.classList.toggle("is-major", major);
    this.root.classList.add("is-active");
    this.root.setAttribute("aria-hidden", "false");

    // Only the root animation gates the next card. Child motions are finite CSS
    // animations, scoped to .is-active, and automatically stop on clear().
    const animation = this.root.animate(
      reduced
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: .12 },
            { opacity: 1, offset: .78 },
            { opacity: 0, offset: 1 }
          ]
        : [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: .19 },
            { opacity: 1, offset: .76 },
            { opacity: 0, offset: 1 }
          ],
      { duration, easing: "ease-out", fill: "forwards" }
    );
    this.animation = animation;
    try { await animation.finished; } catch { /* Navigation cancels the reward. */ }
    if (revision !== this.revision) return false;
    this.clear();
    return true;
  }
}
