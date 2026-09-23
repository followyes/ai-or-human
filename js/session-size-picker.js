const DEFAULTS = Object.freeze({
  adjacentDuration: 760,
  longDuration: 900,
  stretchEnd: 0.38,
  bridgeHoldEnd: 0.58,
  maxWaistPinch: 0.27,
  maxEndBulge: 0.08
});


function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(value) {
  const t = clamp01(value);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(value) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeGeometry(geometry) {
  if (!geometry) return null;

  const left = Number.isFinite(geometry.left) ? geometry.left : Number(geometry.x) || 0;
  const top = Number.isFinite(geometry.top) ? geometry.top : Number(geometry.y) || 0;
  const width = Math.max(1, Number(geometry.width) || 1);
  const height = Math.max(1, Number(geometry.height) || 1);

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2
  };
}

function geometryFromFrame(frame) {
  return normalizeGeometry({
    left: frame.left,
    top: frame.centerY - frame.height / 2,
    width: frame.right - frame.left,
    height: frame.height
  });
}

function frameFromGeometry(geometry, direction = 1) {
  const g = normalizeGeometry(geometry);
  return {
    left: g.left,
    right: g.right,
    centerY: g.centerY,
    height: g.height,
    direction: direction < 0 ? -1 : 1,
    liquidness: 0
  };
}

export function getLiquidDuration(slotDistance, options = DEFAULTS) {
  const distance = Math.max(1, Math.min(2, Math.abs(Number(slotDistance) || 1)));
  return distance > 1 ? options.longDuration : options.adjacentDuration;
}

export function getLiquidMorphFrame(sourceGeometry, targetGeometry, progress, options = DEFAULTS) {
  const source = normalizeGeometry(sourceGeometry);
  const target = normalizeGeometry(targetGeometry);
  if (!source || !target) throw new Error('Liquid morph requires source and target geometry');

  const t = clamp01(progress);
  const direction = target.centerX >= source.centerX ? 1 : -1;
  const stretchEnd = Math.max(0.20, Math.min(0.48, options.stretchEnd ?? DEFAULTS.stretchEnd));
  const bridgeHoldEnd = Math.max(stretchEnd + 0.08, Math.min(0.72, options.bridgeHoldEnd ?? DEFAULTS.bridgeHoldEnd));

  let left;
  let right;

  if (direction > 0) {
    if (t <= stretchEnd) {
      const phase = easeOutCubic(t / stretchEnd);
      left = source.left;
      right = lerp(source.right, target.right, phase);
    } else if (t <= bridgeHoldEnd) {
      left = source.left;
      right = target.right;
    } else {
      const phase = easeInOutCubic((t - bridgeHoldEnd) / (1 - bridgeHoldEnd));
      left = lerp(source.left, target.left, phase);
      right = target.right;
    }
  } else {
    if (t <= stretchEnd) {
      const phase = easeOutCubic(t / stretchEnd);
      left = lerp(source.left, target.left, phase);
      right = source.right;
    } else if (t <= bridgeHoldEnd) {
      left = target.left;
      right = source.right;
    } else {
      const phase = easeInOutCubic((t - bridgeHoldEnd) / (1 - bridgeHoldEnd));
      left = target.left;
      right = lerp(source.right, target.right, phase);
    }
  }

  const centerY = lerp(source.centerY, target.centerY, easeInOutCubic(t));
  const baseHeight = lerp(source.height, target.height, easeInOutCubic(t));
  const liquidness = Math.pow(Math.sin(Math.PI * t), 0.82);
  const height = baseHeight * (1 - 0.035 * liquidness);

  return {
    left,
    right,
    centerY,
    height,
    direction,
    liquidness
  };
}

