const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;

export function preloadImage(src, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback(value);
    };

    const timer = window.setTimeout(() => {
      finish(reject, new Error(`Image preload timed out: ${src}`));
    }, timeoutMs);

    image.onload = () => finish(resolve, image);
    image.onerror = () => finish(reject, new Error(`Image preload failed: ${src}`));
    image.src = src;
  });
}

async function preloadWithConcurrency(candidates, { timeoutMs, concurrency }) {
  const results = new Array(candidates.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;

      try {
        await preloadImage(candidates[index].src, { timeoutMs });
        results[index] = { status: "fulfilled" };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  const workerCount = Math.min(concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export class RoundPreloader {
  constructor(
    selector,
    {
      roundSize = 20,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      concurrency = DEFAULT_CONCURRENCY
    } = {}
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError("concurrency must be a positive integer");
    }

    this.selector = selector;
    this.roundSize = roundSize;
    this.timeoutMs = timeoutMs;
    this.concurrency = concurrency;
    this.invalidImageIds = new Set();
  }

  async prepare(roundNumber) {
    const prepared = [];
    const selectedIds = new Set();

    while (prepared.length < this.roundSize) {
      const needed = this.roundSize - prepared.length;
      const excluded = new Set([...this.invalidImageIds, ...selectedIds]);
      let candidates;

      try {
        candidates = this.selector.select(needed, {
          roundNumber,
          excludeIds: excluded
        });
      } catch {
        throw new Error(
          `Nie udało się przygotować ${this.roundSize} poprawnych obrazów do rundy.`
        );
      }

      const results = await preloadWithConcurrency(candidates, {
        timeoutMs: this.timeoutMs,
        concurrency: this.concurrency
      });

      candidates.forEach((item, index) => {
        selectedIds.add(item.id);
        if (results[index].status === "fulfilled") {
          prepared.push(item);
        } else {
          this.invalidImageIds.add(item.id);
        }
      });
    }

    return prepared;
  }
}
