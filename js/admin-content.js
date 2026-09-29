import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const GAME_IMAGES_BUCKET = "game-images";
export const CONTENT_REQUEST_TIMEOUT_MS = 20000;

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
    original_filename: originalFilename,
    source_sha256: sourceSha256,
    avif_sha256: avifSha256,
    width,
    height,
    file_size_bytes: fileSizeBytes,
    is_active: false
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

  const sourceDuplicate = await findImageByHash({
    session,
    field: "source_sha256",
    hash: prepared.source.sha256,
    config,
    fetchImpl
  });

  if (sourceDuplicate) {
    throw new AdminContentError(
      "SOURCE_DUPLICATE",
      `Ten obraz już istnieje w kategorii ${sourceDuplicate.content_class.toUpperCase()}.`,
      { details: sourceDuplicate }
    );
  }

  const avifDuplicate = await findImageByHash({
    session,
    field: "avif_sha256",
    hash: prepared.output.sha256,
    config,
    fetchImpl
  });

  if (avifDuplicate) {
    throw new AdminContentError(
      "AVIF_DUPLICATE",
      `Taki sam wynik AVIF już istnieje w kategorii ${avifDuplicate.content_class.toUpperCase()}.`,
      { details: avifDuplicate }
    );
  }

  const storagePath = storagePathFactory(contentClass);
  let uploaded = false;

  try {
    await uploadAvifObject({
      session,
      storagePath,
      avifBlob: prepared.output.blob,
      config,
      fetchImpl
    });
    uploaded = true;

    const row = await insertGameImageMetadata({
      session,
      contentClass,
      storagePath,
      originalFilename: prepared.source.filename,
      sourceSha256: prepared.source.sha256,
      avifSha256: prepared.output.sha256,
      width: prepared.output.width,
      height: prepared.output.height,
      fileSizeBytes: prepared.output.size,
      config,
      fetchImpl
    });

    return Object.freeze({ storagePath, row });
  } catch (error) {
    if (uploaded) {
      try {
        await removeStorageObject({
          session,
          storagePath,
          config,
          fetchImpl
        });
      } catch (cleanupError) {
        throw new AdminContentError(
          "METADATA_FAILED_CLEANUP_FAILED",
          "Zapis metadata nie powiódł się, a automatyczne sprzątanie pliku Storage także się nie udało.",
          {
            details: { storagePath, originalError: error, cleanupError },
            cause: error
          }
        );
      }
    }

    throw error;
  }
}
