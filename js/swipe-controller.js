const DEFAULTS = Object.freeze({
  intentDistance: 14,
  verticalAbortDistance: 32,
  horizontalIntentRatio: 1.15,
  verticalIntentRatio: 1.45,
  minDecisionDistance: 68,
  decisionWidthRatio: 0.20,
  maxDecisionDistance: 120,
  maxRotation: 12,
  returnDuration: 180,
  throwDuration: 360,
  reducedReturnDuration: 90,
  reducedThrowDuration: 150
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class SwipeController {
  constructor(card, { onDecision, onProgress, options = {} } = {}) {
    if (!card) throw new Error("SwipeController requires a card element");
    if (typeof onDecision !== "function") throw new TypeError("onDecision must be a function");

    this.card = card;
    this.onDecision = onDecision;
    this.onProgress = typeof onProgress === "function" ? onProgress : () => {};
    this.options = { ...DEFAULTS, ...options };
    this.enabled = true;
    this.activePointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.horizontalActive = false;
    this.verticalAborted = false;
    this.animation = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleLostPointerCapture = this.handleLostPointerCapture.bind(this);

    card.addEventListener("pointerdown", this.handlePointerDown);
    card.addEventListener("pointermove", this.handlePointerMove);
    card.addEventListener("pointerup", this.handlePointerUp);
    card.addEventListener("pointercancel", this.handlePointerCancel);
    card.addEventListener("lostpointercapture", this.handleLostPointerCapture);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.activePointerId !== null) {
      this.cancelGesture({ animate: false });
    }
  }

  decisionThreshold() {
    return Math.max(
      this.options.minDecisionDistance,
      Math.min(this.card.clientWidth * this.options.decisionWidthRatio, this.options.maxDecisionDistance)
    );
  }

  motionDuration(normal, reduced) {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? reduced : normal;
  }

  handlePointerDown(event) {
    if (!this.enabled || event.isPrimary === false || event.pointerType === "mouse") return;

    this.stopAnimation();
    this.activePointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.deltaX = 0;
    this.deltaY = 0;
    this.horizontalActive = false;
    this.verticalAborted = false;
  }

  handlePointerMove(event) {
    if (!this.enabled || event.pointerId !== this.activePointerId || this.verticalAborted) return;

    this.deltaX = event.clientX - this.startX;
    this.deltaY = event.clientY - this.startY;

    const absX = Math.abs(this.deltaX);
    const absY = Math.abs(this.deltaY);

    if (!this.horizontalActive) {
      if (
        absY >= this.options.verticalAbortDistance &&
        absY > absX * this.options.verticalIntentRatio
      ) {
        this.verticalAborted = true;
        this.cleanupGestureState();
        return;
      }

      if (
        absX < this.options.intentDistance ||
        absX <= absY * this.options.horizontalIntentRatio
      ) {
        return;
      }

      this.horizontalActive = true;
      this.card.classList.add("is-dragging");
      try {
        this.card.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the browser has already cancelled the pointer.
      }
    }

    const width = Math.max(this.card.clientWidth, 1);
    const progress = clamp(this.deltaX / width, -1, 1);
    const rotation = progress * this.options.maxRotation;

    this.card.style.transform = `translate3d(${this.deltaX}px, 0, 0) rotate(${rotation}deg)`;
    this.onProgress(progress);
  }

  handlePointerUp(event) {
    if (event.pointerId !== this.activePointerId) return;

    const shouldDecide =
      this.horizontalActive &&
      Math.abs(this.deltaX) >= this.decisionThreshold();
    const direction = this.deltaX > 0 ? "ai" : "human";
    const pointerId = event.pointerId;

    if (shouldDecide) {
      this.card.classList.remove("is-dragging");
      this.cleanupGestureState({ preserveTransform: true });
      this.releasePointer(pointerId);
      this.onDecision(direction);
      return;
    }

    const animateReturn = this.horizontalActive;
    this.activePointerId = null;
    this.releasePointer(pointerId);
    this.cancelGesture({ animate: animateReturn });
  }

  handlePointerCancel(event) {
    if (event.pointerId !== this.activePointerId) return;
    this.cancelGesture({ animate: this.horizontalActive });
  }

  handleLostPointerCapture(event) {
    if (event.pointerId !== this.activePointerId) return;
    if (this.horizontalActive) this.cancelGesture({ animate: true });
  }

  releasePointer(pointerId) {
    try {
      if (this.card.hasPointerCapture?.(pointerId)) {
        this.card.releasePointerCapture(pointerId);
      }
    } catch {
      // No-op: pointer may already be released by the browser.
    }
  }

  async cancelGesture({ animate = true } = {}) {
    const hadTransform = Boolean(this.card.style.transform);
    this.card.classList.remove("is-dragging");

    if (animate && hadTransform) {
      await this.animateToCenter();
    } else {
      this.resetVisuals();
    }

    this.cleanupGestureState();
  }

  async animateToCenter() {
    this.stopAnimation();
    const from = this.card.style.transform || "translate3d(0, 0, 0) rotate(0deg)";
    const duration = this.motionDuration(
      this.options.returnDuration,
      this.options.reducedReturnDuration
    );

    this.animation = this.card.animate(
      [
        { transform: from },
        { transform: "translate3d(0, 0, 0) rotate(0deg)" }
      ],
      { duration, easing: "cubic-bezier(.2,.75,.3,1)" }
    );

    try {
      await this.animation.finished;
    } catch {
      // Cancelled by a new gesture/state transition.
    }

    this.resetVisuals();
  }

  async throw(direction) {
    this.stopAnimation();
    this.setEnabled(false);

    const sign = direction === "ai" ? 1 : -1;
    const startTransform = this.card.style.transform || "translate3d(0, 0, 0) rotate(0deg)";
    const distance = Math.max(window.innerWidth, this.card.clientWidth) + this.card.clientWidth + 80;
    const targetTransform = `translate3d(${sign * distance}px, 40px, 0) rotate(${sign * 18}deg)`;
    const duration = this.motionDuration(
      this.options.throwDuration,
      this.options.reducedThrowDuration
    );

    this.card.classList.remove("is-dragging");
    this.animation = this.card.animate(
      [
        { transform: startTransform, opacity: 1 },
        { transform: targetTransform, opacity: 0 }
      ],
      { duration, easing: "cubic-bezier(.18,.82,.2,1)", fill: "forwards" }
    );

    try {
      await this.animation.finished;
    } catch {
      // Cancelled by state cleanup.
    }

    this.resetVisuals();
  }

  resetVisuals() {
    this.stopAnimation();
    this.card.style.transform = "";
    this.card.style.opacity = "";
    this.onProgress(0);
  }

  stopAnimation() {
    if (this.animation) {
      try {
        this.animation.cancel();
      } catch {
        // Already finished/cancelled.
      }
      this.animation = null;
    }
  }

  cleanupGestureState({ preserveTransform = false } = {}) {
    this.activePointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.horizontalActive = false;
    this.verticalAborted = false;
    if (!preserveTransform) this.card.classList.remove("is-dragging");
  }

  destroy() {
    this.stopAnimation();
    this.card.removeEventListener("pointerdown", this.handlePointerDown);
    this.card.removeEventListener("pointermove", this.handlePointerMove);
    this.card.removeEventListener("pointerup", this.handlePointerUp);
    this.card.removeEventListener("pointercancel", this.handlePointerCancel);
    this.card.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
  }
}
