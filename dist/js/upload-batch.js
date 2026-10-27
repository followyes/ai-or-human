export function summarizeUploadBatch(total, {
  completed = 0,
  duplicates = 0,
  failed = 0
} = {}) {
  const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
  const normalizedCompleted = Math.max(0, Math.floor(Number(completed) || 0));
  const normalizedDuplicates = Math.max(0, Math.floor(Number(duplicates) || 0));
  const normalizedFailed = Math.max(0, Math.floor(Number(failed) || 0));
  const waiting = Math.max(
    0,
    normalizedTotal - normalizedCompleted - normalizedDuplicates - normalizedFailed
  );

  return Object.freeze({
    total: normalizedTotal,
    completed: normalizedCompleted,
    duplicates: normalizedDuplicates,
    failed: normalizedFailed,
    waiting
  });
}

export function promoteQueueItem(container, item) {
  if (!container || typeof container.prepend !== "function" || !item) {
    throw new TypeError("A valid queue container and item are required");
  }

  container.prepend(item);
  if ("scrollTop" in container) container.scrollTop = 0;
}

export async function runSequentialUploadBatch(entries, {
  processEntry,
  onSuccess = null,
  onFailure = null,
  shouldAbort = null
} = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("entries must be an array");
  }
  if (typeof processEntry !== "function") {
    throw new TypeError("processEntry must be a function");
  }

  let processed = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    try {
      const result = await processEntry(entry, index);
      processed += 1;
      if (typeof onSuccess === "function") {
        await onSuccess({ entry, index, result });
      }
    } catch (error) {
      processed += 1;
      if (typeof onFailure === "function") {
        await onFailure({ entry, index, error });
      }

      if (typeof shouldAbort === "function" && shouldAbort(error, entry, index)) {
        return Object.freeze({
          aborted: true,
          processed,
          remaining: entries.length - processed,
          error
        });
      }
    }
  }

  return Object.freeze({
    aborted: false,
    processed,
    remaining: 0,
    error: null
  });
}

export async function runPipelinedUploadBatch(entries, {
  prepareEntry,
  commitEntry,
  onSuccess = null,
  onFailure = null,
  shouldAbort = null
} = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("entries must be an array");
  }
  if (typeof prepareEntry !== "function") {
    throw new TypeError("prepareEntry must be a function");
  }
  if (typeof commitEntry !== "function") {
    throw new TypeError("commitEntry must be a function");
  }

  const startPrepare = (entry, index) => Promise.resolve()
    .then(() => prepareEntry(entry, index))
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    );

  let processed = 0;
  let nextPreparePromise = entries.length ? startPrepare(entries[0], 0) : null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const preparation = await nextPreparePromise;

    if (!preparation.ok) {
      const { error } = preparation;
      processed += 1;
      if (typeof onFailure === "function") {
        await onFailure({ entry, index, error, stage: "prepare" });
      }

      if (typeof shouldAbort === "function" && shouldAbort(error, entry, index)) {
        return Object.freeze({
          aborted: true,
          processed,
          remaining: entries.length - processed,
          error
        });
      }

      nextPreparePromise = index + 1 < entries.length
        ? startPrepare(entries[index + 1], index + 1)
        : null;
      continue;
    }

    // Start exactly one next preparation before committing the current item.
    // This overlaps CPU/hash preparation with network commit while never running
    // two heavy image preparations at the same time.
    nextPreparePromise = index + 1 < entries.length
      ? startPrepare(entries[index + 1], index + 1)
      : null;

    try {
      const result = await commitEntry({ entry, index, prepared: preparation.value });
      processed += 1;
      if (typeof onSuccess === "function") {
        await onSuccess({ entry, index, result });
      }
    } catch (error) {
      processed += 1;
      if (typeof onFailure === "function") {
        await onFailure({ entry, index, error, stage: "commit" });
      }

      if (typeof shouldAbort === "function" && shouldAbort(error, entry, index)) {
        return Object.freeze({
          aborted: true,
          processed,
          remaining: entries.length - processed,
          error
        });
      }
    }
  }

  return Object.freeze({
    aborted: false,
    processed,
    remaining: 0,
    error: null
  });
}
