import { buildPublicStorageUrl, resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const GAME_IMAGES_BUCKET = "game-images";
export const CONTENT_REQUEST_TIMEOUT_MS = 20000;
export const INVENTORY_PAGE_SIZE = 250;
export const INVENTORY_MAX_PAGES = 1000;

export class AdminContentError extends Error {
  constructor(code, message, { status = null, details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AdminContentError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function resolveConfig(config) {
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) {
    throw new AdminContentError(
      "CONTENT_CONFIG_MISSING",
      "Brak konfiguracji Supabase dla panelu contentu."
    );
  }
  return resolved;
}

function requireSession(session) {
  if (!session?.access_token) {
    throw new AdminContentError(
      "CONTENT_SESSION_MISSING",
      "Brak aktywnej sesji administratora.",
      { status: 401 }
    );
  }
}

function requireContentClass(contentClass) {
  if (contentClass !== "ai" && contentClass !== "human") {
    throw new AdminContentError(
      "CONTENT_CLASS_INVALID",
      "Wybierz kategorię AI albo HUMAN."
    );
  }
}

function authHeaders(publishableKey, accessToken, extra = {}) {
  return {
    Accept: "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    ...extra
  };
}

async function request(url, {
  fetchImpl = globalThis.fetch,
  method = "GET",
  headers = {},
  body = undefined,
  expectJson = true,
  timeoutMs = CONTENT_REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new AdminContentError(
      "CONTENT_FETCH_UNAVAILABLE",
      "Przeglądarka nie udostępnia funkcji fetch()."
    );
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      cache: "no-store",
      headers,
      body,
      ...(controller ? { signal: controller.signal } : {})
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AdminContentError(
        "CONTENT_REQUEST_TIMEOUT",
        "Supabase nie odpowiedział w wymaganym czasie.",
        { cause: error }
      );
    }

    throw new AdminContentError(
      "CONTENT_NETWORK_FAILED",
      "Nie udało się połączyć z Supabase.",
      { cause: error }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  let payload = null;
  if (expectJson) {
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok && response.status === 204) return null;
      throw new AdminContentError(
        "CONTENT_RESPONSE_INVALID",
        "Supabase zwrócił nieprawidłową odpowiedź.",
        { status: response.status, cause: error }
      );
    }
  }

  if (!response.ok) {
    const code =
      (typeof payload?.code === "string" && payload.code) ||
      (typeof payload?.error === "string" && payload.error) ||
      "CONTENT_HTTP_ERROR";

    const message =
      (typeof payload?.message === "string" && payload.message) ||
      (typeof payload?.error_description === "string" && payload.error_description) ||
      "Supabase odrzucił operację na contencie.";

    throw new AdminContentError(code, message, {
      status: response.status,
      details: payload
    });
  }

  return payload;
}

function buildRestUrl(projectUrl, table) {
  return new URL(`/rest/v1/${table}`, `${projectUrl}/`);
}

function encodeStoragePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function requireImageId(id) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new AdminContentError("IMAGE_ID_INVALID", "Nieprawidłowy identyfikator obrazu.");
  }
}

function duplicateMessage(existing, requestedClass, kind) {
  const existingClass = existing?.content_class?.toUpperCase?.() || "INNEJ KATEGORII";
  const requested = requestedClass?.toUpperCase?.() || "WYBRANEJ KATEGORII";
  const filename = existing?.original_filename ? ` (${existing.original_filename})` : "";

  if (existing?.content_class === requestedClass) {
    return kind === "avif"
      ? `Taki sam wynik AVIF już istnieje w kategorii ${existingClass}${filename}.`
      : `Ten obraz już istnieje w kategorii ${existingClass}${filename}.`;
  }

  return `Ten sam obraz jest już przypisany do ${existingClass}${filename}. Usuń go z ${existingClass}, jeśli chcesz dodać go jako ${requested}.`;
}

function normalizeInventoryRow(row, projectUrl) {
  if (
    !row ||
    typeof row.id !== "string" ||
    (row.content_class !== "ai" && row.content_class !== "human") ||
    typeof row.storage_bucket !== "string" ||
    typeof row.storage_path !== "string"
  ) {
    throw new AdminContentError(
      "INVENTORY_ROW_INVALID",
      "Supabase zwrócił nieprawidłowy rekord biblioteki."
    );
  }

  const thumbnailPath = typeof row.thumbnail_path === "string" && row.thumbnail_path.trim()
    ? row.thumbnail_path
    : null;

  return Object.freeze({
    ...row,
    thumbnail_path: thumbnailPath,
    public_url: buildPublicStorageUrl(projectUrl, row.storage_bucket, row.storage_path),
    thumbnail_public_url: thumbnailPath
      ? buildPublicStorageUrl(projectUrl, row.storage_bucket, thumbnailPath)
      : null
  });
}

