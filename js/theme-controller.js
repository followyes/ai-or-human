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

export function initializeThemeController({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage = globalThis.localStorage
} = {}) {
  if (!documentRef?.documentElement) return null;

  const root = documentRef.documentElement;
  const button = documentRef.querySelector("#theme-switch");
  const meta = documentRef.querySelector('meta[name="theme-color"]');
  let currentTheme = normalizeTheme(root.dataset.theme) ?? resolveStoredTheme(storage);

  currentTheme = applyTheme(currentTheme, {
    root,
    meta,
    switchButton: button,
    storage,
    persist: false
  });

  if (!button) return Object.freeze({ get theme() { return currentTheme; }, setVisible() {}, whenSettled() { return Promise.resolve(); } });

  let activeTransition = Promise.resolve();

  const commitTheme = (nextTheme) => {
    currentTheme = applyTheme(nextTheme, {
      root,
      meta,
      switchButton: button,
      storage,
      persist: true
    });
  };

  const applyFallback = (nextTheme) => {
    root.classList.add("theme-fallback-transition");
    // Make the transition class authoritative before changing token values.
    void root.offsetWidth;
    commitTheme(nextTheme);
    activeTransition = new Promise((resolve) => {
      const finish = () => {
        root.classList.remove("theme-fallback-transition");
        resolve();
      };
      if (typeof windowRef?.setTimeout === "function") windowRef.setTimeout(finish, 460);
      else finish();
    });
    return activeTransition;
  };

  const toggle = () => {
    const nextTheme = getNextTheme(currentTheme);
    const reducedMotion = prefersReducedMotion(windowRef);
    const canViewTransition = typeof documentRef.startViewTransition === "function";

    if (reducedMotion || !canViewTransition) {
      if (reducedMotion) {
        commitTheme(nextTheme);
        activeTransition = Promise.resolve();
        return activeTransition;
      }
      return applyFallback(nextTheme);
    }

    const rect = button.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const radius = calculateThemeRevealRadius(
      originX,
      originY,
      windowRef?.innerWidth ?? 0,
      windowRef?.innerHeight ?? 0
    );

    root.style.setProperty("--theme-origin-x", `${originX}px`);
    root.style.setProperty("--theme-origin-y", `${originY}px`);
    root.style.setProperty("--theme-reveal-radius", `${radius}px`);
    root.classList.add("theme-view-transition");

    let transition;
    try {
      transition = documentRef.startViewTransition(() => commitTheme(nextTheme));
    } catch {
      root.classList.remove("theme-view-transition");
      return applyFallback(nextTheme);
    }

    activeTransition = Promise.resolve(transition?.finished)
      .catch(() => {})
      .finally(() => root.classList.remove("theme-view-transition"));
    return activeTransition;
  };

  button.addEventListener("click", toggle);

  return Object.freeze({
    get theme() {
      return currentTheme;
    },
    toggle,
    setVisible(visible) {
      setThemeSwitchVisible(button, visible);
    },
    whenSettled() {
      return activeTransition;
    }
  });
}
