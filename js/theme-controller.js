export const THEME_STORAGE_KEY = "ai-or-human.theme";
export const DEFAULT_THEME = "light";
export const THEMES = Object.freeze(["light", "dark"]);

export const THEME_COLORS = Object.freeze({
  light: "#eef2f3",
  dark: "#0c1116"
});

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : null;
}

export function resolveStoredTheme(storage = globalThis.localStorage) {
  try {
    return normalizeTheme(storage?.getItem?.(THEME_STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function getNextTheme(theme) {
  return normalizeTheme(theme) === "dark" ? "light" : "dark";
}

export function calculateThemeRevealRadius(originX, originY, viewportWidth, viewportHeight) {
  const farthestX = Math.max(originX, Math.max(0, viewportWidth - originX));
  const farthestY = Math.max(originY, Math.max(0, viewportHeight - originY));
  return Math.hypot(farthestX, farthestY);
}

function persistTheme(theme, storage) {
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is an enhancement; a storage/privacy restriction must not block the UI.
  }
}

function syncThemeSwitch(button, theme) {
  if (!button) return;
  const dark = theme === "dark";
  button.setAttribute("aria-checked", String(dark));
  button.setAttribute("aria-label", dark ? "Włącz jasny motyw" : "Włącz ciemny motyw");
  button.title = dark ? "Jasny motyw" : "Ciemny motyw";
}

export function applyTheme(theme, {
  root = globalThis.document?.documentElement,
  meta = globalThis.document?.querySelector?.('meta[name="theme-color"]'),
  switchButton = globalThis.document?.querySelector?.("#theme-switch"),
  storage = globalThis.localStorage,
  persist = true
} = {}) {
  const normalized = normalizeTheme(theme) ?? DEFAULT_THEME;
  if (!root) return normalized;

  root.dataset.theme = normalized;
  root.style.colorScheme = normalized;
  if (meta) meta.setAttribute("content", THEME_COLORS[normalized]);
  syncThemeSwitch(switchButton, normalized);
  if (persist) persistTheme(normalized, storage);
  return normalized;
}


export function setThemeSwitchVisible(button, visible) {
  if (!button) return;
  const shown = Boolean(visible);
  button.hidden = !shown;
  button.disabled = !shown;
  button.setAttribute("aria-hidden", String(!shown));
  if (!shown && typeof button.blur === "function") button.blur();
}

function prefersReducedMotion(windowRef) {
  return Boolean(windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/**
 * A single LIGHT/DARK authority for every public screen. The circle is painted
 * behind the live UI, never from a frozen document screenshot. That is vital:
 * a full-page View Transition would capture an arbitrary frame of a rotating
 * card, then expose a different frame when the snapshot ends.
 *
 * Theme state is committed SYNCHRONOUSLY on every tap. The reveal is a purely
 * decorative backdrop animation and cannot delay or block another tap.
 */
export function initializeThemeController({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage = globalThis.localStorage
} = {}) {
  if (!documentRef?.documentElement) return null;

  const root = documentRef.documentElement;
  const button = documentRef.querySelector("#theme-switch");
  const meta = documentRef.querySelector('meta[name="theme-color"]');
  const backdrop = documentRef.querySelector("#theme-reveal-backdrop");
  const reveal = backdrop?.querySelector?.(".theme-reveal-backdrop__new") ?? null;
  let currentTheme = normalizeTheme(root.dataset.theme) ?? resolveStoredTheme(storage);

  currentTheme = applyTheme(currentTheme, {
    root, meta, switchButton: button, storage, persist: false
  });

  if (!button) return Object.freeze({
    get theme() { return currentTheme; },
    setVisible() {}
  });

  let runningAnimation = null;
  let activeTransition = Promise.resolve();
  let revealRevision = 0;

  const toggle = () => {
    if (button.hidden) return activeTransition;

    const previousTheme = currentTheme;
    const nextTheme = getNextTheme(previousTheme);
    const rect = button.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const radius = calculateThemeRevealRadius(
      originX, originY, windowRef?.innerWidth ?? 0, windowRef?.innerHeight ?? 0
    );

    // Invalidate the previous backdrop only. NEVER cancel or pause a card turn.
    const revision = ++revealRevision;
    runningAnimation?.cancel?.();
    runningAnimation = null;
    if (backdrop) backdrop.hidden = true;

    currentTheme = applyTheme(nextTheme, {
      root, meta, switchButton: button, storage, persist: true
    });

    if (prefersReducedMotion(windowRef) || !backdrop || !reveal || typeof reveal.animate !== "function") {
      activeTransition = Promise.resolve();
      return activeTransition;
    }

    backdrop.style.setProperty("--theme-reveal-previous-bg", THEME_COLORS[previousTheme]);
    backdrop.style.setProperty("--theme-reveal-next-bg", THEME_COLORS[nextTheme]);
    backdrop.hidden = false;
    const center = `${originX}px ${originY}px`;
    try {
      const animation = reveal.animate(
        [
          { clipPath: `circle(0px at ${center})` },
          { clipPath: `circle(${radius}px at ${center})` }
        ],
        { duration: 560, easing: "cubic-bezier(.22, .78, .30, 1)", fill: "both" }
      );
      runningAnimation = animation;
      activeTransition = Promise.resolve(animation.finished).catch(() => undefined).then(() => {
        if (revealRevision !== revision) return;
        runningAnimation = null;
        backdrop.hidden = true;
      });
    } catch {
      backdrop.hidden = true;
      activeTransition = Promise.resolve();
    }
    return activeTransition;
  };

  button.addEventListener("click", toggle);

  return Object.freeze({
    get theme() { return currentTheme; },
    toggle,
    setVisible(visible) { setThemeSwitchVisible(button, visible); }
  });
}