export function createStoragePath(contentClass, {
  uuid = globalThis.crypto?.randomUUID?.()
} = {}) {
  requireContentClass(contentClass);

  if (!uuid || typeof uuid !== "string") {
    throw new AdminContentError(
      "UUID_UNAVAILABLE",
      "Przeglądarka nie potrafi utworzyć bezpiecznej nazwy pliku."
    );
  }

  return `${contentClass}/${uuid}.avif`;
}

export function createThumbnailStoragePath(storagePath) {
  if (typeof storagePath !== "string") {
    throw new AdminContentError(
      "THUMBNAIL_PATH_SOURCE_INVALID",
      "Nieprawidłowa ścieżka obrazu źródłowego."
    );
  }

  const match = storagePath.match(/^(ai|human)\/(.+\.avif)$/i);
  if (!match || match[2].startsWith("_previews/")) {
    throw new AdminContentError(
      "THUMBNAIL_PATH_SOURCE_INVALID",
      "Nieprawidłowa ścieżka obrazu źródłowego."
    );
  }

  return `${match[1].toLowerCase()}/_previews/v1/${match[2]}`;
}

export async function findImageByHash({
  session,
  field,
  hash,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);

  if (field !== "source_sha256" && field !== "avif_sha256") {
    throw new AdminContentError("HASH_FIELD_INVALID", "Nieprawidłowe pole hash.");
  }

  if (!/^[0-9a-f]{64}$/.test(hash || "")) {
    throw new AdminContentError("HASH_INVALID", "Nieprawidłowy SHA-256.");
  }

  const resolved = resolveConfig(config);
  const url = buildRestUrl(resolved.projectUrl, "game_images");
  url.searchParams.set(
    "select",
    "id,content_class,original_filename,source_sha256,avif_sha256,storage_path,is_active"
  );
  url.searchParams.set(field, `eq.${hash}`);
  url.searchParams.set("limit", "1");

  const rows = await request(url, {
    fetchImpl,
    headers: authHeaders(resolved.publishableKey, session.access_token)
  });

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function assertImageHashAvailable({
  session,
  field,
  hash,
  requestedClass,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireContentClass(requestedClass);

  const existing = await findImageByHash({
    session,
    field,
    hash,
    config,
    fetchImpl
  });

  if (!existing) return true;

  const kind = field === "avif_sha256" ? "avif" : "source";
  throw new AdminContentError(
    kind === "avif" ? "AVIF_DUPLICATE" : "SOURCE_DUPLICATE",
    duplicateMessage(existing, requestedClass, kind),
    { details: existing }
  );
}

export async function listGameImages({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch,
  pageSize = INVENTORY_PAGE_SIZE,
  maxPages = INVENTORY_MAX_PAGES
} = {}) {
  requireSession(session);

  const resolved = resolveConfig(config);
  const normalizedPageSize = Math.max(1, Math.floor(Number(pageSize) || INVENTORY_PAGE_SIZE));
  const normalizedMaxPages = Math.max(1, Math.floor(Number(maxPages) || INVENTORY_MAX_PAGES));
  const rows = [];
  let offset = 0;

  for (let page = 0; page < normalizedMaxPages; page += 1) {
    const url = buildRestUrl(resolved.projectUrl, "game_images");
    url.searchParams.set(
      "select",
      "id,content_class,storage_bucket,storage_path,thumbnail_path,original_filename,source_sha256,avif_sha256,width,height,file_size_bytes,is_active,created_at,updated_at"
    );
    url.searchParams.set("order", "created_at.desc,id.desc");
    url.searchParams.set("limit", String(normalizedPageSize));
    url.searchParams.set("offset", String(offset));

    const batch = await request(url, {
      fetchImpl,
      headers: authHeaders(resolved.publishableKey, session.access_token)
    });

    if (!Array.isArray(batch)) {
      throw new AdminContentError(
        "INVENTORY_RESPONSE_INVALID",
        "Supabase zwrócił nieprawidłową listę contentu."
      );
    }

    if (!batch.length) {
      return Object.freeze(rows.map((row) => normalizeInventoryRow(row, resolved.projectUrl)));
    }

    rows.push(...batch);
    offset += batch.length;
  }

  throw new AdminContentError(
    "INVENTORY_PAGE_LIMIT",
    "Biblioteka przekroczyła bezpieczny limit paginacji panelu."
  );
}

async function updateGameImageActivity({
  session,
  imageId,
  isActive,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);
  requireImageId(imageId);

  const resolved = resolveConfig(config);
  const url = buildRestUrl(resolved.projectUrl, "game_images");
  url.searchParams.set("id", `eq.${imageId}`);

  const rows = await request(url, {
    fetchImpl,
    method: "PATCH",
    headers: authHeaders(resolved.publishableKey, session.access_token, {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ is_active: Boolean(isActive) })
  });

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AdminContentError(
      "ACTIVITY_UPDATE_NOT_CONFIRMED",
      "Supabase nie potwierdził zmiany statusu obrazu."
    );
  }

  return rows[0];
}

async function deleteGameImageMetadata({
  session,
  imageId,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);
  requireImageId(imageId);

  const resolved = resolveConfig(config);
  const url = buildRestUrl(resolved.projectUrl, "game_images");
  url.searchParams.set("id", `eq.${imageId}`);

  const rows = await request(url, {
    fetchImpl,
    method: "DELETE",
    headers: authHeaders(resolved.publishableKey, session.access_token, {
      Prefer: "return=representation"
    })
  });

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AdminContentError(
      "METADATA_DELETE_NOT_CONFIRMED",
      "Supabase nie potwierdził usunięcia rekordu metadata."
    );
  }

  return rows[0];
}