export function buildLiquidPath(frame, options = DEFAULTS) {
  const left = Number(frame.left);
  const right = Number(frame.right);
  const centerY = Number(frame.centerY);
  const height = Math.max(1, Number(frame.height));
  const direction = frame.direction < 0 ? -1 : 1;
  const liquidness = clamp01(frame.liquidness);
  const width = Math.max(1, right - left);
  const halfHeight = height / 2;
  const capRadius = Math.min(halfHeight, width / 2);
  const pinch = Math.max(0, Math.min(0.42, options.maxWaistPinch ?? DEFAULTS.maxWaistPinch));
  const bulge = Math.max(0, Math.min(0.16, options.maxEndBulge ?? DEFAULTS.maxEndBulge));

  const leadingScale = 1 + bulge * liquidness;
  const trailingScale = 1 - bulge * 0.55 * liquidness;
  const leftScale = direction > 0 ? trailingScale : leadingScale;
  const rightScale = direction > 0 ? leadingScale : trailingScale;
  const leftHalf = halfHeight * leftScale;
  const rightHalf = halfHeight * rightScale;
  const waistHalf = halfHeight * (1 - pinch * liquidness);
  const mid = (left + right) / 2;
  const span = right - left;
  const leftShoulder = Math.min(left + capRadius, mid - 0.5);
  const rightShoulder = Math.max(right - capRadius, mid + 0.5);
  const waistSpread = Math.min(span * 0.14, Math.max(4, capRadius * 0.90));

  const lTop = centerY - leftHalf;
  const rTop = centerY - rightHalf;
  const wTop = centerY - waistHalf;
  const lBottom = centerY + leftHalf;
  const rBottom = centerY + rightHalf;
  const wBottom = centerY + waistHalf;

  const leftControl = left + capRadius * 0.46;
  const rightControl = right - capRadius * 0.46;

  return [
    `M ${round(left)} ${round(centerY)}`,
    `C ${round(left)} ${round(centerY - leftHalf * 0.58)} ${round(leftControl)} ${round(lTop)} ${round(leftShoulder)} ${round(lTop)}`,
    `C ${round(lerp(leftShoulder, mid, 0.58))} ${round(lTop)} ${round(mid - waistSpread)} ${round(wTop)} ${round(mid)} ${round(wTop)}`,
    `C ${round(mid + waistSpread)} ${round(wTop)} ${round(lerp(mid, rightShoulder, 0.42))} ${round(rTop)} ${round(rightShoulder)} ${round(rTop)}`,
    `C ${round(rightControl)} ${round(rTop)} ${round(right)} ${round(centerY - rightHalf * 0.58)} ${round(right)} ${round(centerY)}`,
    `C ${round(right)} ${round(centerY + rightHalf * 0.58)} ${round(rightControl)} ${round(rBottom)} ${round(rightShoulder)} ${round(rBottom)}`,
    `C ${round(lerp(mid, rightShoulder, 0.42))} ${round(rBottom)} ${round(mid + waistSpread)} ${round(wBottom)} ${round(mid)} ${round(wBottom)}`,
    `C ${round(mid - waistSpread)} ${round(wBottom)} ${round(lerp(leftShoulder, mid, 0.58))} ${round(lBottom)} ${round(leftShoulder)} ${round(lBottom)}`,
    `C ${round(leftControl)} ${round(lBottom)} ${round(left)} ${round(centerY + leftHalf * 0.58)} ${round(left)} ${round(centerY)}`,
    'Z'
  ].join(' ');
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function visible(element) {
  return Boolean(element?.getClientRects?.().length && element.getBoundingClientRect().width > 0);
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(now()), 16);
}

function cancelFrame(handle) {
  if (handle === null) return;
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
  } else {
    globalThis.clearTimeout(handle);
  }
}

export class SessionSizePicker {
  constructor(root, { options = {} } = {}) {
    if (!root) throw new Error('SessionSizePicker requires a root element');

    this.root = root;
    this.options = { ...DEFAULTS, ...options };
    this.buttons = [...root.querySelectorAll('[data-session-size]')];
    this.svg = root.querySelector('[data-session-liquid]');
    this.path = root.querySelector('[data-session-liquid-path]');

    if (!this.buttons.length || !this.svg || !this.path) {
      throw new Error('SessionSizePicker liquid SVG markup is incomplete');
    }

    this.value = null;
    this.currentFrame = null;
    this.frameHandle = null;
    this.textAnimations = [];
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
    return normalizeGeometry({
      left: button.offsetLeft,
      top: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight
    });
  }

