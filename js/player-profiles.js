/**
 * Anonymous profiles are scoped to a browser origin, not verified identities.
 * Browser ID groups profiles from this local installation; it is NOT a device fingerprint.
 */
import { normalizePlayerName, readPlayerName, PLAYER_NAME_STORAGE_KEY } from "./player-name.js";

export const LOCAL_PROFILES_STORAGE_KEY = "ai-or-human.player-profiles.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROFILES = 100;

export function isValidLocalId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function makeLocalId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  // Secure getRandomValues fallback for browsers without crypto.randomUUID().
  if (typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("Przeglądarka nie obsługuje bezpiecznego generowania identyfikatorów.");
  }
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function parseLocalProfileState(raw) {
  if (typeof raw !== "string" || raw.length > 20000) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !isValidLocalId(data.browserId) || !Array.isArray(data.profiles) || data.profiles.length > MAX_PROFILES) return null;
    const seen = new Set();
    const profiles = [];
    for (const value of data.profiles) {
      const name = normalizePlayerName(value?.name);
      if (!isValidLocalId(value?.id) || seen.has(value.id) || !name) return null;
      seen.add(value.id);
      profiles.push({ id: value.id, name });
    }
    const activeId = data.activeId === null ? null : data.activeId;
    if (activeId !== null && !seen.has(activeId)) return null;
    return { version: 1, browserId: data.browserId, profiles, activeId };
  } catch {
    return null;
  }
}

export class LocalPlayerProfiles {
  constructor({ storage = null, uuid = () => makeLocalId(), legacyName = undefined } = {}) {
    this.storage = storage;
    this.uuid = uuid;
    this.persisted = false;
    let existing = null;
    try { existing = parseLocalProfileState(storage?.getItem(LOCAL_PROFILES_STORAGE_KEY)); }
    catch { /* Storage denied. Continue in memory. */ }
    this.data = existing ?? { version: 1, browserId: uuid(), profiles: [], activeId: null };
    if (!existing) {
      // Preserve the V1.7.1B alias only once, never merge by a typed name.
      const oldName = legacyName === undefined ? readPlayerName(storage) : normalizePlayerName(legacyName);
      if (oldName) {
        const profile = { id: uuid(), name: oldName };
        this.data.profiles.push(profile);
        this.data.activeId = profile.id;
      }
    }
    this.persist();
  }

  persist() {
    try {
      if (!this.storage) return false;
      this.storage.setItem(LOCAL_PROFILES_STORAGE_KEY, JSON.stringify(this.data));
      this.persisted = true;
      return true;
    } catch {
      this.persisted = false;
      return false;
    }
  }

  get browserId() { return this.data.browserId; }
  get active() { return this.data.profiles.find((item) => item.id === this.data.activeId) ?? null; }
  get profiles() { return this.data.profiles.map((item) => ({ ...item })); }

  create(name) {
    const normalized = normalizePlayerName(name);
    if (!normalized) throw new Error("Podaj nazwę gracza: jeden wyraz, do 20 znaków.");
    if (this.data.profiles.length >= MAX_PROFILES) throw new Error("Limit lokalnych profili został osiągnięty.");
    const id = this.uuid();
    if (!isValidLocalId(id) || this.data.profiles.some((item) => item.id === id)) throw new Error("Błąd generowania unikalnego identyfikatora.");
    const profile = { id, name: normalized };
    this.data.profiles.push(profile);
    this.data.activeId = id;
    this.persist();
    return { ...profile };
  }

  activate(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return null;
    this.data.activeId = id;
    this.persist();
    return { ...profile };
  }
}

export function createBrowserProfiles() {
  let storage = null;
  try { storage = globalThis.localStorage ?? null; } catch { /* disabled */ }
  return new LocalPlayerProfiles({ storage });
}
