export const SESSION_SIZE_OPTIONS = Object.freeze([10, 20, 50]);
export const MIN_SESSION_SIZE = Math.min(...SESSION_SIZE_OPTIONS);
export const DEFAULT_SESSION_SIZE = 20;

export function isSupportedSessionSize(size) {
  return SESSION_SIZE_OPTIONS.includes(size);
}

export function isSessionSizeAvailable(size, imageCount) {
  return (
    isSupportedSessionSize(size) &&
    Number.isInteger(imageCount) &&
    imageCount >= size
  );
}

export function resolveSessionSize(imageCount, preferredSize = DEFAULT_SESSION_SIZE) {
  if (!Number.isInteger(imageCount) || imageCount < MIN_SESSION_SIZE) {
    return null;
  }

  if (isSessionSizeAvailable(preferredSize, imageCount)) {
    return preferredSize;
  }

  return [...SESSION_SIZE_OPTIONS]
    .filter((size) => size <= imageCount)
    .sort((a, b) => b - a)[0] ?? null;
}
