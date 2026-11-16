/**
 * Shared no-repeat image rotation for Classic and Speed Run.
 * Only images actually revealed to a player are persisted; preloads are plans,
 * not exposures. Every local Player ID owns a separate cycle.
 */
export const IMAGE_ROTATION_STORAGE_PREFIX = "ai-or-human.image-rotation.v1.";

export function browserImageRotationStorage() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}
const MAX_SAVED_BYTES = 800_000;
const MAX_IMAGE_IDS = 20_000;

function toIdSet(values) {
  return values instanceof Set ? new Set(values) : new Set(values ?? []);
}

function loadState(storage, key, eligible) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_SAVED_BYTES) return null;
    const state = JSON.parse(raw);
    if (state?.version !== 1 || !Array.isArray(state.seenIds) ||
        state.seenIds.length > MAX_IMAGE_IDS ||
        !(state.lastId === null || typeof state.lastId === "string")) return null;
    if (!state.seenIds.every((id) => typeof id === "string" && id.length <= 128)) return null;
    return {
      seen: new Set(state.seenIds.filter((id) => eligible.has(id))),
      lastId: eligible.has(state.lastId) ? state.lastId : null
    };
  } catch {
    // No access to storage, malformed legacy data, or private browsing.
    return null;
  }
}

export class ImageRotation {
  constructor(images, { playerId = null, storage = null, rng = Math.random } = {}) {
    if (!Array.isArray(images) || !images.length || typeof rng !== "function") {
      throw new TypeError("ImageRotation requires a nonempty image catalog and RNG");
    }
    const ids = new Set();
    for (const image of images) {
      if (typeof image?.id !== "string" || !image.id || image.id.length > 128 || ids.has(image.id)) {
        throw new Error("Image catalog must contain unique, nonempty IDs (max 128 characters)");
      }
      ids.add(image.id);
    }
    if (ids.size > MAX_IMAGE_IDS) throw new RangeError("Image catalog exceeds rotation limit");
    if (playerId !== null && !/^[a-zA-Z0-9-]{1,64}$/.test(playerId)) {
      throw new TypeError("Invalid Player ID for image rotation");
    }
    this.images = [...images];
    this.byId = new Map(images.map((image) => [image.id, image]));
    this.rng = rng;
    this.storage = storage;
    this.storageKey = playerId ? `${IMAGE_ROTATION_STORAGE_PREFIX}${playerId}` : null;
    const saved = loadState(storage, this.storageKey, ids);
    this.seen = saved?.seen ?? new Set();
    this.lastId = saved?.lastId ?? null;
  }

  get seenCount() { return this.seen.size; }

  // 'priorIds' are preloaded/picked images that have not yet been displayed.
  // Simulating them maintains cycle order without committing anything.
  // 'invalidIds' retire broken images from this run, not from the saved history.
  select(count, { priorIds = [], invalidIds = new Set() } = {}) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be positive");
    const invalid = toIdSet(invalidIds);
    const active = this.images.filter((item) => !invalid.has(item.id));
    const activeIds = new Set(active.map((item) => item.id));
    const alreadyPlanned = [...priorIds];
    const used = new Set(alreadyPlanned);
    if (used.size !== alreadyPlanned.length || alreadyPlanned.some((id) => !activeIds.has(id))) {
      throw new Error("Invalid or duplicate provisional image IDs");
    }
    if (count > active.length - used.size) {
      throw new Error(`Not enough eligible images: need ${count}, have ${active.length - used.size}`);
    }
    const simulatedSeen = new Set([...this.seen].filter((id) => activeIds.has(id)));
    let previous = this.lastId;
    const apply = (id) => {
      if (simulatedSeen.size === active.length) simulatedSeen.clear();
      simulatedSeen.add(id);
      previous = id;
    };
    alreadyPlanned.forEach(apply);

    const selected = [];
    for (let index = 0; index < count; index += 1) {
      const newCycle = simulatedSeen.size === active.length;
      if (newCycle) simulatedSeen.clear();
      let choices = active.filter((item) => !used.has(item.id) && !simulatedSeen.has(item.id));
      if (!choices.length) throw new Error("Rotation exhausted before completing the selection");
      // A cycle boundary must not immediately repeat the previous image.
      if (newCycle && choices.length > 1) {
        choices = choices.filter((item) => item.id !== previous);
      }
      const fraction = this.rng();
      const position = Math.max(0, Math.min(choices.length - 1,
        Number.isFinite(fraction) ? Math.floor(fraction * choices.length) : 0));
      const chosen = choices[position];
      selected.push(chosen);
      used.add(chosen.id);
      apply(chosen.id);
    }
    return selected;
  }

  recordExposure(imageId, { invalidIds = new Set() } = {}) {
    const invalid = toIdSet(invalidIds);
    if (!this.byId.has(imageId) || invalid.has(imageId)) {
      throw new Error("Cannot record unknown or unavailable image");
    }
    const activeIds = new Set(this.images.filter((item) => !invalid.has(item.id)).map((item) => item.id));
    this.seen = new Set([...this.seen].filter((id) => activeIds.has(id)));
    if (this.seen.size === activeIds.size) this.seen.clear();
    this.seen.add(imageId);
    this.lastId = imageId;
    try {
      if (this.storage && this.storageKey) this.storage.setItem(this.storageKey, JSON.stringify({
        version: 1, seenIds: [...this.seen], lastId: this.lastId
      }));
    } catch {
      // A storage quota error cannot stop a live game; the in-memory cycle remains valid.
    }
  }
}
