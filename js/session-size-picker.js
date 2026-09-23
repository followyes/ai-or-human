const DEFAULTS = Object.freeze({
  adjacentDuration: 440,
  longDuration: 520,
  reducedDuration: 1,
  settleScaleX: 0.94,
  settleScaleY: 1.04
});

function clampSlotDistance(value) {
  const distance = Math.abs(Number(value) || 0);
  return Math.max(1, Math.min(2, distance));
}

export function getLiquidDuration(slotDistance, options = DEFAULTS) {
  return clampSlotDistance(slotDistance) > 1
    ? options.longDuration
    : options.adjacentDuration;
}

export function getLiquidMotionProfile(direction, slotDistance = 1) {
  const sign = direction < 0 ? -1 : 1;
  const distance = clampSlotDistance(slotDistance);
  const stretch = distance > 1 ? 1.34 : 1.24;
  const bridgeTravel = distance > 1 ? 96 : 72;

  return {
    sign,
    stretch,
    bridgeTravel,
    transformOrigin: sign > 0 ? '0% 50%' : '100% 50%'
  };
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function visible(element) {
  return Boolean(element?.getClientRects?.().length && element.getBoundingClientRect().width > 0);
}

export class SessionSizePicker {
  constructor(root, { options = {} } = {}) {
    if (!root) throw new Error('SessionSizePicker requires a root element');

    this.root = root;
    this.options = { ...DEFAULTS, ...options };
    this.buttons = [...root.querySelectorAll('[data-session-size]')];
    this.indicator = root.querySelector('[data-session-indicator]');
    this.body = root.querySelector('[data-session-indicator-body]');
    this.bridge = root.querySelector('[data-session-indicator-bridge]');

    if (!this.buttons.length || !this.indicator || !this.body || !this.bridge) {
      throw new Error('SessionSizePicker markup is incomplete');
    }

    this.value = null;
    this.animations = [];
    this.revision = 0;
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.refresh())
      : null;
    this.resizeObserver?.observe(this.root);
  }

  isVisible() {
    return visible(this.root);
  }

  getButton(value) {
    return this.buttons.find((button) => Number(button.dataset.sessionSize) === Number(value)) ?? null;
  }

  getGeometry(button) {
    if (!button || !this.isVisible()) return null;
    return {
      x: button.offsetLeft,
      y: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight
    };
  }

  getIndicatorGeometry() {
    if (!this.isVisible()) return null;
    const rootRect = this.root.getBoundingClientRect();
    const rect = this.indicator.getBoundingClientRect();
    return {
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height
    };
  }

  setIndicatorGeometry(geometry) {
    if (!geometry) return;
    this.indicator.style.width = `${geometry.width}px`;
    this.indicator.style.height = `${geometry.height}px`;
    this.indicator.style.transform = `translate3d(${geometry.x}px, ${geometry.y}px, 0)`;
  }

  setVisualSelection(value) {
    for (const button of this.buttons) {
      button.classList.toggle('is-selected', Number(button.dataset.sessionSize) === Number(value));
    }
  }

  cancelAnimations({ preserveCurrentPosition = true } = {}) {
    const current = preserveCurrentPosition ? this.getIndicatorGeometry() : null;
    this.revision += 1;

    for (const animation of this.animations) {
      try { animation.cancel(); } catch {}
    }
    this.animations = [];

    this.root.classList.remove('is-animating', 'is-moving-left', 'is-moving-right');
    this.body.style.transform = '';
    this.body.style.transformOrigin = '';
    this.bridge.style.opacity = '';
    this.bridge.style.transform = '';

    if (current) this.setIndicatorGeometry(current);
  }

  refresh() {
    if (this.value === null || !this.isVisible()) return false;
    this.cancelAnimations({ preserveCurrentPosition: false });
    const geometry = this.getGeometry(this.getButton(this.value));
    this.root.classList.add('is-enhanced');
    this.setIndicatorGeometry(geometry);
    this.setVisualSelection(this.value);
    return true;
  }

  sync(value, { animate = false } = {}) {
    const targetButton = this.getButton(value);
    if (!targetButton) return false;

    const previousValue = this.value;
    const sameValue = Number(previousValue) === Number(value);
    const previousButton = this.getButton(previousValue);
    const inactiveColor = getComputedStyle(this.root).getPropertyValue('--text').trim() || '#20272d';
    const selectedColor = '#ffffff';
    this.value = Number(value);

    // The class reflects the semantic target immediately. WAAPI temporarily owns
    // label colors during travel so the text stays readable under the moving pill.
    this.setVisualSelection(value);

    if (!this.isVisible()) return false;

    const target = this.getGeometry(targetButton);
    if (!target) return false;

    if (!animate || sameValue || previousValue === null || prefersReducedMotion()) {
      this.cancelAnimations({ preserveCurrentPosition: false });
      this.root.classList.add('is-enhanced');
      this.setIndicatorGeometry(target);
      return true;
    }

    const previousIndex = this.buttons.indexOf(previousButton);
    const targetIndex = this.buttons.indexOf(targetButton);
    const slotDistance = Math.abs(targetIndex - previousIndex) || 1;
    const direction = targetIndex >= previousIndex ? 1 : -1;
    const profile = getLiquidMotionProfile(direction, slotDistance);
    const duration = getLiquidDuration(slotDistance, this.options);

    const visualStart = this.getIndicatorGeometry() ?? this.getGeometry(previousButton) ?? target;
    this.cancelAnimations({ preserveCurrentPosition: false });
    this.root.classList.add('is-enhanced');
    this.setIndicatorGeometry(visualStart);

    const revision = ++this.revision;
    this.root.classList.add('is-animating', direction > 0 ? 'is-moving-right' : 'is-moving-left');
    this.body.style.transformOrigin = profile.transformOrigin;

    const travel = this.indicator.animate(
      [
        { transform: `translate3d(${visualStart.x}px, ${visualStart.y}px, 0)` },
        { transform: `translate3d(${target.x}px, ${target.y}px, 0)` }
      ],
      { duration, easing: 'cubic-bezier(.22,.72,.24,1)', fill: 'forwards' }
    );

    const body = this.body.animate(
      [
        { transform: 'scale3d(1,1,1)', borderRadius: '999px' },
        { transform: `scale3d(${profile.stretch},.96,1)`, borderRadius: direction > 0 ? '999px 72% 72% 999px' : '72% 999px 999px 72%', offset: 0.24 },
        { transform: 'scale3d(1.10,.985,1)', borderRadius: '999px', offset: 0.62 },
        { transform: `scale3d(${this.options.settleScaleX},${this.options.settleScaleY},1)`, borderRadius: '999px', offset: 0.84 },
        { transform: 'scale3d(1,1,1)', borderRadius: '999px' }
      ],
      { duration, easing: 'cubic-bezier(.2,.72,.24,1)', fill: 'forwards' }
    );

    const bridgeStart = direction > 0 ? 18 : -18;
    const bridgeMid = direction > 0 ? profile.bridgeTravel : -profile.bridgeTravel;
    const bridge = this.bridge.animate(
      [
        { opacity: 0, transform: `translate3d(${bridgeStart}%, -50%, 0) scale3d(.35,.72,1)` },
        { opacity: .92, transform: `translate3d(${bridgeMid * .42}%, -50%, 0) scale3d(1.35,.82,1)`, offset: 0.28 },
        { opacity: .62, transform: `translate3d(${bridgeMid * .74}%, -50%, 0) scale3d(.95,.72,1)`, offset: 0.58 },
        { opacity: 0, transform: `translate3d(${bridgeMid}%, -50%, 0) scale3d(.40,.58,1)` }
      ],
      { duration: Math.round(duration * .76), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
    );

    // Keep both labels readable while the dark liquid passes underneath them.
    const previousText = previousButton?.animate?.(
      [
        { color: selectedColor },
        { color: selectedColor, offset: 0.22 },
        { color: inactiveColor, offset: 0.56 },
        { color: inactiveColor }
      ],
      { duration, easing: 'linear' }
    );
    const targetText = targetButton.animate(
      [
        { color: inactiveColor },
        { color: inactiveColor, offset: 0.42 },
        { color: selectedColor, offset: 0.72 },
        { color: selectedColor }
      ],
      { duration, easing: 'linear' }
    );

    this.animations = [travel, body, bridge, previousText, targetText].filter(Boolean);

    Promise.allSettled(this.animations.map((animation) => animation.finished)).then(() => {
      if (revision !== this.revision) return;

      this.setIndicatorGeometry(target);
      for (const animation of this.animations) {
        try { animation.cancel(); } catch {}
      }
      this.animations = [];
      this.root.classList.remove('is-animating', 'is-moving-left', 'is-moving-right');
      this.body.style.transform = '';
      this.body.style.transformOrigin = '';
      this.bridge.style.opacity = '';
      this.bridge.style.transform = '';
      this.setVisualSelection(this.value);
    });

    return true;
  }

  destroy() {
    this.cancelAnimations({ preserveCurrentPosition: false });
    this.resizeObserver?.disconnect();
  }
}
