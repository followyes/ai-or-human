/** Shared public reward copy, one session snapshot, no UI / scoring ownership. */
import { resolveSupabasePublicConfig } from "./content-source.js";
import { SUPABASE_PUBLIC_CONFIG } from "./supabase-config.js";

export const DEFAULT_STREAK_MESSAGES = Object.freeze([
  "Dobra robota!", "Świetnie Ci idzie!", "Tak trzymaj!", "Super Ci idzie!", "Brawo!"
]);
const MAX_LENGTH = 60;
export function normalizeStreakMessage(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length >= 1 && [...text].length <= MAX_LENGTH ? text : null;
}
export function normalizeStreakMessages(values) {
  if (!Array.isArray(values)) return [];
  const result = [], seen = new Set();
  for (const value of values) {
    const text = normalizeStreakMessage(typeof value === "string" ? value : value?.message);
    if (!text) continue;
    const key = text.toLocaleLowerCase("pl-PL");
    if (!seen.has(key)) { result.push(text); seen.add(key); }
  }
  return result;
}
export function createStreakMessageBag(messages, random = Math.random) {
  const source = normalizeStreakMessages(messages);
  const pool = source.length ? source : [...DEFAULT_STREAK_MESSAGES];
  let remaining = [];
  let last = null;
  return Object.freeze({
    next() {
      if (remaining.length === 0) {
        remaining = [...pool];
        for (let i = remaining.length - 1; i > 0; i--) {
          const number = Number(random());
          const j = Math.min(i, Math.max(0, Math.floor((Number.isFinite(number) ? number : .5) * (i + 1))));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        // Bag is popped from the end. Avoid consecutive duplicates between cycles.
        if (pool.length > 1 && remaining.at(-1) === last) {
          const index = remaining.findIndex((entry) => entry !== last);
          [remaining[index], remaining[remaining.length - 1]] = [remaining[remaining.length - 1], remaining[index]];
        }
      }
      last = remaining.pop();
      return last;
    },
    get size() { return pool.length; }
  });
}

/** Best-effort public fetch. Always resolves to usable data. Never owns the game clock. */
export async function fetchPublicStreakMessages({
  config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch, timeoutMs = 2500
} = {}) {
  const fallback = [...DEFAULT_STREAK_MESSAGES];
  let resolved;
  try { resolved = resolveSupabasePublicConfig(config); } catch { return fallback; }
  if (!resolved.configured || typeof fetchImpl !== "function") return fallback;
  const url = new URL(`${resolved.projectUrl}/rest/v1/streak_messages`);
  url.searchParams.set("select", "message");
  url.searchParams.set("order", "created_at.asc,id.asc");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET", cache: "no-store", signal: controller.signal,
      headers: { apikey: resolved.publishableKey, Accept: "application/json" }
    });
    if (!response?.ok) return fallback;
    const rows = await response.json();
    const messages = normalizeStreakMessages(rows);
    return messages.length ? messages : fallback;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}
