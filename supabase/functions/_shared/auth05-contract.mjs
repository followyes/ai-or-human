import { DomainError, validateUuid } from './auth02-core.mjs';

// This module is shared by Edge and Node regression tests. Never return image
// classification, source bucket/path or the private Storage path to a player.
export const PRIVATE_BUCKET = 'game-images-private';
export const SIGNED_URL_TTL_SECONDS = 120;

export function uuid(value) {
  try { return validateUuid(value); }
  catch { throw new DomainError('INVALID_UUID', 400); }
}

export function startRequest(body) {
  const requestKey = uuid(body.request_key);
  const mode = body.mode;
  if (mode === 'classic') {
    if (![20, 50, 100].includes(body.cards) || body.difficulty !== undefined)
      throw new DomainError('INVALID_GAME_SETUP');
    return { requestKey, mode, cards: body.cards, difficulty: null };
  }
  if (mode === 'speed-run') {
    if (!['easy', 'medium', 'hard'].includes(body.difficulty) || body.cards !== undefined)
      throw new DomainError('INVALID_GAME_SETUP');
    return { requestKey, mode, cards: null, difficulty: body.difficulty };
  }
  throw new DomainError('INVALID_GAME_MODE');
}

export function answerRequest(body) {
  const gameId = uuid(body.game_id);
  const cardId = uuid(body.card_id);
  if (!['ai', 'human', 'timeout'].includes(body.choice))
    throw new DomainError('INVALID_ANSWER');
  return { gameId, cardId, choice: body.choice };
}

export function pageRequest(body) {
  const limit = body.limit === undefined ? 20 : body.limit;
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new DomainError('INVALID_PAGINATION');
  return { limit, offset };
}

export function publicCard(payload, signedUrl) {
  if (!payload || typeof payload !== 'object' || !uuid(payload.card_id) ||
      !Number.isSafeInteger(payload.ordinal) || payload.ordinal < 1 ||
      typeof signedUrl !== 'string' || !/^https:\/\//.test(signedUrl))
    throw new DomainError('CARD_INTEGRITY_FAILED', 503);
  // Explicit allowlist: do NOT spread payload or send private_path/image_id.
  return Object.freeze({
    card_id: payload.card_id,
    ordinal: payload.ordinal,
    image_url: signedUrl,
    url_expires_in_seconds: SIGNED_URL_TTL_SECONDS
  });
}

export function cleanError(error) {
  // Real Postgres errors must not be sent as raw messages or SQL details.
  if (error?.code === '42501') return new DomainError('ACCOUNT_NOT_ACTIVE', 403);
  if (error?.code === 'P0002') return new DomainError('GAME_NOT_FOUND', 404);
  if (error?.code === '23505') return new DomainError('CONFLICT_RETRY', 409);
  if (error?.code === 'P0001') return new DomainError('GAME_STATE_CONFLICT', 409);
  return new DomainError('GAME_DATABASE_UNAVAILABLE', 503);
}
