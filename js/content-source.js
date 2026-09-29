import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";
import { MIN_SESSION_SIZE } from "./session-config.js";

const GAME_IMAGES_BUCKET = "game-images";
const SUPABASE_PAGE_SIZE = 1000;
const PUBLIC_COLUMNS = "id,content_class,storage_bucket,storage_path,created_at";

export class ContentSourceError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "ContentSourceError";
    this.code = code;
  }
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

export function resolveSupabasePublicConfig(config = SUPABASE_PUBLIC_CONFIG) {
  const projectUrl = typeof config?.projectUrl === "string" ? config.projectUrl.trim() : "";
  const publishableKey = typeof config?.publishableKey === "string" ? config.publishableKey.trim() : "";

  if (!projectUrl && !publishableKey) {
    return Object.freeze({ configured: false, projectUrl: "", publishableKey: "" });
  }

  if (!projectUrl || !publishableKey) {
    throw new ContentSourceError(
      "SUPABASE_CONFIG_INCOMPLETE",
      "Konfiguracja Supabase jest niepełna. Wymagane są projectUrl i publishableKey."
    );
  }

  if (publishableKey.startsWith("sb_secret_")) {
    throw new ContentSourceError(
      "SUPABASE_SECRET_KEY_FORBIDDEN",
      "W konfiguracji przeglądarki wykryto klucz secret. Użyj wyłącznie sb_publishable_*."
    );
  }

  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new ContentSourceError(
      "SUPABASE_PUBLISHABLE_KEY_INVALID",
      "Konfiguracja wymaga klucza Supabase w formacie sb_publishable_*."
    );
  }

  let url;
  try {
    url = new URL(projectUrl);
  } catch (error) {
    throw new ContentSourceError("SUPABASE_URL_INVALID", "Project URL Supabase jest nieprawidłowy.", error);
  }

  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ContentSourceError(
      "SUPABASE_URL_INVALID",
      "Project URL Supabase musi być czystym adresem bazowym HTTPS bez dodatkowej ścieżki, danych logowania, query i fragmentu."
    );
  }

  return Object.freeze({
    configured: true,
    projectUrl: trimTrailingSlashes(url.href),
    publishableKey
  });
}

function encodeStoragePath(storagePath) {
  return storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildPublicStorageUrl(projectUrl, storageBucket, storagePath) {
  if (storageBucket !== GAME_IMAGES_BUCKET) {
    throw new ContentSourceError(
      "SUPABASE_BUCKET_INVALID",
      `Nieobsługiwany bucket obrazu: ${storageBucket || "(brak)"}.`
    );
  }

  if (typeof storagePath !== "string" || !storagePath || storagePath.startsWith("/") || storagePath.includes("\\")) {
    throw new ContentSourceError("SUPABASE_STORAGE_PATH_INVALID", "Rekord obrazu ma nieprawidłową ścieżkę Storage.");
  }

  if (storagePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new ContentSourceError("SUPABASE_STORAGE_PATH_INVALID", "Rekord obrazu ma nieprawidłową ścieżkę Storage.");
  }

  const base = trimTrailingSlashes(projectUrl);
  return `${base}/storage/v1/object/public/${encodeURIComponent(storageBucket)}/${encodeStoragePath(storagePath)}`;
}

function mapSupabaseRow(row, config) {
  if (
    !row ||
    typeof row.id !== "string" ||
    !["ai", "human"].includes(row.content_class) ||
    row.storage_bucket !== GAME_IMAGES_BUCKET ||
    typeof row.storage_path !== "string"
  ) {
    throw new ContentSourceError("SUPABASE_ROW_INVALID", "Supabase zwrócił nieprawidłowy rekord obrazu.");
  }

  const expectedPrefix = `${row.content_class}/`;
  if (!row.storage_path.startsWith(expectedPrefix) || !/\.avif$/i.test(row.storage_path)) {
    throw new ContentSourceError(
      "SUPABASE_ROW_INVALID",
      "Supabase zwrócił rekord niespójny z kontraktem klasy/ścieżki AVIF."
    );
  }

  return Object.freeze({
    id: row.id,
    src: buildPublicStorageUrl(config.projectUrl, row.storage_bucket, row.storage_path),
    type: row.content_class
  });
}

function buildCatalogUrl(projectUrl, offset) {
  const url = new URL(`${trimTrailingSlashes(projectUrl)}/rest/v1/game_images`);
  url.searchParams.set("select", PUBLIC_COLUMNS);
  url.searchParams.set("order", "created_at.asc,id.asc");
  url.searchParams.set("limit", String(SUPABASE_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

export async function fetchSupabaseImages({
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) {
    throw new ContentSourceError("SUPABASE_NOT_CONFIGURED", "Supabase nie jest skonfigurowany.");
  }
  if (typeof fetchImpl !== "function") {
    throw new ContentSourceError("FETCH_UNAVAILABLE", "Przeglądarka nie udostępnia funkcji fetch().");
  }

  const images = [];
  const ids = new Set();
  let offset = 0;

  // Continue until an empty page. This tolerates a server-side max-row setting
  // lower than the requested page size and keeps the client free of a 1000-row cap.
  while (true) {
    const requestUrl = buildCatalogUrl(resolved.projectUrl, offset);
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          apikey: resolved.publishableKey
        }
      });
    } catch (error) {
      throw new ContentSourceError("SUPABASE_FETCH_FAILED", "Nie udało się połączyć z katalogiem Supabase.", error);
    }

    if (!response?.ok) {
      throw new ContentSourceError(
        "SUPABASE_HTTP_ERROR",
        `Katalog Supabase zwrócił HTTP ${response?.status ?? "?"}.`
      );
    }

    let rows;
    try {
      rows = await response.json();
    } catch (error) {
      throw new ContentSourceError("SUPABASE_JSON_INVALID", "Supabase zwrócił nieprawidłową odpowiedź JSON.", error);
    }

    if (!Array.isArray(rows)) {
      throw new ContentSourceError("SUPABASE_JSON_INVALID", "Supabase nie zwrócił listy rekordów obrazów.");
    }

    if (rows.length === 0) break;

    for (const row of rows) {
      const item = mapSupabaseRow(row, resolved);
      if (ids.has(item.id)) {
        throw new ContentSourceError(
          "SUPABASE_DUPLICATE_ID",
          "Supabase zwrócił zduplikowany identyfikator obrazu podczas stronicowania."
        );
      }
      ids.add(item.id);
      images.push(item);
    }

    offset += rows.length;
  }

  return images;
}

export async function loadContentManifest({
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch,
  minimumImageCount = MIN_SESSION_SIZE
} = {}) {
  const images = await fetchSupabaseImages({ config, fetchImpl });

  if (images.length < minimumImageCount) {
    throw new ContentSourceError(
      "SUPABASE_POOL_TOO_SMALL",
      `Supabase ma ${images.length} aktywnych obrazów; wymagane minimum to ${minimumImageCount}.`
    );
  }

  return Object.freeze({
    source: "supabase",
    manifest: Object.freeze({
      schemaVersion: 2,
      imageCount: images.length,
      images
    })
  });
}