export async function deleteGameImage({
  session,
  image,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);

  if (!image || typeof image.id !== "string" || typeof image.storage_path !== "string" || !image.storage_path) {
    throw new AdminContentError(
      "DELETE_IMAGE_INVALID",
      "Brak kompletnego rekordu obrazu do usunięcia."
    );
  }

  requireImageId(image.id);

  const thumbnailPath = typeof image.thumbnail_path === "string" && image.thumbnail_path.trim()
    ? image.thumbnail_path
    : null;
  const wasActive = image.is_active === true;
  let deactivated = false;

  if (wasActive) {
    await updateGameImageActivity({
      session,
      imageId: image.id,
      isActive: false,
      config,
      fetchImpl
    });
    deactivated = true;
  }

  const restoreActivityAfterStorageFailure = async (storageError, stage) => {
    if (deactivated) {
      try {
        await updateGameImageActivity({
          session,
          imageId: image.id,
          isActive: true,
          config,
          fetchImpl
        });
      } catch (restoreError) {
        throw new AdminContentError(
          "DELETE_STORAGE_FAILED_RESTORE_FAILED",
          "Nie udało się usunąć pliku ze Storage ani przywrócić jego aktywnego statusu.",
          {
            details: { storageError, restoreError, imageId: image.id, stage },
            cause: storageError
          }
        );
      }
    }

    throw storageError;
  };

  if (thumbnailPath) {
    try {
      await removeStorageObject({
        session,
        storagePath: thumbnailPath,
        config,
        fetchImpl
      });
    } catch (storageError) {
      return restoreActivityAfterStorageFailure(storageError, "thumbnail");
    }
  }

  try {
    await removeStorageObject({
      session,
      storagePath: image.storage_path,
      config,
      fetchImpl
    });
  } catch (storageError) {
    return restoreActivityAfterStorageFailure(storageError, "original");
  }

  try {
    const deleted = await deleteGameImageMetadata({
      session,
      imageId: image.id,
      config,
      fetchImpl
    });

    return Object.freeze({
      id: image.id,
      storagePath: image.storage_path,
      thumbnailPath,
      deleted
    });
  } catch (metadataError) {
    throw new AdminContentError(
      "DELETE_METADATA_FAILED_AFTER_STORAGE",
      "Pliki zostały usunięte ze Storage, ale rekord metadata pozostał nieaktywny. Odśwież bibliotekę i spróbuj usunąć rekord ponownie.",
      {
        details: {
          imageId: image.id,
          storagePath: image.storage_path,
          thumbnailPath,
          metadataError
        },
        cause: metadataError
      }
    );
  }
}

export async function uploadAvifObject({
  session,
  storagePath,
  avifBlob,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);

  if (!(avifBlob instanceof Blob) || avifBlob.type !== "image/avif" || avifBlob.size <= 0) {
    throw new AdminContentError(
      "AVIF_BLOB_INVALID",
      "Do Storage można wysłać wyłącznie prawidłowy AVIF."
    );
  }

  const resolved = resolveConfig(config);
  const encodedPath = encodeStoragePath(storagePath);
  const url = new URL(
    `/storage/v1/object/${GAME_IMAGES_BUCKET}/${encodedPath}`,
    `${resolved.projectUrl}/`
  );

  return request(url, {
    fetchImpl,
    method: "POST",
    headers: authHeaders(resolved.publishableKey, session.access_token, {
      "Content-Type": "image/avif",
      "Cache-Control": "max-age=31536000"
    }),
    body: avifBlob
  });
}

