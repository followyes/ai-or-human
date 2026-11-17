/** AUTH-03: browser-only client for AUTH-02/03 Edge operations. Never holds service credentials. */
import { SUPABASE_PUBLIC_CONFIG } from './supabase-config.js';
import { resolveSupabasePublicConfig } from './content-source.js';

export class AdminUsersError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'AdminUsersError';
    this.code = code;
    this.status = status;
  }
}

const messages = Object.freeze({
  ADMIN_LOGIN_REQUIRED: 'Sesja administratora wygasła. Zaloguj się ponownie.',
  ADMIN_FORBIDDEN: 'Konto nie ma uprawnień administratora.',
  INVALID_BATCH: 'Podaj liczbę kodów od 1 do 25 i ważność od 1 do 90 dni.',
  CODE_NOT_REVOCABLE: 'Nie można usunąć tego kodu. Może być już używany lub wykorzystany.',
  ADMIN_ACCOUNT_PROTECTED: 'Konta administratora nie można zablokować.',
  ACCOUNT_NOT_FOUND: 'Nie znaleziono konta.',
  DATABASE_OPERATION_FAILED: 'Baza nie potwierdziła operacji. Sprawdź stan przed ponowieniem.',
  ISSUE_INTEGRITY_FAILED: 'Nie można potwierdzić wygenerowanych kodów. Sprawdź listę.',
  INVALID_PAGINATION: 'Nieprawidłowe stronicowanie.',
  INVALID_ACCOUNT_STATUS: 'Nieprawidłowy status konta.',
  INVALID_ACCOUNT_FILTER: 'Nieprawidłowy filtr kont.'
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AdminUsersError('INVALID_ID', 'Nieprawidłowy identyfikator.');
  return value;
}

export function validateIssueForm(count, days) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 25 || !Number.isSafeInteger(days) || days < 1 || days > 90)
    throw new AdminUsersError('INVALID_BATCH', messages.INVALID_BATCH);
  return {count, days};
}

export async function adminUsersRequest(action, payload = {}, {
  session, config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch, timeoutMs = 15000
} = {}) {
  if (!session?.access_token) throw new AdminUsersError('SESSION', 'Zaloguj się ponownie.', 401);
  const resolved = resolveSupabasePublicConfig(config);
  if (!resolved.configured) throw new AdminUsersError('CONFIG', 'Brak konfiguracji Supabase.');
  if (typeof fetchImpl !== 'function') throw new AdminUsersError('NETWORK', 'Brak połączenia z serwerem.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${resolved.projectUrl}/functions/v1/auth02-admin`, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        apikey: resolved.publishableKey,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({action, ...payload})
    });
  } catch (error) {
    throw new AdminUsersError(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      error?.name === 'AbortError' ? 'Serwer nie odpowiedział. Sprawdź stan przed ponowieniem.' : 'Nie udało się połączyć z Supabase.');
  } finally { clearTimeout(timer); }
  let data;
  try { data = await response.json(); }
  catch { throw new AdminUsersError('RESPONSE', 'Serwer zwrócił nieprawidłową odpowiedź.', response.status); }
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : `HTTP_${response.status}`;
    const authError = code === 'ADMIN_LOGIN_REQUIRED' || code === 'ADMIN_FORBIDDEN' || (response.status === 401);
    throw new AdminUsersError(authError ? 'SESSION' : code,
      messages[code] || (authError ? 'Sesja wygasła lub brak uprawnień.' : `Operacja nie powiodła się (HTTP ${response.status}).`), response.status);
  }
  return data;
}

export async function listIssuedCodes(options) {
  const result = await adminUsersRequest('list', {limit: 250}, options);
  if (!Array.isArray(result?.codes)) throw new AdminUsersError('RESPONSE', 'Nieprawidłowa lista kodów.');
  return result.codes;
}
export async function issueCodes(count, days, options) {
  const result = await adminUsersRequest('generate', validateIssueForm(count, days), options);
  if (!Array.isArray(result?.codes) || result.codes.length !== count ||
    !result.codes.every(item => typeof item.code === 'string' && typeof item.link === 'string' && UUID.test(item.id))) {
    throw new AdminUsersError('RESPONSE', 'Serwer nie potwierdził kompletnej listy kodów. Sprawdź historię przed ponowieniem.');
  }
  return result;
}
export async function revokeIssuedCode(id, options) {
  const result = await adminUsersRequest('revoke', {code_id: assertUuid(id)}, options);
  if (result?.revoked !== true) throw new AdminUsersError('RESPONSE', 'Nie potwierdzono usunięcia kodu.');
  return true;
}
export async function listPlayerAccounts(offset = 0, filter = {}, options) {
  const search = String(filter.search || '').trim();
  const status = filter.status || '';
  if (search.length > 80 || !['','active','blocked'].includes(status))
    throw new AdminUsersError('VALIDATION', 'Nieprawidłowy filtr kont.');
  const result = await adminUsersRequest('users', {limit: 50, offset, search, status}, options);
  if (!Array.isArray(result?.accounts) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0)
    throw new AdminUsersError('RESPONSE', 'Nieprawidłowa lista kont.');
  return {accounts: result.accounts, total: Number(result.total)};
}
export async function changePlayerStatus(id, status, options) {
  if (status !== 'active' && status !== 'blocked') throw new AdminUsersError('VALIDATION', 'Nieprawidłowy status konta.');
  const result = await adminUsersRequest('set_user_status', {user_id: assertUuid(id), status}, options);
  if (result?.account?.user_id !== id || result.account.status !== status)
    throw new AdminUsersError('RESPONSE', 'Nie można potwierdzić zmiany statusu.');
  return result.account;
}