  updateViewBox() {
    const width = Math.max(1, this.root.clientWidth || this.root.getBoundingClientRect().width || 1);
    const height = Math.max(1, this.root.clientHeight || this.root.getBoundingClientRect().height || 1);
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  renderFrame(frame) {
    if (!frame) return;
    this.currentFrame = { ...frame };
    this.path.setAttribute('d', buildLiquidPath(frame, this.options));
  }

  setVisualSelection(value) {
    for (const button of this.buttons) {
      button.classList.toggle('is-selected', Number(button.dataset.sessionSize) === Number(value));
    }
  }

  clearTextAnimations() {
    for (const animation of this.textAnimations) {
      try { animation.cancel(); } catch {}
    }
    this.textAnimations = [];
    for (const button of this.buttons) button.style.color = '';
  }

  cancelMorph({ keepFrame = true } = {}) {
    this.revision += 1;
    cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this.clearTextAnimations();
    this.root.classList.remove('is-animating', 'is-moving-left', 'is-moving-right');

    if (!keepFrame) this.currentFrame = null;
  }

  refresh() {
    if (this.value === null || !this.isVisible()) return false;

    const target = this.getGeometry(this.getButton(this.value));
    if (!target) return false;

    this.cancelMorph({ keepFrame: false });
    this.updateViewBox();
    this.root.classList.add('is-enhanced');
    this.renderFrame(frameFromGeometry(target));
    this.setVisualSelection(this.value);
    return true;
  }

  animateTextCoverage(previousButton, targetButton, direction, duration) {
    const previousIndex = this.buttons.indexOf(previousButton);
    const targetIndex = this.buttons.indexOf(targetButton);
    if (previousIndex < 0 || targetIndex < 0 || previousIndex === targetIndex) return;

    const start = Math.min(previousIndex, targetIndex);
    const end = Math.max(previousIndex, targetIndex);
    const dark = getComputedStyle(this.root).getPropertyValue('--text').trim() || '#20272d';
    const light = '#ffffff';

    for (let index = start; index <= end; index += 1) {
      const button = this.buttons[index];
      if (!button.animate) continue;

      let keyframes;
      if (index === previousIndex) {
        keyframes = [
          { color: light, offset: 0 },
          { color: light, offset: 0.58 },
          { color: dark, offset: 0.82 },
          { color: dark, offset: 1 }
        ];
      } else if (index === targetIndex) {
        keyframes = [
          { color: dark, offset: 0 },
          { color: dark, offset: 0.22 },
          { color: light, offset: 0.46 },
          { color: light, offset: 1 }
        ];
      } else {
        const normalized = (index - start) / Math.max(1, end - start);
        const arrival = direction > 0 ? normalized : 1 - normalized;
        const on = Math.max(0.16, arrival * 0.38);
        const off = Math.min(0.88, 0.62 + arrival * 0.18);
        keyframes = [
          { color: dark, offset: 0 },
          { color: dark, offset: Math.max(0, on - 0.10) },
          { color: light, offset: on },
          { color: light, offset: off },
          { color: dark, offset: Math.min(1, off + 0.10) },
          { color: dark, offset: 1 }
        ];
      }

      const animation = button.animate(keyframes, { duration, easing: 'linear' });
      this.textAnimations.push(animation);
    }
  }

  sync(value, { animate = false } = {}) {
    const targetButton = this.getButton(value);
    if (!targetButton) return false;

    const previousValue = this.value;
    const previousButton = this.getButton(previousValue);
    const sameValue = Number(previousValue) === Number(value);
    this.value = Number(value);
    this.setVisualSelection(value);

    if (!this.isVisible()) return false;

    const target = this.getGeometry(targetButton);
    if (!target) return false;

    this.updateViewBox();
    this.root.classList.add('is-enhanced');

    if (!animate || sameValue || previousValue === null || prefersReducedMotion()) {
      this.cancelMorph({ keepFrame: false });
      this.renderFrame(frameFromGeometry(target));
      return true;
    }

    const previousIndex = this.buttons.indexOf(previousButton);
    const targetIndex = this.buttons.indexOf(targetButton);
    const slotDistance = Math.abs(targetIndex - previousIndex) || 1;
    const duration = getLiquidDuration(slotDistance, this.options);
    const direction = targetIndex >= previousIndex ? 1 : -1;
    const fallbackSource = this.getGeometry(previousButton) ?? target;
    const source = this.currentFrame ? geometryFromFrame(this.currentFrame) : fallbackSource;

    this.cancelMorph({ keepFrame: true });
    const revision = ++this.revision;
    this.root.classList.add('is-animating', direction > 0 ? 'is-moving-right' : 'is-moving-left');
    this.animateTextCoverage(previousButton, targetButton, direction, duration);

    const startedAt = now();

    const tick = (timestamp) => {
      if (revision !== this.revision) return;

      const elapsed = Math.max(0, timestamp - startedAt);
      const progress = clamp01(elapsed / duration);
      const frame = getLiquidMorphFrame(source, target, progress, this.options);
      this.renderFrame(frame);

      if (progress < 1) {
        this.frameHandle = requestFrame(tick);
        return;
      }

      this.frameHandle = null;
      this.clearTextAnimations();
      this.root.classList.remove('is-animating', 'is-moving-left', 'is-moving-right');
      this.renderFrame(frameFromGeometry(target, direction));
      this.setVisualSelection(this.value);
    };

    this.frameHandle = requestFrame(tick);
    return true;
  }

  destroy() {
    this.cancelMorph({ keepFrame: false });
    this.resizeObserver?.disconnect();
  }
}

export const __test = Object.freeze({
  DEFAULTS,
  normalizeGeometry,
  frameFromGeometry,
  geometryFromFrame,
  easeInOutCubic,
  easeOutCubic
});
