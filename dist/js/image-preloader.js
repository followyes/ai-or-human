const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;

function hasDecodedPixels(image) {
  return Boolean(image?.complete && Number(image.naturalWidth) > 0);
}

async function decodeLoadedImage(image) {
  if (typeof image.decode !== "function") return;

  try {
    await image.decode();
  } catch (error) {
    // Some browsers/formats can reject decode() even though the loaded image is displayable.
    // Treat it as fatal only when the element no longer has valid decoded dimensions.
    if (!hasDecodedPixels(image)) throw error;
  }
}

export function loadImageIntoElement(image, src, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!image) throw new TypeError("image element is required");
  if (typeof src !== "string" || !src) throw new TypeError("image src is required");

  return new Promise((resolve, reject) => {
    let settled = false;
    let loadHandled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      image.removeEventListener?.("load", handleLoad);
      image.removeEventListener?.("error", handleError);
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const handleLoad = async () => {
      if (settled || loadHandled) return;
      loadHandled = true;

      try {
        await decodeLoadedImage(image);
        finish(resolve, image);
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error(String(error)));
      }
    };

    const handleError = () => {
      finish(reject, new Error(`Image load failed: ${src}`));
    };

    const timer = window.setTimeout(() => {
      finish(reject, new Error(`Image load timed out: ${src}`));
    }, timeoutMs);

    image.addEventListener?.("load", handleLoad);
    image.addEventListener?.("error", handleError);
    image.src = src;

    // Cached resources can already be complete before the event listener receives a new event.
    if (hasDecodedPixels(image)) {
      queueMicrotask(handleLoad);
    }
  });
}

export function preloadImage(src, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const image = new Image();
  image.decoding = "async";
  return loadImageIntoElement(image, src, { timeoutMs });
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

  async prepare(roundNumber, { roundSize = this.roundSize } = {}) {
    if (!Number.isInteger(roundSize) || roundSize < 1) {
      throw new RangeError("roundSize must be a positive integer");
    }

    const prepared = [];
    const selectedIds = new Set();

    while (prepared.length < roundSize) {
      const needed = roundSize - prepared.length;
      const excluded = new Set([...this.invalidImageIds, ...selectedIds]);
      let candidates;

      try {
        candidates = this.selector.select(needed, {
          roundNumber,
          excludeIds: excluded
        });
      } catch {
        throw new Error(
          `Nie udało się przygotować ${roundSize} poprawnych obrazów do sesji.`
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
