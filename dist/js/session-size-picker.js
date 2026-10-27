const DEFAULTS = Object.freeze({
  slideDuration: 320
});

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function visible(element) {
  return Boolean(element?.getClientRects?.().length && element.getBoundingClientRect().width > 0);
}

export function normalizeGeometry(geometry) {
  if (!geometry) return null;

  const left = Number.isFinite(geometry.left) ? geometry.left : Number(geometry.x) || 0;
  const top = Number.isFinite(geometry.top) ? geometry.top : Number(geometry.y) || 0;
  const width = Math.max(1, Number(geometry.width) || 1);
  const height = Math.max(1, Number(geometry.height) || 1);

  return { left, top, width, height };
}

export function getIndicatorTransform(geometry) {
  const g = normalizeGeometry(geometry);
  if (!g) throw new Error('Indicator transform requires geometry');
  return `translate3d(${g.left}px, ${g.top}px, 0)`;
}

export class SessionSizePicker {
  constructor(root, { options = {} } = {}) {
    if (!root) throw new Error('SessionSizePicker requires a root element');

    this.root = root;
    this.options = { ...DEFAULTS, ...options };
    this.buttons = [...root.querySelectorAll('[data-session-size]')];
    this.indicator = root.querySelector('[data-session-indicator]');

    if (!this.buttons.length || !this.indicator) {
      throw new Error('SessionSizePicker markup is incomplete');
    }

    this.value = null;

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

    return normalizeGeometry({
      left: button.offsetLeft,
      top: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight
    });
  }

  setSelection(value) {
    for (const button of this.buttons) {
      button.classList.toggle('is-selected', Number(button.dataset.sessionSize) === Number(value));
    }
  }

  placeIndicator(geometry, { animate = false } = {}) {
    const g = normalizeGeometry(geometry);
    if (!g) return false;

    const shouldAnimate = animate && !prefersReducedMotion();

    this.indicator.style.transitionDuration = shouldAnimate
      ? `${this.options.slideDuration}ms`
      : '0ms';
    this.indicator.style.width = `${g.width}px`;
    this.indicator.style.height = `${g.height}px`;
    this.indicator.style.transform = getIndicatorTransform(g);

    this.root.classList.add('is-enhanced');
    return true;
  }

  refresh() {
    if (this.value === null || !this.isVisible()) return false;

    const geometry = this.getGeometry(this.getButton(this.value));
    if (!geometry) return false;

    this.setSelection(this.value);
    return this.placeIndicator(geometry, { animate: false });
  }

  sync(value, { animate = false } = {}) {
    const targetButton = this.getButton(value);
    if (!targetButton) return false;

    const nextValue = Number(value);
    const previousValue = this.value;
    this.value = nextValue;
    this.setSelection(nextValue);

    if (!this.isVisible()) return false;

    const geometry = this.getGeometry(targetButton);
    if (!geometry) return false;

    const shouldAnimate = animate
      && previousValue !== null
      && Number(previousValue) !== nextValue;

    return this.placeIndicator(geometry, { animate: shouldAnimate });
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }
}

export const __test = Object.freeze({
  DEFAULTS
});
