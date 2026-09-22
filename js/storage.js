const STORAGE_KEY = "ai-or-human:seen-image-ids:v1";

export function getSeenImageIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((value) => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function rememberImageId(id) {
  if (!id) return;

  const seen = getSeenImageIds();
  seen.add(id);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Gra działa dalej nawet wtedy, gdy przeglądarka blokuje localStorage.
  }
}

export function resetSeenImageIds() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Brak działania jest akceptowalny w trybie z zablokowanym localStorage.
  }
}
