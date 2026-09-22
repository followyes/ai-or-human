const seenImageIds = new Set();

export function getSeenImageIds() {
  return new Set(seenImageIds);
}

export function rememberImageId(id) {
  if (typeof id === "string" && id) {
    seenImageIds.add(id);
  }
}

export function resetSessionHistory() {
  seenImageIds.clear();
}
