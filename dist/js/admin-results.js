/** R2 results explorer: server-side search / filters / pagination; admin JWT only. */
import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const RESULTS_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_FIELDS = ["player_id", "browser_id", "client_session_id", "id"];
const SORTS = {
  newest: "received_at.desc,id.desc",
  oldest: "received_at.asc,id.asc",
  best: "accuracy_percent.desc,received_at.desc,id.desc",
  most: "correct_answers.desc,received_at.desc,id.desc"
};

export class AdminResultsError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "AdminResultsError";
    this.code = code;
    this.status = status;
  }
}

export function resultFiltersUrl(filters = {}, { page = 0, size = RESULTS_PAGE_SIZE, projectUrl } = {}) {
  if (!projectUrl) throw new Error("Missing project URL");
  const url = new URL(`${projectUrl.replace(/\/$/, "")}/rest/v1/game_results`);
  const params = url.searchParams;
  params.set("select", "id,client_session_id,browser_id,player_id,player_name,game_mode,difficulty,selected_cards,correct_answers,attempts,accuracy_percent,finished_at_client,received_at");
  const query = String(filters.search || "").trim().slice(0, 80);
  if (query) {
    if (UUID.test(query)) {
      params.set("or", `(${ID_FIELDS.map(field => `${field}.eq.${query}`).join(",")})`);
    } else {
      // The R1 name alphabet permits Unicode letters, numbers, underscore and hyphen.
      // Exclude PostgREST operators/wildcards so arbitrary text cannot modify filters.
      const term = query.replace(/[^\p{L}\p{N}_-]/gu, "").replace(/_/g, "\\_");
      if (term) params.set("player_name", `ilike.*${term}*`);
    }
  }
  if (["classic", "speed-run"].includes(filters.mode)) params.set("game_mode", `eq.${filters.mode}`);
  if (["easy", "medium", "hard"].includes(filters.difficulty) && filters.mode === "speed-run") {
    params.set("difficulty", `eq.${filters.difficulty}`);
  }
  // Date inputs are converted to instant boundaries by caller, respecting local timezone.
  if (filters.fromInstant && Number.isFinite(Date.parse(filters.fromInstant))) params.set("finished_at_client", `gte.${filters.fromInstant}`);
  if (filters.untilInstant && Number.isFinite(Date.parse(filters.untilInstant))) {
    // Two conditions for one column require explicit AND, with an inclusive-exclusive range.
    if (filters.fromInstant) {
      params.delete("finished_at_client");
      params.set("and", `(finished_at_client.gte.${filters.fromInstant},finished_at_client.lt.${filters.untilInstant})`);
    } else params.set("finished_at_client", `lt.${filters.untilInstant}`);
  }
  params.set("order", SORTS[filters.sort] || SORTS.newest);
  return url;
}

export function dateInputRange(start, end) {
  const parseLocal = (dateText, nextDay = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "")) return null;
    const [y, m, d] = dateText.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    if (nextDay) date.setDate(date.getDate() + 1);
    return date.toISOString();
  };
  return { fromInstant: parseLocal(start), untilInstant: parseLocal(end, true) };
}

function resolveRequest(session, config) {
  if (!session?.access_token) throw new AdminResultsError("SESSION", "Zaloguj się ponownie.", 401);
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) throw new AdminResultsError("CONFIG", "Brak konfiguracji Supabase.");
  return resolved;
}

async function authorizedRequest(url, { session, config, fetchImpl, method = "GET", body, extraHeaders = {} } = {}) {
  const resolved = resolveRequest(session, config);
  if (typeof fetchImpl !== "function") throw new AdminResultsError("NETWORK", "Brak dostępu do sieci.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetchImpl(url || `${resolved.projectUrl}/rest/v1/game_results`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: resolved.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
        ...extraHeaders,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    throw new AdminResultsError(error?.name === "AbortError" ? "TIMEOUT" : "NETWORK", "Nie udało się pobrać danych z Supabase.");
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    throw new AdminResultsError(
      response.status === 401 || response.status === 403 ? "SESSION" : "SERVER",
      response.status === 401 || response.status === 403 ? "Sesja wygasła lub brak dostępu do wyników." : `Operacja nie powiodła się (HTTP ${response.status}).`,
      response.status
    );
  }
  return response;
}

export async function listAdminResults({ session, filters = {}, page = 0, config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch } = {}) {
  const resolved = resolveRequest(session, config);
  const p = Math.max(0, Math.floor(page) || 0);
  const start = p * RESULTS_PAGE_SIZE;
  const url = resultFiltersUrl(filters, { projectUrl: resolved.projectUrl });
  const response = await authorizedRequest(url.toString(), {
    session, config, fetchImpl,
    extraHeaders: { Prefer: "count=exact", Range: `${start}-${start + RESULTS_PAGE_SIZE - 1}` }
  });
  let rows;
  try { rows = await response.json(); }
  catch { throw new AdminResultsError("RESPONSE", "Nieprawidłowa odpowiedź serwera."); }
  if (!Array.isArray(rows)) throw new AdminResultsError("RESPONSE", "Odpowiedź nie zawiera listy wyników.");
  const range = response.headers?.get?.("content-range") || "";
  const totalMatch = range.match(/\/(\d+)$/);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  return { rows, page: p, total, hasNext: total === null ? rows.length === RESULTS_PAGE_SIZE : start + rows.length < total };
}

async function callAdminRpc(name, args, { session, config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch } = {}) {
  const resolved = resolveRequest(session, config);
  const response = await authorizedRequest(`${resolved.projectUrl}/rest/v1/rpc/${name}`, {
    session, config, fetchImpl, method: "POST", body: args
  });
  const value = await response.json().catch(() => null);
  if (!Number.isSafeInteger(value) || value < 0) throw new AdminResultsError("RESPONSE", "Serwer nie potwierdził liczby usuniętych wpisów.");
  return value;
}

export async function deleteAdminResult(id, options) {
  if (!UUID.test(id || "")) throw new AdminResultsError("ID", "Nieprawidłowy identyfikator gry.");
  return callAdminRpc("admin_delete_game_result", { p_game_id: id }, options);
}

export async function clearAdminResults(options) {
  return callAdminRpc("admin_clear_game_results", {}, options);
}
