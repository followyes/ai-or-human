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
  storage = globalThis.localStorage,
  acquireVisualStability = null
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
  let transitioning = false;

  const commitTheme = (nextTheme) => {
    currentTheme = applyTheme(nextTheme, {
      root,
      meta,
      switchButton: button,
      storage,
      persist: true
    });
  };

  const applyFallback = async (nextTheme) => {
    root.classList.add("theme-fallback-transition");
    try {
      // Make the class authoritative before changing the tokens.
      void root.offsetWidth;
      commitTheme(nextTheme);
      await new Promise((resolve) => {
        if (typeof windowRef?.setTimeout === "function") windowRef.setTimeout(resolve, 460);
        else resolve();
      });
    } finally {
      root.classList.remove("theme-fallback-transition");
    }
  };

  // Policy for rapid taps: ignore additional intents while a theme change is
  // pending/running. Never initiate two root View Transitions concurrently.
  const toggle = () => {
    if (transitioning) return activeTransition;
    transitioning = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    activeTransition = (async () => {
      let lease = null;
      try {
        // A visual-stability lease is generic: ThemeController does not know
        // which view or which type of decoration is currently running.
        lease = acquireVisualStability?.() ?? null;
        if (lease?.ready) await lease.ready;

        const nextTheme = getNextTheme(currentTheme);
        const reducedMotion = prefersReducedMotion(windowRef);
        const canViewTransition = typeof documentRef.startViewTransition === "function";
        if (reducedMotion) {
          commitTheme(nextTheme);
          return;
        }
        if (!canViewTransition) {
          await applyFallback(nextTheme);
          return;
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

        try {
          const transition = documentRef.startViewTransition(() => commitTheme(nextTheme));
          await Promise.resolve(transition?.finished);
        } catch {
          if (currentTheme !== nextTheme) await applyFallback(nextTheme);
        } finally {
          root.classList.remove("theme-view-transition");
        }
      } finally {
        lease?.release?.();
        transitioning = false;
        button.disabled = Boolean(button.hidden);
        button.removeAttribute("aria-busy");
      }
    })();
    return activeTransition;
  };

  button.addEventListener("click", toggle);

  return Object.freeze({
    get theme() { return currentTheme; },
    toggle,
    setVisible(visible) {
      setThemeSwitchVisible(button, visible);
      if (transitioning) button.disabled = true;
    },
    whenSettled() { return activeTransition; }
  });
}
