/** Authorized Admin CRUD for the public streak copy table. */
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";
import { resolveSupabasePublicConfig } from "./content-source.js";
import { normalizeStreakMessage } from "./streak-messages.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class AdminStreakError extends Error {
  constructor(code, message, status = null) { super(message); this.name = "AdminStreakError"; this.code = code; this.status = status; }
}
async function request({ session, config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch, method = "GET", id = null, message = null } = {}) {
  if (!session?.access_token) throw new AdminStreakError("SESSION", "Zaloguj się ponownie.", 401);
  if (typeof fetchImpl !== "function") throw new AdminStreakError("NETWORK", "Brak połączenia z serwerem.");
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) throw new AdminStreakError("CONFIG", "Brak konfiguracji Supabase.");
  const url = new URL(`${resolved.projectUrl}/rest/v1/streak_messages`);
  if (id) {
    if (!UUID.test(id)) throw new AdminStreakError("ID", "Nieprawidłowy identyfikator wpisu.");
    url.searchParams.set("id", `eq.${id}`);
  }
  if (method === "GET") {
    url.searchParams.set("select", "id,message,created_at");
    url.searchParams.set("order", "created_at.asc,id.asc");
    url.searchParams.set("limit", "500");
  }
  if (method !== "GET" && method !== "DELETE") {
    const valid = normalizeStreakMessage(message);
    if (!valid) throw new AdminStreakError("VALIDATION", "Podaj komunikat do 60 znaków, w jednej linii.");
    message = valid;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetchImpl(url, {
      method, signal: controller.signal, cache: "no-store",
      headers: {
        apikey: resolved.publishableKey, Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
        ...(method !== "GET" ? { Prefer: "return=representation" } : {}),
        ...(message !== null ? { "Content-Type": "application/json" } : {})
      },
      ...(message !== null ? { body: JSON.stringify({ message }) } : {})
    });
  } catch (error) {
    throw new AdminStreakError(error?.name === "AbortError" ? "TIMEOUT" : "NETWORK", "Nie udało się połączyć z Supabase.");
  } finally { clearTimeout(timer); }
  if (!response?.ok) {
    const denied = response?.status === 401 || response?.status === 403;
    const conflict = response?.status === 409;
    throw new AdminStreakError(denied ? "SESSION" : conflict ? "DUPLICATE" : "SERVER",
      denied ? "Sesja wygasła lub brak uprawnień." : conflict ? "Taki komunikat już istnieje." : `Nie udało się zapisać zmiany (HTTP ${response?.status ?? "?"}).`, response?.status);
  }
  let rows;
  try { rows = await response.json(); }
  catch { throw new AdminStreakError("RESPONSE", "Serwer zwrócił nieprawidłową odpowiedź."); }
  if (!Array.isArray(rows) || (method !== "GET" && rows.length !== 1)) {
    throw new AdminStreakError("RESPONSE", "Nie można potwierdzić zapisu zmiany.");
  }
  return rows;
}
export const listAdminStreakMessages = (options) => request(options);
export const addAdminStreakMessage = (message, options) => request({ ...options, method: "POST", message });
export const updateAdminStreakMessage = (id, message, options) => request({ ...options, method: "PATCH", id, message });
export const deleteAdminStreakMessage = (id, options) => request({ ...options, method: "DELETE", id });
