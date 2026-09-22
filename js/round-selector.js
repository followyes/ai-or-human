const DEFAULT_RECENCY_WEIGHTS = Object.freeze({
  previousRound: 0.15,
  twoRoundsAgo: 0.35,
  threeRoundsAgo: 0.60,
  older: 1.0,
  unseen: 1.0
});

export function recencyWeight(roundGap, weights = DEFAULT_RECENCY_WEIGHTS) {
  if (roundGap === null || roundGap === undefined) return weights.unseen;
  if (roundGap <= 1) return weights.previousRound;
  if (roundGap === 2) return weights.twoRoundsAgo;
  if (roundGap === 3) return weights.threeRoundsAgo;
  return weights.older;
}

export class RoundSelector {
  constructor(images, { rng = Math.random, recencyWeights = DEFAULT_RECENCY_WEIGHTS } = {}) {
    if (!Array.isArray(images)) throw new TypeError("images must be an array");

    const ids = new Set();
    for (const image of images) {
      if (!image?.id || typeof image.id !== "string") {
        throw new TypeError("Every image must have a string id");
      }
      if (ids.has(image.id)) {
        throw new Error(`Duplicate image id: ${image.id}`);
      }
      ids.add(image.id);
    }

    this.images = [...images];
    this.rng = rng;
    this.recencyWeights = { ...DEFAULT_RECENCY_WEIGHTS, ...recencyWeights };
    this.lastSeenRound = new Map();
  }

  recordExposure(imageId, roundNumber) {
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      throw new RangeError("roundNumber must be a positive integer");
    }
    this.lastSeenRound.set(imageId, roundNumber);
  }

  getWeight(imageId, roundNumber) {
    const lastSeen = this.lastSeenRound.get(imageId);
    const gap = lastSeen === undefined ? null : roundNumber - lastSeen;
    return recencyWeight(gap, this.recencyWeights);
  }

  select(count, { roundNumber, excludeIds = new Set() } = {}) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError("count must be a positive integer");
    }
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      throw new RangeError("roundNumber must be a positive integer");
    }

    const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
    const candidates = this.images
      .filter((image) => !excluded.has(image.id))
      .map((image) => ({ image, weight: this.getWeight(image.id, roundNumber) }));

    if (candidates.length < count) {
      throw new Error(`Not enough eligible images: need ${count}, have ${candidates.length}`);
    }

    const selected = [];

    for (let pick = 0; pick < count; pick += 1) {
      const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
      if (!(totalWeight > 0)) {
        throw new Error("All candidate weights are zero");
      }

      let target = this.rng() * totalWeight;
      let chosenIndex = candidates.length - 1;

      for (let index = 0; index < candidates.length; index += 1) {
        target -= candidates[index].weight;
        if (target < 0) {
          chosenIndex = index;
          break;
        }
      }

      const [chosen] = candidates.splice(chosenIndex, 1);
      selected.push(chosen.image);
    }

    return selected;
  }
}

export { DEFAULT_RECENCY_WEIGHTS };
