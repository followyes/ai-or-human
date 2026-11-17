// AUTH-02. No secrets or credentials are stored in this module.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_PREFIX = 'AOH';
export const MAX_CODES_PER_BATCH = 25;
export const MAX_EXPIRATION_DAYS = 90;
export const REGISTRATION_LINK_BASE = 'https://followyes.github.io/ai-or-human/';

export class DomainError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'DomainError'; this.code = code; this.status = status; }
}

function bytesToBase32(bytes) {
  let buffer = 0, bits = 0, result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += CODE_ALPHABET[(buffer >>> bits) & 31]; }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) result += CODE_ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}

export function createCode(randomBytes = crypto.getRandomValues(new Uint8Array(20))) {
  if (!(randomBytes instanceof Uint8Array) || randomBytes.length !== 20) throw new DomainError('RANDOM_SOURCE_INVALID', 500);
  const token = bytesToBase32(randomBytes); // 160 bits, exactly 32 symbols
  return `${CODE_PREFIX}-${token.match(/.{8}/g).join('-')}`;
}

export function normalizeCode(value) {
  if (typeof value !== 'string') throw new DomainError('INVALID_CODE');
  const compact = value.trim().toUpperCase().replaceAll('-', '');
  if (!/^AOH[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{32}$/.test(compact)) throw new DomainError('INVALID_CODE');
  return `${CODE_PREFIX}-${compact.slice(3).match(/.{8}/g).join('-')}`;
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new DomainError('INVALID_EMAIL');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('INVALID_EMAIL');
  return email;
}

export function normalizePlayerName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(value)) throw new DomainError('INVALID_PLAYER_NAME');
  return value;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new DomainError('PASSWORD_REQUIREMENTS');
  return value;
}

export function validateUuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError('INVALID_REQUEST_KEY');
  }
  return value.toLowerCase();
}

export function validateBatch(input) {
  const count = input?.count, days = input?.days;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CODES_PER_BATCH ||
      !Number.isSafeInteger(days) || days < 1 || days > MAX_EXPIRATION_DAYS) throw new DomainError('INVALID_BATCH');
  return { count, days };
}

export function buildInvitationLink(code, siteUrl = REGISTRATION_LINK_BASE) {
  const normalized = normalizeCode(code);
  const base = new URL(siteUrl);
  if (base.protocol !== 'https:') throw new DomainError('INVALID_SITE_URL', 500);
  // Fragment never goes to GitHub Pages in HTTP requests, unlike ?code=...
  base.hash = `register=${encodeURIComponent(normalized)}`;
  return base.toString();
}

export async function hmacHex(secret, message, webCrypto = crypto) {
  if (typeof secret !== 'string' || secret.length < 32) throw new DomainError('HMAC_SECRET_MISSING', 500);
  const encoder = new TextEncoder();
  const key = await webCrypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const mac = await webCrypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, '0')).join('');
}

export function validateRegistrationInput(body) {
  const code = normalizeCode(body?.code);
  const email = normalizeEmail(body?.email);
  const playerName = normalizePlayerName(body?.player_name);
  const password = validatePassword(body?.password);
  const requestKey = validateUuid(body?.request_key);
  return {code,email,playerName,password,requestKey};
}

/**
 * Orchestrates a server-only saga. Every operation is injectable for deterministic tests.
 * Code can only be reissued when a reservation has NOT entered 'creating'. Unknown
 * createUser outcomes are sealed for admin reconciliation (never auto-released).
 */
export async function registerWithCode(input, adapter) {
  const args = validateRegistrationInput(input);
  const codeDigest = await adapter.hmac(`code:${args.code}`);
  const emailDigest = await adapter.hmac(`email:${args.email}`);
  const reserved = await adapter.reserve({codeDigest,emailDigest,playerName:args.playerName,requestKey:args.requestKey});
  if (!reserved?.ok) throw new DomainError(reserved?.code === 'PLAYER_NAME_TAKEN' ? 'PLAYER_NAME_TAKEN' : 'CODE_NOT_AVAILABLE', 409);
  const attemptId = reserved.attempt_id;
  if (reserved.state === 'committed') return {status:'already_completed'};
  if (reserved.state === 'auth_created' && reserved.auth_user_id) {
    const final = await adapter.commit(attemptId,reserved.auth_user_id);
    if (!final?.ok) throw new DomainError('REGISTRATION_REVIEW_REQUIRED', 409);
    return {status:'registered_active'};
  }
  if (reserved.state !== 'reserved') throw new DomainError('REGISTRATION_REVIEW_REQUIRED', 409);
  const started = await adapter.begin(attemptId);
  if (!started) throw new DomainError('REGISTRATION_REVIEW_REQUIRED', 409);
  let userId = null;
  try {
    userId = await adapter.createAuthUser({
      email:args.email,password:args.password,playerName:args.playerName,
      attemptId,codeId:reserved.code_id
    });
    if (!validateUuid(userId)) throw new Error('Auth result missing user id');
  } catch (_err) {
    await adapter.flagReview(attemptId,'AUTH_CREATE_UNCERTAIN').catch(()=>{});
    throw new DomainError('REGISTRATION_REVIEW_REQUIRED', 409);
  }
  try {
    if (!await adapter.markCreated(attemptId,userId)) throw new Error('State transition failed');
    const final = await adapter.commit(attemptId,userId);
    if (!final?.ok) throw new Error('Commit failed');
  } catch (_err) {
    // Account may exist even if the response or the DB write fails.
    // Never delete it automatically and never unlock the code.
    await adapter.flagReview(attemptId,'PROFILE_COMMIT_UNCERTAIN').catch(()=>{});
    throw new DomainError('REGISTRATION_REVIEW_REQUIRED', 409);
  }
  return {status:'registered_active'};
}
