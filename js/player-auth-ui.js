/**
 * AUTH-04 — account UI only. Until AUTH-05 this does not gate public gameplay,
 * change browser-local profiles, migrate historical results or alter Storage.
 */
import { PlayerAuthService, PlayerAuthError, parsePlayerAuthHash } from './player-auth.js';

const TITLES = Object.freeze({
  login: 'Logowanie', register: 'Rejestracja', forgot: 'Odzyskaj hasło',
  resend: 'Potwierdź e-mail', confirm: 'Sprawdź e-mail',
  update: 'Nowe hasło', account: 'Twoje konto'
});

export class PlayerAuthUI {
  constructor({doc = globalThis.document, win = globalThis.window, service = new PlayerAuthService()} = {}) {
    this.doc = doc; this.win = win; this.service = service;
    this.entry = doc.getElementById('account-entry');
    this.backdrop = doc.getElementById('account-dialog-backdrop');
    this.dialog = doc.getElementById('account-dialog');
    this.heading = doc.getElementById('account-title');
    this.message = doc.getElementById('account-message');
    this.closeButton = doc.getElementById('account-close');
    this.panels = [...this.dialog.querySelectorAll('[data-account-panel]')];
    this.view = 'login'; this.opened = false; this.busy = false; this.previousFocus = null;
    this.confirmEmail = null;
    this.bind();
  }

