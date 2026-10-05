import {
  AdminContentError,
  copyStorageObject,
  removeStorageObject,
  updateGameImageMoveMetadata
} from "./admin-content.js";

const VALID_CLASSES = new Set(["ai", "human"]);

function requireTargetClass(value) {
  if (!VALID_CLASSES.has(value)) {
    throw new AdminContentError("MOVE_TARGET_CLASS_INVALID", "Nieprawidłowa kategoria docelowa.");
  }
}

function requireMoveImage(image) {
  if (!image || typeof image !== "object" || typeof image.id !== "string") {
    throw new AdminContentError("MOVE_IMAGE_INVALID", "Brak kompletnego rekordu obrazu do przeniesienia.");
  }
  if (!VALID_CLASSES.has(image.content_class)) {
    throw new AdminContentError("MOVE_SOURCE_CLASS_INVALID", "Nieprawidłowa kategoria źródłowa obrazu.");
  }
  if (typeof image.storage_path !== "string" || !image.storage_path) {
    throw new AdminContentError("MOVE_SOURCE_PATH_INVALID", "Brak prawidłowej ścieżki obrazu źródłowego.");
  }
}

export function deriveMovePaths(image, targetClass) {
  requireMoveImage(image);
  requireTargetClass(targetClass);

  const sourceClass = image.content_class;
  const match = image.storage_path.match(/^(ai|human)\/([^/]+\.avif)$/i);
  if (!match || match[1].toLowerCase() !== sourceClass) {
    throw new AdminContentError(
      "MOVE_SOURCE_PATH_CLASS_MISMATCH",
      "Ścieżka obrazu źródłowego nie zgadza się z jego kategorią."
    );
  }

  const basename = match[2];
  const sourceThumbnailPath = typeof image.thumbnail_path === "string" && image.thumbnail_path.trim()
    ? image.thumbnail_path
    : null;

  if (sourceThumbnailPath) {
    const expected = `${sourceClass}/_previews/v1/${basename}`;
    if (sourceThumbnailPath !== expected) {
      throw new AdminContentError(
        "MOVE_PREVIEW_PATH_CLASS_MISMATCH",
        "Ścieżka miniatury nie zgadza się z kategorią obrazu."
      );
    }
  }

  return Object.freeze({
    sourceClass,
    targetClass,
    sourceStoragePath: image.storage_path,
    targetStoragePath: `${targetClass}/${basename}`,
    sourceThumbnailPath,
    targetThumbnailPath: sourceThumbnailPath
      ? `${targetClass}/_previews/v1/${basename}`
      : null,
    noop: sourceClass === targetClass
  });
}

async function cleanupCopiedTargets(paths, {
  session,
  removeObject,
  config,
  fetchImpl
}) {
  const failures = [];
  for (const storagePath of paths) {
    try {
      await removeObject({ session, storagePath, config, fetchImpl });
    } catch (error) {
      failures.push({ storagePath, error });
    }
  }
  return failures;
}

export async function moveGameImageToClass({
  session,
  image,
  targetClass,
  config,
  fetchImpl = globalThis.fetch,
  copyObject = copyStorageObject,
  commitMetadata = updateGameImageMoveMetadata,
  removeObject = removeStorageObject
} = {}) {
  const paths = deriveMovePaths(image, targetClass);
  if (paths.noop) {
    return Object.freeze({ kind: "noop", image, paths, cleanupWarnings: Object.freeze([]) });
  }

  let originalCopied = false;
  let previewCopied = false;
  let committedRow = null;

  try {
    await copyObject({
      session,
      sourcePath: paths.sourceStoragePath,
      destinationPath: paths.targetStoragePath,
      config,
      fetchImpl
    });
    originalCopied = true;

    if (paths.sourceThumbnailPath) {
      await copyObject({
        session,
        sourcePath: paths.sourceThumbnailPath,
        destinationPath: paths.targetThumbnailPath,
        config,
        fetchImpl
      });
      previewCopied = true;
    }

    committedRow = await commitMetadata({
      session,
      image,
      targetClass,
      targetStoragePath: paths.targetStoragePath,
      targetThumbnailPath: paths.targetThumbnailPath,
      config,
      fetchImpl
    });
  } catch (error) {
    const cleanupPaths = [
      ...(previewCopied ? [paths.targetThumbnailPath] : []),
      ...(originalCopied ? [paths.targetStoragePath] : [])
    ];
    const cleanupFailures = await cleanupCopiedTargets(cleanupPaths, {
      session,
      removeObject,
      config,
      fetchImpl
    });

    if (cleanupFailures.length) {
      const cleanupSessionFailure = cleanupFailures.find(({ error: cleanupError }) =>
        cleanupError instanceof AdminContentError &&
        (cleanupError.status === 401 || cleanupError.status === 403)
      );
      const status = cleanupSessionFailure?.error?.status ??
        (error instanceof AdminContentError ? error.status : null);

      throw new AdminContentError(
        "MOVE_PRECOMMIT_FAILED_CLEANUP_FAILED",
        "Przeniesienie nie zostało zatwierdzone, a sprzątanie kopii docelowych nie powiodło się w całości.",
        {
          status,
          details: { imageId: image.id, originalError: error, cleanupFailures, paths },
          cause: error
        }
      );
    }

    throw error;
  }

  const cleanupWarnings = [];
  const sourceCleanupPaths = [
    ...(paths.sourceThumbnailPath ? [paths.sourceThumbnailPath] : []),
    paths.sourceStoragePath
  ];

  for (const storagePath of sourceCleanupPaths) {
    try {
      await removeObject({ session, storagePath, config, fetchImpl });
    } catch (error) {
      cleanupWarnings.push(Object.freeze({ storagePath, error }));
    }
  }

  return Object.freeze({
    kind: "moved",
    image,
    row: committedRow,
    paths,
    cleanupWarnings: Object.freeze(cleanupWarnings)
  });
}

export async function runSequentialMoveBatch(items, targetClass, {
  moveItem,
  onItemStart = () => {},
  onItemSuccess = () => {},
  onItemFailure = () => {},
  shouldAbort = () => false
} = {}) {
  requireTargetClass(targetClass);
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof moveItem !== "function") throw new TypeError("moveItem must be a function");

  const eligible = items.filter((item) => item?.content_class !== targetClass);
  const failures = [];
  const cleanupWarnings = [];
  let movedCount = 0;
  let aborted = false;
  let abortError = null;

  for (let index = 0; index < eligible.length; index += 1) {
    const image = eligible[index];
    onItemStart({ image, index, total: eligible.length });

    try {
      const result = await moveItem(image, targetClass);
      movedCount += result?.kind === "moved" ? 1 : 0;
      if (Array.isArray(result?.cleanupWarnings) && result.cleanupWarnings.length) {
        cleanupWarnings.push(...result.cleanupWarnings.map((warning) => ({ image, warning })));
      }
      onItemSuccess({ image, result, index, total: eligible.length });
    } catch (error) {
      failures.push({ image, error });
      onItemFailure({ image, error, index, total: eligible.length });
      if (shouldAbort(error)) {
        aborted = true;
        abortError = error;
        break;
      }
    }
  }

  return Object.freeze({
    attemptedCount: eligible.length,
    movedCount,
    failedCount: failures.length,
    skippedCount: items.length - eligible.length,
    failures: Object.freeze(failures),
    cleanupWarnings: Object.freeze(cleanupWarnings),
    aborted,
    abortError
  });
}
