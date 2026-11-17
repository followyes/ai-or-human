/**
 * AUTH-04 — Supabase Auth for players.
 * Only a publishable key reaches this browser module. No signup endpoint is used:
 * an account is created exclusively by the existing AUTH-02 code-redemption Edge Function.
 */
import { SUPABASE_PUBLIC_CONFIG } from './supabase-config.js';
import { resolveSupabasePublicConfig } from './content-source.js';

export const PLAYER_AUTH_STORAGE_KEY = 'ai-or-human:player-auth:v1';
export const REGISTRATION_RETRY_STORAGE_KEY = 'ai-or-human:registration-attempt:v1';
export const PUBLIC_AUTH_REDIRECT = 'https://followyes.github.io/ai-or-human/';
const CODE_ALPHABET = '[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]';
const CODE_FORMAT = new RegExp('^AOH(?:-' + CODE_ALPHABET + '{8}){4}$');
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_MESSAGES = Object.freeze({
  INVALID_CODE: 'Sprawdź kod aktywacyjny.',
  CODE_NOT_AVAILABLE: 'Kod jest nieważny, wykorzystany albo wygasł.',
  PLAYER_NAME_TAKEN: 'Ta nazwa gracza jest już zajęta.',
  INVALID_PLAYER_NAME: 'Nazwa: 1–20 znaków, tylko litery A–Z, cyfry, _ lub -.',
  INVALID_EMAIL: 'Podaj prawidłowy adres e-mail.',
  PASSWORD_REQUIREMENTS: 'Hasło musi mieć co najmniej 12 znaków.',
  INVALID_REQUEST_KEY: 'Odśwież formularz i spróbuj ponownie.',
  TOO_MANY_REQUESTS: 'Za dużo prób. Odczekaj chwilę.',
  REGISTRATION_REVIEW_REQUIRED: 'Rejestracja wymaga sprawdzenia. Nie używaj nowego kodu — skontaktuj się z administratorem.',
  email_not_confirmed: 'Potwierdź adres e-mail, zanim się zalogujesz.',
  invalid_credentials: 'Nieprawidłowy e-mail lub hasło.',
  email_address_not_authorized: 'Wysyłanie wiadomości na ten adres jest zablokowane w konfiguracji poczty.',
  over_email_send_rate_limit: 'Limit wiadomości został osiągnięty. Spróbuj później.',
  over_request_rate_limit: 'Za dużo prób. Odczekaj chwilę.',
  same_password: 'Nowe hasło musi być inne niż dotychczasowe.'
});

export class PlayerAuthError extends Error {
  constructor(code, message = null, status = null) {
    super(message || AUTH_MESSAGES[code] || 'Nie udało się wykonać operacji. Spróbuj ponownie.');
    this.name = 'PlayerAuthError'; this.code = code; this.status = status;
  }
}

export function normalizeActivationCode(value) {
  if (typeof value !== 'string') throw new PlayerAuthError('INVALID_CODE');
  const compact = value.trim().toUpperCase().replaceAll('-', '');
  if (!/^AOH[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{32}$/.test(compact)) throw new PlayerAuthError('INVALID_CODE');
  const normalized = 'AOH-' + compact.slice(3).match(/.{8}/g).join('-');
  if (!CODE_FORMAT.test(normalized)) throw new PlayerAuthError('INVALID_CODE');
  return normalized;
}

export function validatePlayerEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length < 3 || email.length > 254 || !EMAIL_FORMAT.test(email)) throw new PlayerAuthError('INVALID_EMAIL');
  return email;
}

export function validatePlayerName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(value)) throw new PlayerAuthError('INVALID_PLAYER_NAME');
  return value;
}

export function validatePlayerPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new PlayerAuthError('PASSWORD_REQUIREMENTS');
  return value;
}

export function parsePlayerAuthHash(value) {
  const hash = typeof value === 'string' ? value.replace(/^#/, '') : '';
  const params = new URLSearchParams(hash);
  if (params.has('register')) return {kind: 'register', code: params.get('register') || ''};
  if (params.has('error') || params.has('error_code')) return {kind: 'error'};
  const type = params.get('type');
  const accessToken = params.get('access_token'), refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken && ['signup', 'recovery'].includes(type)) {
    return {
      kind: type, access_token: accessToken, refresh_token: refreshToken,
      token_type: params.get('token_type') || 'bearer',
      expires_in: Number(params.get('expires_in')) || 3600
    };
  }
  return {kind: 'none'};
}