export async function insertGameImageMetadata({
  session,
  contentClass,
  storagePath,
  thumbnailPath,
  originalFilename,
  sourceSha256,
  avifSha256,
  width,
  height,
  fileSizeBytes,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);
  requireContentClass(contentClass);

  const resolved = resolveConfig(config);
  const url = buildRestUrl(resolved.projectUrl, "game_images");

  const payload = {
    content_class: contentClass,
    storage_bucket: GAME_IMAGES_BUCKET,
    storage_path: storagePath,
    thumbnail_path: thumbnailPath,
    original_filename: originalFilename,
    source_sha256: sourceSha256,
    avif_sha256: avifSha256,
    width,
    height,
    file_size_bytes: fileSizeBytes
  };

  const rows = await request(url, {
    fetchImpl,
    method: "POST",
    headers: authHeaders(resolved.publishableKey, session.access_token, {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(payload)
  });

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new AdminContentError(
      "METADATA_INSERT_INVALID",
      "Supabase nie potwierdził zapisu metadata obrazu."
    );
  }

  return rows[0];
}

export async function removeStorageObject({
  session,
  storagePath,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  requireSession(session);

  const resolved = resolveConfig(config);
  const url = new URL(
    `/storage/v1/object/${GAME_IMAGES_BUCKET}`,
    `${resolved.projectUrl}/`
  );

  return request(url, {
    fetchImpl,
    method: "DELETE",
    headers: authHeaders(resolved.publishableKey, session.access_token, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ prefixes: [storagePath] })
  });
}

export async function registerPreparedImage({
  session,
  contentClass,
  prepared,
  inventoryPreview,
  sourceHashPreflightDone = false,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch,
  storagePathFactory = createStoragePath
} = {}) {
  requireSession(session);
  requireContentClass(contentClass);

  if (!prepared?.source?.sha256 || !prepared?.output?.sha256 || !prepared?.output?.blob) {
    throw new AdminContentError(
      "PREPARED_IMAGE_INVALID",
      "Brak kompletnego wyniku konwersji AVIF."
    );
  }

  if (!(inventoryPreview?.blob instanceof Blob) || inventoryPreview.blob.type !== "image/avif" || inventoryPreview.blob.size <= 0) {
    throw new AdminContentError(
      "PREPARED_PREVIEW_INVALID",
      "Brak prawidłowego obrazu do wyświetlenia w bibliotece."
    );
  }

  if (!sourceHashPreflightDone) {
    await assertImageHashAvailable({
      session,
      field: "source_sha256",
      hash: prepared.source.sha256,
      requestedClass: contentClass,
      config,
      fetchImpl
    });
  }

  await assertImageHashAvailable({
    session,
    field: "avif_sha256",
    hash: prepared.output.sha256,
    requestedClass: contentClass,
    config,
    fetchImpl
  });

  const storagePath = storagePathFactory(contentClass);
  const thumbnailPath = createThumbnailStoragePath(storagePath);
  let originalUploaded = false;
  let thumbnailUploaded = false;

  try {
    await uploadAvifObject({
      session,
      storagePath,
      avifBlob: prepared.output.blob,
      config,
      fetchImpl
    });
    originalUploaded = true;

    await uploadAvifObject({
      session,
      storagePath: thumbnailPath,
      avifBlob: inventoryPreview.blob,
      config,
      fetchImpl
    });
    thumbnailUploaded = true;

    const row = await insertGameImageMetadata({
      session,
      contentClass,
      storagePath,
      thumbnailPath,
      originalFilename: prepared.source.filename,
      sourceSha256: prepared.source.sha256,
      avifSha256: prepared.output.sha256,
      width: prepared.output.width,
      height: prepared.output.height,
      fileSizeBytes: prepared.output.size,
      config,
      fetchImpl
    });

    return Object.freeze({ storagePath, thumbnailPath, row });
  } catch (error) {
    const cleanupFailures = [];
    const cleanupPaths = [
      ...(thumbnailUploaded ? [thumbnailPath] : []),
      ...(originalUploaded ? [storagePath] : [])
    ];

    for (const cleanupPath of cleanupPaths) {
      try {
        await removeStorageObject({
          session,
          storagePath: cleanupPath,
          config,
          fetchImpl
        });
      } catch (cleanupError) {
        cleanupFailures.push({ storagePath: cleanupPath, error: cleanupError });
      }
    }

    if (cleanupFailures.length) {
      throw new AdminContentError(
        "UPLOAD_FAILED_CLEANUP_FAILED",
        "Upload nie został ukończony, a automatyczne sprzątanie Storage nie powiodło się w całości.",
        {
          status: error instanceof AdminContentError ? error.status : null,
          details: { storagePath, thumbnailPath, originalError: error, cleanupFailures },
          cause: error
        }
      );
    }

    throw error;
  }
}
