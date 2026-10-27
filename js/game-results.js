/**
 * R1: one immutable snapshot per completed session, anonymous insert-only API.
 * No public read / update / delete. A 409 means uncertainty, never fake success.
 */
import { normalizePlayerName } from "./player-name.js";
import { isValidLocalId, makeLocalId } from "./player-profiles.js";
import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const PENDING_RESULTS_KEY = "ai-or-human.pending-results.v1";
const MAX_PENDING = 30;

export function calculateAccuracy(correct, attempts) {
  if (!Number.isSafeInteger(correct) || !Number.isSafeInteger(attempts) || attempts < 1 || correct < 0 || correct > attempts) return null;
  return Math.round((correct * 1000) / attempts) / 10;
}

export function createCompletedResult({
  sessionId, browserId, playerId, playerName, mode, difficulty = null,
  selectedCards = null, correct, attempts, finishedAt = new Date().toISOString()
}) {
  if (![sessionId, browserId, playerId].every(isValidLocalId) || !normalizePlayerName(playerName)) throw new Error("Nieprawidłowy identyfikator profilu lub rozgrywki.");
  if (calculateAccuracy(correct, attempts) === null) throw new Error("Nieprawidłowa liczba odpowiedzi.");
  const validClassic = mode === "classic" && difficulty === null && [20, 50, 100].includes(selectedCards) && attempts === selectedCards;
  const validSpeed = mode === "speed-run" && ["easy", "medium", "hard"].includes(difficulty) && selectedCards === null && attempts <= 100000;
  if (!validClassic && !validSpeed) throw new Error("Nieprawidłowe parametry ukończonej sesji.");
  if (!Number.isFinite(Date.parse(finishedAt))) throw new Error("Nieprawidłowy czas zakończenia.");
  return Object.freeze({
    client_session_id: sessionId,
    browser_id: browserId,
    player_id: playerId,
    player_name: playerName,
    game_mode: mode,
    difficulty,
    selected_cards: selectedCards,
    correct_answers: correct,
    attempts,
    finished_at_client: finishedAt
  });
}

export class ResultSubmitError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "ResultSubmitError";
    this.code = code;
  }
}

export async function submitCompletedResult(payload, { config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch } = {}) {
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) throw new ResultSubmitError("CONFIG", "Zapis wyników nie jest skonfigurowany.");
  if (typeof fetchImpl !== "function") throw new ResultSubmitError("NETWORK", "Nie można połączyć się z serwerem.");
  let response;
  try {
    response = await fetchImpl(`${resolved.projectUrl}/rest/v1/game_results`, {
      method: "POST",
      headers: {
        apikey: resolved.publishableKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new ResultSubmitError("NETWORK", "Brak połączenia. Wynik oczekuje na ponowienie zapisu.", error);
  }
  if (response.status === 409) {
    throw new ResultSubmitError("CONFLICT", "Wynik o tym identyfikatorze może już istnieć. Wymaga weryfikacji przez administratora.");
  }
  if (!response.ok) {
    throw new ResultSubmitError("SERVER", `Zapis wyniku nie powiódł się (HTTP ${response.status}).`);
  }
  // Only a 2xx server response confirms the write. Never trust an unverified ID.
  return true;
}

export class ResultOutbox {
  constructor({ storage = null, submit = submitCompletedResult } = {}) {
    this.storage = storage;
    this.submit = submit;
    this.queue = [];
    this.inFlight = null;
    this.storageAvailable = false;
    try {
      const raw = storage?.getItem(PENDING_RESULTS_KEY);
      if (raw && raw.length < 100000) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length <= MAX_PENDING) {
          this.queue = parsed.filter((row) => {
            try {
              createCompletedResult({
                sessionId: row.client_session_id, browserId: row.browser_id, playerId: row.player_id,
                playerName: row.player_name, mode: row.game_mode, difficulty: row.difficulty,
                selectedCards: row.selected_cards, correct: row.correct_answers,
                attempts: row.attempts, finishedAt: row.finished_at_client
              });
              return true;
            } catch { return false; }
          }).map((row) => Object.freeze({ ...row }));
        }
      }
    } catch { /* Invalid or unavailable storage cannot block gameplay. */ }
    this.persist();
  }

  persist() {
    try {
      if (!this.storage) return false;
      this.storage.setItem(PENDING_RESULTS_KEY, JSON.stringify(this.queue));
      this.storageAvailable = true;
      return true;
    } catch {
      this.storageAvailable = false;
      return false;
    }
  }

  enqueue(snapshot) {
    if (this.queue.some((row) => row.client_session_id === snapshot.client_session_id)) return true;
    if (this.queue.length >= MAX_PENDING) return false;
    const item = createCompletedResult({
      sessionId: snapshot.client_session_id, browserId: snapshot.browser_id,
      playerId: snapshot.player_id, playerName: snapshot.player_name, mode: snapshot.game_mode,
      difficulty: snapshot.difficulty, selectedCards: snapshot.selected_cards,
      correct: snapshot.correct_answers, attempts: snapshot.attempts, finishedAt: snapshot.finished_at_client
    });
    this.queue.push(item);
    this.persist();
    return true;
  }

  get pending() { return this.queue.length; }

  async retryAll(onProgress = () => {}) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      let saved = 0;
      let lastError = null;
      // Retry a bounded snapshot. New sessions added during upload remain in queue.
      for (const item of [...this.queue]) {
        try {
          await this.submit(item);
          const idx = this.queue.findIndex((row) => row.client_session_id === item.client_session_id);
          if (idx >= 0) this.queue.splice(idx, 1);
          this.persist();
          saved += 1;
        } catch (error) {
          lastError = error;
          // Do not bombard the API after failure/conflict; retain exact payload for review.
          break;
        } finally {
          onProgress({ pending: this.pending, saved, lastError });
        }
      }
      return { saved, pending: this.pending, lastError };
    })();
    try { return await this.inFlight; }
    finally { this.inFlight = null; }
  }
}

export function createBrowserResultOutbox() {
  let storage = null;
  try { storage = globalThis.localStorage ?? null; } catch { /* disabled */ }
  return new ResultOutbox({ storage });
}

export function newGameSessionId() { return makeLocalId(); }
