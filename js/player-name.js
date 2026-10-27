// This is a local display name, NOT an authenticated account or verified identity.
export const PLAYER_NAME_STORAGE_KEY = "ai-or-human.player-name";
export const PLAYER_NAME_MAX_LENGTH = 20;

export function normalizePlayerName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().normalize("NFC");
  if ([...name].length < 1 || [...name].length > PLAYER_NAME_MAX_LENGTH) return null;
  return /^[\p{L}\p{N}_-]+$/u.test(name) ? name : null;
}

function browserStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; }
  catch { return null; }
}

export function readPlayerName(storage = browserStorage()) {
  try { return normalizePlayerName(storage?.getItem(PLAYER_NAME_STORAGE_KEY)); }
  catch { return null; }
}

export function storePlayerName(storage, value) {
  const name = normalizePlayerName(value);
  if (!name) return null;
  try { storage?.setItem(PLAYER_NAME_STORAGE_KEY, name); }
  catch { /* Private mode / storage denial must not prevent play. */ }
  return name;
}

export function savePlayerName(name) {
  return storePlayerName(browserStorage(), name);
}