  bind() {
    this.entry.addEventListener('click', () => void this.open(this.service.session ? 'account' : 'login'));
    this.closeButton.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', event => {
      if (event.target === this.backdrop) this.close();
    });
    this.dialog.addEventListener('click', event => {
      const nav = event.target.closest('[data-account-view]');
      if (nav && !this.busy) this.show(nav.dataset.accountView);
    });
    this.dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!this.busy) this.close(); return; }
      if (event.key !== 'Tab') return;
      const eligible = [...this.dialog.querySelectorAll('button:not([disabled]),input:not([disabled])')]
        .filter(element => element.getClientRects().length > 0);
      if (!eligible.length) { event.preventDefault(); return; }
      const first = eligible[0], last = eligible[eligible.length - 1];
      if (event.shiftKey && this.doc.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && this.doc.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    const forms = [
      ['account-login-form', data => this.login(data)],
      ['account-register-form', data => this.register(data)],
      ['account-forgot-form', data => this.forgot(data)],
      ['account-resend-form', data => this.resend(data)],
      ['account-update-form', data => this.update(data)]
    ];
    for (const [id, run] of forms) {
      this.doc.getElementById(id).addEventListener('submit', event => {
        event.preventDefault();
        if (this.busy) return;
        const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
        void this.act(() => run(payload));
      });
    }
    this.doc.getElementById('account-send-confirm').addEventListener('click', () => {
      if (this.busy || !this.confirmEmail) return;
      void this.act(async () => {
        await this.service.resendSignupConfirmation(this.confirmEmail);
        this.notice('Jeśli adres wymaga potwierdzenia, wyślemy na niego wiadomość.', 'success');
      });
    });
    this.doc.getElementById('account-signout').addEventListener('click', () => {
      if (this.busy) return;
      void this.act(async () => {
        await this.service.signOut();
        this.entry.classList.remove('is-signed-in');
        this.show('login');
        this.notice('Wylogowano.', 'success');
      });
    });
  }

  show(view, {preserveMessage = false} = {}) {
    if (!TITLES[view]) return;
    this.view = view;
    this.heading.textContent = TITLES[view];
    for (const panel of this.panels) {
      const visible = panel.dataset.accountPanel === view;
      panel.hidden = !visible;
      panel.inert = !visible;
      panel.setAttribute('aria-hidden', String(!visible));
    }
    if (!preserveMessage) this.notice('');
    if (this.opened) this.win.requestAnimationFrame(() => {
      const first = this.dialog.querySelector('[data-account-panel]:not([hidden]) input');
      (first || this.dialog.querySelector('[data-account-panel]:not([hidden]) button') || this.closeButton).focus({preventScroll:true});
    });
  }

  notice(message, tone = 'neutral') {
    this.message.textContent = message;
    this.message.hidden = !message;
    this.message.dataset.tone = tone;
  }

  async open(view = 'login') {
    if (!this.opened) {
      this.previousFocus = this.doc.activeElement;
      this.backdrop.hidden = false; this.opened = true;
      this.doc.body.classList.add('is-account-dialog-open');
    }
    this.show(view);
    if (view === 'account') {
      await this.act(async () => this.loadAccount());
    }
  }

  close() {
    if (!this.opened || this.busy) return;
    this.backdrop.hidden = true; this.opened = false;
    this.doc.body.classList.remove('is-account-dialog-open');
    // Never keep passwords or plaintext activation codes in a hidden form.
    for (const input of this.dialog.querySelectorAll('input')) {
      if (input.type === 'password' || input.name === 'code') input.value = '';
    }
    this.notice('');
    this.previousFocus?.focus?.({preventScroll:true});
  }

  async act(work) {
    if (this.busy) return;
    this.busy = true;
    this.notice('');
    const controls = [...this.dialog.querySelectorAll('input, button')].filter(item => item !== this.closeButton);
    controls.forEach(control => { control.disabled = true; });
    try { await work(); }
    catch (error) {
      this.notice(error instanceof PlayerAuthError ? error.message : 'Nie udało się wykonać operacji.', 'error');
    } finally {
      this.busy = false;
      controls.forEach(control => { control.disabled = false; });
    }
  }

  async register(data) {
    if (this.service.session) throw new PlayerAuthError('ACCOUNT_EXISTS', 'Wyloguj się z bieżącego konta przed rejestracją kolejnego.');
    if (data.password !== data.confirmPassword) throw new PlayerAuthError('PASSWORD_MISMATCH', 'Hasła muszą być jednakowe.');
    await this.service.register({
      code:data.code, email:data.email, password:data.password, playerName:data.playerName
    });
    this.confirmEmail = data.email;
    this.doc.getElementById('account-register-form').reset();
    this.show('confirm');
  }

  async login(data) {
    await this.service.signIn(data);
    this.entry.classList.add('is-signed-in');
    this.show('account');
    await this.loadAccount();
  }

  async loadAccount() {
    const info = await this.service.currentAccount();
    if (!info) { this.show('login'); return; }
    const label = this.doc.getElementById('account-profile-name');
    const address = this.doc.getElementById('account-profile-email');
    label.textContent = info.profile?.player_name || 'Konto bez profilu gracza';
    address.textContent = info.user.email;
    this.entry.classList.add('is-signed-in');
    if (info.profile?.status === 'blocked') this.notice('Konto jest zablokowane.', 'error');
  }

  async forgot(data) {
    await this.service.requestPasswordReset(data.email);
    this.notice('Jeśli konto istnieje, na podany adres zostanie wysłany link do zmiany hasła.', 'success');
  }

  async resend(data) {
    await this.service.resendSignupConfirmation(data.email);
    this.notice('Jeśli adres wymaga potwierdzenia, wyślemy na niego wiadomość.', 'success');
  }

  async update(data) {
    if (data.password !== data.confirmPassword) throw new PlayerAuthError('PASSWORD_MISMATCH', 'Hasła muszą być jednakowe.');
    await this.service.updateRecoveredPassword(data.password);
    this.doc.getElementById('account-update-form').reset();
    this.entry.classList.remove('is-signed-in');
    this.show('login');
    this.notice('Hasło zostało zmienione. Zaloguj się nowym hasłem.', 'success');
  }

  async handleRedirect() {
    const callback = parsePlayerAuthHash(this.win.location.hash);
    if (callback.kind === 'none') return;
    // Invitation code and OAuth/recovery tokens must not remain in URL/history.
    this.win.history.replaceState(this.win.history.state, '', this.win.location.pathname + this.win.location.search);
    if (callback.kind === 'register') {
      await this.open('register');
      this.doc.querySelector('#account-register-form [name="code"]').value = callback.code;
      if (this.service.session) this.notice('Jesteś zalogowany. Wyloguj się przed tworzeniem kolejnego konta.', 'error');
      return;
    }
    if (callback.kind === 'error') {
      await this.open('login'); this.notice('Link jest nieprawidłowy lub wygasł.', 'error');
      return;
    }
    await this.open('login');
    await this.act(async () => {
      const result = await this.service.acceptCallback(callback);
      if (result.kind === 'recovery') {
        this.show('update');
      } else {
        this.show('account');
        await this.loadAccount();
        this.notice('Adres e-mail został potwierdzony.', 'success');
      }
    });
  }
}

export function bootstrapPlayerAuth() {
  if (typeof document === 'undefined' || !document.getElementById('account-dialog')) return null;
  const service = new PlayerAuthService();
  const ui = new PlayerAuthUI({service});
  void ui.handleRedirect();
  return ui;
}

bootstrapPlayerAuth();