function normalizeAuthSession(value) {
  if (!value || typeof value.access_token !== 'string' || !value.access_token ||
      typeof value.refresh_token !== 'string' || !value.refresh_token ||
      !value.user || !UUID_FORMAT.test(String(value.user.id || ''))) {
    throw new PlayerAuthError('INVALID_SESSION', 'Nie udało się potwierdzić sesji.');
  }
  const expiresAt = Number(value.expires_at) || (Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600));
  if (!Number.isFinite(expiresAt)) throw new PlayerAuthError('INVALID_SESSION');
  return {
    access_token: value.access_token, refresh_token: value.refresh_token,
    expires_at: expiresAt,
    user: {id: value.user.id, email: typeof value.user.email === 'string' ? value.user.email : ''}
  };
}

async function digestRegistrationIdentity(code, email, name, webCrypto) {
  const bytes = new TextEncoder().encode(`auth04:${code}:${email}:${name}`);
  const digest = await webCrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export class PlayerAuthService {
  constructor({
    config = SUPABASE_PUBLIC_CONFIG, fetchImpl = globalThis.fetch,
    storage = globalThis.localStorage, retryStorage = globalThis.sessionStorage,
    webCrypto = globalThis.crypto, now = () => Date.now()
  } = {}) {
    const resolved = resolveSupabasePublicConfig(config);
    if (!resolved.configured) throw new PlayerAuthError('CONFIG', 'Brak konfiguracji połączenia.');
    this.url = resolved.projectUrl;
    this.key = resolved.publishableKey;
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.retryStorage = retryStorage;
    this.webCrypto = webCrypto;
    this.now = now;
    this.session = null;
    this.recoverySession = null;
    this.refreshPromise = null;
    try {
      const raw = storage?.getItem(PLAYER_AUTH_STORAGE_KEY);
      if (raw) this.session = normalizeAuthSession(JSON.parse(raw));
    } catch {
      this.session = null;
      try { storage?.removeItem(PLAYER_AUTH_STORAGE_KEY); } catch {}
    }
  }

  headers(accessToken) {
    return {
      apikey: this.key, Accept: 'application/json',
      ...(accessToken ? {Authorization: `Bearer ${accessToken}`} : {})
    };
  }

  async request(path, {method = 'GET', body, accessToken, timeoutMs = 16000} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(new URL(path, this.url).toString(), {
        method, cache: 'no-store', signal: controller.signal,
        headers: {
          ...this.headers(accessToken),
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {})
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)})
      });
    } catch (error) {
      throw new PlayerAuthError(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        error?.name === 'AbortError'
          ? (path.startsWith('/functions/v1/auth02-register')
            ? 'Serwer nie odpowiedział. Ponów rejestrację z tym samym kodem.'
            : 'Serwer nie odpowiedział. Spróbuj ponownie.')
          : 'Brak połączenia z serwerem.');
    } finally {
      clearTimeout(timer);
    }
    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); }
      catch { throw new PlayerAuthError('RESPONSE', 'Serwer zwrócił nieprawidłową odpowiedź.', response.status); }
    }
    if (!response.ok) {
      const code = typeof data?.error_code === 'string' ? data.error_code
        : typeof data?.error === 'string' ? data.error
        : typeof data?.code === 'string' ? data.code : 'REQUEST_FAILED';
      throw new PlayerAuthError(code, null, response.status);
    }
    return data;
  }

  persist(session) {
    const normalized = normalizeAuthSession(session);
    try { this.storage?.setItem(PLAYER_AUTH_STORAGE_KEY, JSON.stringify(normalized)); }
    catch { throw new PlayerAuthError('STORAGE', 'Nie można zapisać sesji w przeglądarce.'); }
    this.session = normalized;
    return normalized;
  }

  clear() {
    this.session = null; this.recoverySession = null;
    try { this.storage?.removeItem(PLAYER_AUTH_STORAGE_KEY); } catch {}
  }

  async register({code, email, playerName, password}) {
    const validated = {
      code: normalizeActivationCode(code), email: validatePlayerEmail(email),
      player_name: validatePlayerName(playerName), password: validatePlayerPassword(password)
    };
    if (typeof this.webCrypto?.randomUUID !== 'function' || !this.webCrypto?.subtle) {
      throw new PlayerAuthError('CRYPTO', 'Przeglądarka nie obsługuje bezpiecznej rejestracji.');
    }
    const digest = await digestRegistrationIdentity(validated.code, validated.email, validated.player_name, this.webCrypto);
    let requestKey = null;
    try {
      const pending = JSON.parse(this.retryStorage?.getItem(REGISTRATION_RETRY_STORAGE_KEY) || 'null');
      if (pending?.digest === digest && UUID_FORMAT.test(String(pending?.request_key))) requestKey = pending.request_key;
    } catch {}
    if (!requestKey) requestKey = this.webCrypto.randomUUID();
    // Only a non-redeemable digest and idempotency UUID are stored; no code,
    // e-mail, password or player name goes into browser storage.
    try { this.retryStorage?.setItem(REGISTRATION_RETRY_STORAGE_KEY, JSON.stringify({digest, request_key:requestKey})); }
    catch { throw new PlayerAuthError('STORAGE', 'Nie można bezpiecznie wznowić rejestracji w tej przeglądarce.'); }
    const result = await this.request('/functions/v1/auth02-register', {
      method: 'POST', timeoutMs: 30000,
      body: {...validated, request_key: requestKey}
    });
    if (!['registered_email_verification_required', 'already_completed'].includes(result?.status)) {
      throw new PlayerAuthError('RESPONSE', 'Rejestracja wymaga sprawdzenia. Skontaktuj się z administratorem.');
    }
    try { this.retryStorage?.removeItem(REGISTRATION_RETRY_STORAGE_KEY); } catch {}
    return result;
  }

  async signIn({email, password}) {
    const payload = await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: {email: validatePlayerEmail(email), password}
    });
    const session = normalizeAuthSession(payload);
    const user = await this.getUser(session);
    if (user.id !== session.user.id) throw new PlayerAuthError('INVALID_SESSION');
    return this.persist({...session, user});
  }

  async getUser(session) {
    const user = await this.request('/auth/v1/user', {accessToken: session.access_token});
    if (!user || !UUID_FORMAT.test(String(user.id || ''))) throw new PlayerAuthError('INVALID_SESSION');
    return {id: user.id, email: typeof user.email === 'string' ? user.email : ''};
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session?.refresh_token) throw new PlayerAuthError('SESSION_MISSING');
    const oldSession = this.session;
    this.refreshPromise = (async () => {
      try {
        const result = await this.request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: {refresh_token: oldSession.refresh_token}
        });
        return this.persist(normalizeAuthSession(result));
      } catch (error) {
        if (error?.status === 400 || error?.status === 401 || error?.status === 403) this.clear();
        throw error;
      }
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async currentAccount() {
    if (!this.session) return null;
    let session = this.session;
    if (session.expires_at <= Math.floor(this.now() / 1000) + 120) session = await this.refresh();
    let user;
    try { user = await this.getUser(session); }
    catch (error) {
      if (error.status !== 401) throw error;
      session = await this.refresh();
      user = await this.getUser(session);
    }
    if (user.id !== session.user.id) { this.clear(); throw new PlayerAuthError('INVALID_SESSION'); }
    const rows = await this.request(`/rest/v1/player_accounts?select=player_name,status&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, {
      accessToken: session.access_token
    });
    if (!Array.isArray(rows)) throw new PlayerAuthError('RESPONSE');
    return {user, profile: rows[0] || null};
  }

  async signOut() {
    const old = this.session;
    this.clear();
    if (!old) return;
    try { await this.request('/auth/v1/logout?scope=local', {method:'POST', accessToken: old.access_token}); }
    catch { /* The browser has signed out locally even if the network was lost. */ }
  }

  async requestPasswordReset(email) {
    // Supabase generates the recovery link and sends it through its configured
    // mail provider. We never generate or expose a privileged reset token.
    await this.request(`/auth/v1/recover?redirect_to=${encodeURIComponent(PUBLIC_AUTH_REDIRECT)}`, {
      method: 'POST', body: {email:validatePlayerEmail(email)}
    });
  }

  async resendSignupConfirmation(email) {
    // Explicit allowlisted redirect: the confirmation token must return to
    // this GitHub Pages app, not to a stale/default project Site URL.
    await this.request(`/auth/v1/resend?redirect_to=${encodeURIComponent(PUBLIC_AUTH_REDIRECT)}`, {
      method: 'POST', body: {type:'signup',email:validatePlayerEmail(email)}
    });
  }

  async acceptCallback(callback) {
    if (!['signup', 'recovery'].includes(callback?.kind)) throw new PlayerAuthError('INVALID_CALLBACK');
    const session = normalizeAuthSession({
      ...callback, user: {id:'00000000-0000-4000-8000-000000000000',email:''}
    });
    const user = await this.getUser(session);
    if (callback.kind === 'recovery') {
      this.recoverySession = {...session,user};
      return {kind:'recovery',user};
    }
    await this.persist({...session,user});
    return {kind:'signup',user};
  }

  async updateRecoveredPassword(password) {
    const value = validatePlayerPassword(password);
    if (!this.recoverySession) throw new PlayerAuthError('RECOVERY_MISSING', 'Otwórz prawidłowy link odzyskiwania hasła.');
    const authSession = this.recoverySession;
    await this.request('/auth/v1/user', {method:'PUT',accessToken:authSession.access_token,body:{password:value}});
    this.recoverySession = null;
    this.clear();
    try { await this.request('/auth/v1/logout?scope=local', {method:'POST',accessToken:authSession.access_token}); }
    catch {}
  }
}
