import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const ADMIN_SESSION_STORAGE_KEY = "ai-or-human:admin-session:v1";
export const ADMIN_AUTH_REQUEST_TIMEOUT_MS = 10000;
export const ADMIN_SESSION_REFRESH_MARGIN_SECONDS = 180;

export class AdminAuthError extends Error {
  constructor(code, message, { status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AdminAuthError";
    this.code = code;
    this.status = status;
  }
}

function resolveConfig(config) {
  try {
    const resolved = resolveSupabasePublicConfig(config);
    if (!resolved.configured) {
      throw new AdminAuthError(
        "AUTH_CONFIG_MISSING",
        "Panel administratora nie ma konfiguracji Supabase."
      );
    }
    return resolved;
  } catch (error) {
    if (error instanceof AdminAuthError) throw error;
    throw new AdminAuthError(
      "AUTH_CONFIG_INVALID",
      "Konfiguracja Supabase dla panelu administratora jest nieprawidłowa.",
      { cause: error }
    );
  }
}

function buildUrl(projectUrl, pathname, query = null) {
  const url = new URL(pathname, `${projectUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function normalizeSession(payload) {
  if (
    !payload ||
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    typeof payload.refresh_token !== "string" ||
    !payload.refresh_token ||
    !payload.user ||
    typeof payload.user.id !== "string"
  ) {
    throw new AdminAuthError(
      "AUTH_SESSION_INVALID",
      "Supabase zwrócił nieprawidłową sesję logowania."
    );
  }

  const expiresIn = Number(payload.expires_in);
  const expiresAt = Number.isFinite(Number(payload.expires_at))
    ? Number(payload.expires_at)
    : (Number.isFinite(expiresIn) ? Math.floor(Date.now() / 1000) + expiresIn : null);

  return Object.freeze({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: expiresAt,
    user: Object.freeze({
      id: payload.user.id,
      email: typeof payload.user.email === "string" ? payload.user.email : ""
    })
  });
}

async function requestJson(url, {
  fetchImpl = globalThis.fetch,
  method = "GET",
  headers = {},
  body = undefined,
  timeoutMs = ADMIN_AUTH_REQUEST_TIMEOUT_MS,
  allowNoContent = false
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new AdminAuthError("AUTH_FETCH_UNAVAILABLE", "Przeglądarka nie udostępnia funkcji fetch().");
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
      throw new AdminAuthError(
        "AUTH_REQUEST_TIMEOUT",
        "Supabase nie odpowiedział w wymaganym czasie.",
        { cause: error }
      );
    }
    throw new AdminAuthError(
      "AUTH_NETWORK_FAILED",
      "Nie udało się połączyć z Supabase.",
      { cause: error }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (allowNoContent && response?.status === 204) {
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    if (response?.ok && allowNoContent) return null;
    throw new AdminAuthError(
      "AUTH_RESPONSE_INVALID",
      "Supabase zwrócił nieprawidłową odpowiedź.",
      { status: response?.status ?? null, cause: error }
    );
  }

  if (!response?.ok) {
    const serverCode = typeof payload?.error_code === "string"
      ? payload.error_code
      : (typeof payload?.code === "string" ? payload.code : "");

    throw new AdminAuthError(
      serverCode || "AUTH_HTTP_ERROR",
      "Supabase odrzucił żądanie uwierzytelnienia.",
      { status: response?.status ?? null }
    );
  }

  return payload;
}

function authHeaders(publishableKey, accessToken = "") {
  return {
    Accept: "application/json",
    apikey: publishableKey,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

export async function signInWithPassword({
  email,
  password,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveConfig(config);
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (!normalizedEmail || typeof password !== "string" || !password) {
    throw new AdminAuthError("AUTH_CREDENTIALS_REQUIRED", "Podaj e-mail i hasło.");
  }

  const url = buildUrl(resolved.projectUrl, "/auth/v1/token", { grant_type: "password" });
  const payload = await requestJson(url, {
    fetchImpl,
    method: "POST",
    headers: {
      ...authHeaders(resolved.publishableKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: normalizedEmail,
      password
    })
  });

  return normalizeSession(payload);
}


export function shouldRefreshAdminSession(
  session,
  {
    nowMs = Date.now(),
    marginSeconds = ADMIN_SESSION_REFRESH_MARGIN_SECONDS
  } = {}
) {
  const expiresAt = Number(session?.expires_at);
  if (!Number.isFinite(expiresAt)) return false;

  const normalizedMargin = Math.max(0, Number(marginSeconds) || 0);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  return expiresAt <= nowSeconds + normalizedMargin;
}

function isRefreshableAuthError(error) {
  return error instanceof AdminAuthError &&
    error.code !== "ADMIN_FORBIDDEN" &&
    (error.status === 401 || error.status === 403);
}

export async function refreshAdminSession({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveConfig(config);

  if (!session || typeof session.refresh_token !== "string" || !session.refresh_token) {
    throw new AdminAuthError("AUTH_REFRESH_TOKEN_MISSING", "Brak tokenu odświeżenia sesji.");
  }

  const url = buildUrl(resolved.projectUrl, "/auth/v1/token", { grant_type: "refresh_token" });
  const payload = await requestJson(url, {
    fetchImpl,
    method: "POST",
    headers: {
      ...authHeaders(resolved.publishableKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  return normalizeSession(payload);
}

export async function fetchCurrentUser({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveConfig(config);

  if (!session || typeof session.access_token !== "string" || !session.access_token) {
    throw new AdminAuthError("AUTH_ACCESS_TOKEN_MISSING", "Brak aktywnej sesji.");
  }

  return requestJson(buildUrl(resolved.projectUrl, "/auth/v1/user"), {
    fetchImpl,
    headers: authHeaders(resolved.publishableKey, session.access_token)
  });
}

export async function verifyAdminAuthority({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveConfig(config);

  if (!session || typeof session.access_token !== "string" || !session.access_token) {
    throw new AdminAuthError("AUTH_ACCESS_TOKEN_MISSING", "Brak aktywnej sesji.");
  }

  const payload = await requestJson(
    buildUrl(resolved.projectUrl, "/rest/v1/rpc/is_current_user_admin"),
    {
      fetchImpl,
      method: "POST",
      headers: {
        ...authHeaders(resolved.publishableKey, session.access_token),
        "Content-Type": "application/json"
      },
      body: "{}"
    }
  );

  if (payload !== true) {
    throw new AdminAuthError(
      "ADMIN_FORBIDDEN",
      "To konto nie ma uprawnień administratora.",
      { status: 403 }
    );
  }

  return true;
}

export async function ensureFreshAdminSession({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  marginSeconds = ADMIN_SESSION_REFRESH_MARGIN_SECONDS,
  verifyAuthority = true
} = {}) {
  let activeSession = session;

  if (!activeSession?.access_token) {
    throw new AdminAuthError("AUTH_ACCESS_TOKEN_MISSING", "Brak aktywnej sesji.");
  }

  if (!shouldRefreshAdminSession(activeSession, { nowMs, marginSeconds })) {
    return activeSession;
  }

  activeSession = await refreshAdminSession({
    session: activeSession,
    config,
    fetchImpl
  });

  if (!verifyAuthority) return activeSession;

  const user = await fetchCurrentUser({ session: activeSession, config, fetchImpl });
  if (!user || typeof user.id !== "string") {
    throw new AdminAuthError("AUTH_USER_INVALID", "Nie udało się potwierdzić użytkownika.");
  }

  await verifyAdminAuthority({ session: activeSession, config, fetchImpl });

  return Object.freeze({
    ...activeSession,
    user: Object.freeze({
      id: user.id,
      email: typeof user.email === "string" ? user.email : activeSession?.user?.email || ""
    })
  });
}

export async function authorizeAdminSession({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  marginSeconds = ADMIN_SESSION_REFRESH_MARGIN_SECONDS
} = {}) {
  let activeSession = session;
  let refreshed = false;
  let user;

  if (shouldRefreshAdminSession(activeSession, { nowMs, marginSeconds })) {
    activeSession = await refreshAdminSession({ session: activeSession, config, fetchImpl });
    refreshed = true;
  }

  try {
    user = await fetchCurrentUser({ session: activeSession, config, fetchImpl });
  } catch (error) {
    if (!isRefreshableAuthError(error) || refreshed) throw error;
    activeSession = await refreshAdminSession({ session: activeSession, config, fetchImpl });
    refreshed = true;
    user = await fetchCurrentUser({ session: activeSession, config, fetchImpl });
  }

  if (!user || typeof user.id !== "string") {
    throw new AdminAuthError("AUTH_USER_INVALID", "Nie udało się potwierdzić użytkownika.");
  }

  try {
    await verifyAdminAuthority({ session: activeSession, config, fetchImpl });
  } catch (error) {
    if (!isRefreshableAuthError(error) || refreshed) throw error;
    activeSession = await refreshAdminSession({ session: activeSession, config, fetchImpl });
    user = await fetchCurrentUser({ session: activeSession, config, fetchImpl });
    if (!user || typeof user.id !== "string") {
      throw new AdminAuthError("AUTH_USER_INVALID", "Nie udało się potwierdzić użytkownika.");
    }
    await verifyAdminAuthority({ session: activeSession, config, fetchImpl });
  }

  return Object.freeze({
    ...activeSession,
    user: Object.freeze({
      id: user.id,
      email: typeof user.email === "string" ? user.email : activeSession?.user?.email || ""
    })
  });
}

export async function signOutAdmin({
  session,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveConfig(config);

  if (!session?.access_token) return true;

  await requestJson(
    buildUrl(resolved.projectUrl, "/auth/v1/logout", { scope: "local" }),
    {
      fetchImpl,
      method: "POST",
      headers: authHeaders(resolved.publishableKey, session.access_token),
      allowNoContent: true
    }
  );

  return true;
}

export function saveAdminSession(session, storage = globalThis.sessionStorage) {
  if (!storage?.setItem) {
    throw new AdminAuthError("AUTH_STORAGE_UNAVAILABLE", "Pamięć sesji przeglądarki jest niedostępna.");
  }

  const normalized = normalizeSession(session);
  storage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadAdminSession(storage = globalThis.sessionStorage) {
  if (!storage?.getItem) return null;

  const raw = storage.getItem(ADMIN_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return normalizeSession(JSON.parse(raw));
  } catch {
    storage.removeItem?.(ADMIN_SESSION_STORAGE_KEY);
    return null;
  }
}

export function clearAdminSession(storage = globalThis.sessionStorage) {
  storage?.removeItem?.(ADMIN_SESSION_STORAGE_KEY);
}
