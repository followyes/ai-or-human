/** Training access: all issuance/redemption is handled by PostgreSQL RPCs.
 * The frontend never generates a code, and a locally stored token is not proof
 * until the server confirms it. No service-role key belongs in this module.
 */
import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

const STORAGE_PREFIX = "ai-or-human.training-token.v1:";
const ACCESS_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
export const TRAINING_BATCH_MAX = 200;

export class TrainingAccessError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "TrainingAccessError";
    this.code = code;
    this.status = status;
  }
}

export async function trainingRpc(functionName, params, {
  jwt = null,
  config = SUPABASE_PUBLIC_CONFIG,
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) throw new TrainingAccessError("CONFIG", "Brak konfiguracji Supabase.");
  if (typeof fetchImpl !== "function") throw new TrainingAccessError("NETWORK", "Brak dostępu do sieci.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetchImpl(`${resolved.projectUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: resolved.publishableKey,
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {})
      },
      body: JSON.stringify(params)
    });
  } catch (error) {
    throw new TrainingAccessError("NETWORK", "Nie udało się połączyć z serwerem.");
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new TrainingAccessError("RESPONSE", "Nieprawidłowa odpowiedź serwera.", response.status); }
  if (!response.ok) {
    if (response.status === 404 || data?.code === "PGRST202") {
      throw new TrainingAccessError("MIGRATION", "Brakuje funkcji kodów w bazie. Wykonaj migrację SQL.", response.status);
    }
    if (response.status === 401 || response.status === 403 || data?.code === "42501") {
      throw new TrainingAccessError("FORBIDDEN", "Brak uprawnień lub sesja administratora wygasła.", response.status);
    }
    if (data?.code === "P0001" || data?.code === "22023") {
      throw new TrainingAccessError("REJECTED", "Kod jest niepoprawny lub został już wykorzystany.", response.status);
    }
    throw new TrainingAccessError("SERVER", `Serwer odrzucił operację (HTTP ${response.status}).`, response.status);
  }
  return data;
}

export async function redeemTrainingCode(code, playerName, options = {}) {
  const value = String(code ?? "").trim().toUpperCase();
  if (!/^TRN-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(value)) {
    throw new TrainingAccessError("REJECTED", "Podaj poprawny kod w formacie TRN-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX.");
  }
  const token = await trainingRpc("redeem_training_code", {
    p_code: value,
    p_player_name: playerName
  }, options);
  if (typeof token !== "string" || !ACCESS_TOKEN_PATTERN.test(token)) {
    throw new TrainingAccessError("RESPONSE", "Serwer nie zwrócił poprawnego potwierdzenia dostępu.");
  }
  return token;
}

export async function validateTrainingToken(token, playerName, options = {}) {
  if (!ACCESS_TOKEN_PATTERN.test(String(token ?? ""))) return false;
  const valid = await trainingRpc("validate_training_access", {
    p_token: token,
    p_player_name: playerName
  }, options);
  if (typeof valid !== "boolean") throw new TrainingAccessError("RESPONSE", "Nieprawidłowa weryfikacja kodu.");
  return valid;
}

export async function generateTrainingCodes(count, jwt, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > TRAINING_BATCH_MAX) {
    throw new TrainingAccessError("COUNT", `Wybierz od 1 do ${TRAINING_BATCH_MAX} kodów.`);
  }
  if (!jwt) throw new TrainingAccessError("FORBIDDEN", "Brak sesji administratora.");
  const rows = await trainingRpc("generate_training_codes", { p_count: count }, { ...options, jwt });
  if (!Array.isArray(rows) || rows.length !== count || rows.some((row) => typeof row?.code !== "string")) {
    throw new TrainingAccessError("RESPONSE", "Serwer zwrócił niekompletną listę kodów.");
  }
  return rows.map((row) => row.code);
}

export async function getTrainingCodeStats(jwt, options = {}) {
  if (!jwt) throw new TrainingAccessError("FORBIDDEN", "Brak sesji administratora.");
  const rows = await trainingRpc("training_code_stats", {}, { ...options, jwt });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new TrainingAccessError("RESPONSE", "Nie można odczytać statystyk kodów.");
  }
  return rows[0];
}

const memory = new Map();
export function getTrainingToken(profileId, storage = undefined) {
  if (!profileId) return null;
  let token = memory.get(profileId) || null;
  if (!token) {
    try { token = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STORAGE_PREFIX + profileId); }
    catch { /* private mode: in-memory only */ }
  }
  return ACCESS_TOKEN_PATTERN.test(String(token ?? "")) ? token : null;
}

export function saveTrainingToken(profileId, token, storage = undefined) {
  if (!profileId || !ACCESS_TOKEN_PATTERN.test(String(token ?? ""))) return false;
  memory.set(profileId, token);
  try { (storage === undefined ? globalThis.localStorage : storage)?.setItem(STORAGE_PREFIX + profileId, token); }
  catch { /* in-memory token still works until reload */ }
  return true;
}

export function clearTrainingToken(profileId, storage = undefined) {
  if (!profileId) return;
  memory.delete(profileId);
  try { (storage === undefined ? globalThis.localStorage : storage)?.removeItem(STORAGE_PREFIX + profileId); }
  catch { /* ignore */ }
}
