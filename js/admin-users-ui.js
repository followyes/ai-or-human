/** AUTH-03 minimal Admin UI. Raw activation codes live in memory only until hidden/tab leave. */
import {
  AdminUsersError, listIssuedCodes, issueCodes, revokeIssuedCode,
  listPlayerAccounts, changePlayerStatus
} from './admin-users.js';

const shortDate = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pl-PL', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date) : '—';
};
const labels = Object.freeze({
  available: 'Aktywny', reserved: 'Zarezerwowany', consumed: 'Wykorzystany',
  expired: 'Wygasł', revoked: 'Unieważniony', active: 'Aktywne', blocked: 'Zablokowane'
});
const node = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (doc, label, action, id, danger = false) => {
  const element = node(doc, 'button', `admin-secondary-button compact-button${danger ? ' danger-button' : ''}`, label);
  element.type = 'button'; element.dataset.usersAction = action;
  if (id) element.dataset.id = id;
  return element;
};
const displayStatus = status => labels[status] || 'Nieznany';

export class AdminUsersPanel {
  constructor({root, getSession, onAuthFailure, fetchImpl, confirmAction = message => window.confirm(message), copyText = text => navigator.clipboard.writeText(text)} = {}) {
    if (!root) throw new Error('Missing Users workspace');
    this.root = root; this.getSession = getSession; this.onAuthFailure = onAuthFailure;
    this.fetchImpl = fetchImpl; this.confirmAction = confirmAction; this.copyText = copyText;
    this.els = Object.fromEntries([
      'users-generate-form','users-code-count','users-code-days','users-generate-button',
      'users-issued','users-issued-list','users-hide-issued','users-copy-all',
      'users-code-filter','users-codes-list','users-codes-refresh',
      'users-account-search','users-account-filter','users-accounts-list','users-accounts-more',
      'users-status'
    ].map(id => [id, root.querySelector(`#${id}`)]));
    if (Object.values(this.els).some(value => !value)) throw new Error('Incomplete Admin Users markup');
    this.active = false; this.busy = false; this.revision = 0;
    this.codes = []; this.accounts = []; this.total = 0; this.issuedCodes = [];
    this.toast = root.querySelector('#users-toast');
    this.toastTimer = null;
    this.copyButtonTimers = new WeakMap();
    this.bind();
  }
  get(id) { return this.els[`users-${id}`]; }
  bind() {
    this.get('generate-form').addEventListener('submit', event => { event.preventDefault(); void this.generate(); });
    this.get('hide-issued').addEventListener('click', () => this.clearIssued());
    this.get('copy-all').addEventListener('click', () => void this.copyAll());
    this.get('codes-refresh').addEventListener('click', () => void this.refreshCodes());
    this.get('code-filter').addEventListener('change', () => this.renderCodes());
    this.searchTimer = null;
    this.get('account-search').addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.refreshAccounts(), 300);
    });
    this.get('account-filter').addEventListener('change', () => void this.refreshAccounts());
    this.get('accounts-more').addEventListener('click', () => void this.loadMore());
    this.get('issued-list').addEventListener('click', event => {
      const target = event.target.closest('[data-users-action]');
      if (!target || this.busy) return;
      const match = this.issuedCodes.find(row => row.id === target.dataset.id);
      if (match && target.dataset.usersAction === 'copy-code') void this.copy(match.code, 'Kod skopiowany!', target);
      if (match && target.dataset.usersAction === 'copy-link') void this.copy(match.link, 'Link skopiowany!', target);
    });
    this.get('codes-list').addEventListener('click', event => {
      const target = event.target.closest('[data-users-action]');
      if (target?.dataset.usersAction === 'revoke') void this.revoke(target.dataset.id);
    });
    this.get('accounts-list').addEventListener('click', event => {
      const target = event.target.closest('[data-users-action]');
      if (target?.dataset.usersAction === 'change-status') void this.changeStatus(target.dataset.id);
    });
  }
  status(text) { this.get('status').textContent = text; }
  notify(text) {
    if (!this.toast) { this.status(text); return; }
    clearTimeout(this.toastTimer);
    this.toast.textContent = text;
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.toast.hidden = true; this.toast.textContent = ''; }, 2400);
  }
  setActive(active) {
    this.active = Boolean(active); ++this.revision;
    if (this.active) void this.load();
    else this.clear();
  }
  clearIssued() {
    this.issuedCodes = [];
    this.get('issued-list').replaceChildren();
    this.get('issued').hidden = true;
  }
  clear() {
    this.active = false; ++this.revision;
    clearTimeout(this.searchTimer);
    clearTimeout(this.toastTimer);
    if (this.toast) { this.toast.hidden = true; this.toast.textContent = ''; }
    this.lock(false);
    this.clearIssued();
    this.codes = []; this.accounts = []; this.total = 0;
    this.get('codes-list').replaceChildren();
    this.get('accounts-list').replaceChildren();
    this.get('account-search').value = '';
    this.get('account-filter').value = '';
    this.get('code-filter').value = '';
    this.get('account-filter')._usersChoice?.sync();
    this.get('code-filter')._usersChoice?.sync();
    this.get('accounts-more').hidden = true;
    this.status('');
  }
  lock(locked) {
    this.busy = Boolean(locked);
    for (const child of Object.values(this.els)) {
      if ('disabled' in child && child.tagName !== 'FIELDSET') child.disabled = this.busy;
    }
    for (const child of this.root.querySelectorAll('[data-users-action]')) child.disabled = this.busy;
  }
  options(session) { return { session, fetchImpl: this.fetchImpl }; }
  async run(work, {loading = 'Ładowanie…', complete = ''} = {}) {
    if (!this.active || this.busy) return;
    const revision = ++this.revision;
    this.lock(true); this.status(loading);
    try {
      const session = await this.getSession();
      await work(this.options(session), revision);
      if (this.active && this.revision === revision) this.status(complete);
    } catch (error) {
      if (!this.active || this.revision !== revision) return;
      if ((error instanceof AdminUsersError && error.code === 'SESSION') || error?.status === 401 ||
          (error?.status === 403 && error?.code !== 'ADMIN_ACCOUNT_PROTECTED')) {
        this.clear(); this.onAuthFailure();
      } else this.status(error?.message || 'Operacja nie powiodła się.');
    } finally {
      if (this.revision === revision) this.lock(false);
    }
  }
  async load() {
    await this.run(async (options, revision) => {
      const [codes, users] = await Promise.all([listIssuedCodes(options), listPlayerAccounts(0, this.filters(), options)]);
      if (revision !== this.revision || !this.active) return;
      this.codes = codes; this.accounts = users.accounts; this.total = users.total;
      this.renderCodes(); this.renderAccounts();
    }, {complete: ''});
  }
  filters() {
    return {search: this.get('account-search').value, status: this.get('account-filter').value};
  }
  async refreshAccounts() {
    await this.run(async (options, revision) => {
      const users = await listPlayerAccounts(0, this.filters(), options);
      if (revision === this.revision) { this.accounts = users.accounts; this.total = users.total; this.renderAccounts(); }
    }, {loading:'Szukanie kont…'});
  }
  async refreshCodes() {
    await this.run(async (options, revision) => {
      const codes = await listIssuedCodes(options);
      if (revision === this.revision) {this.codes = codes; this.renderCodes();}
    }, {loading: 'Odświeżanie kodów…'});
  }
  async generate() {
    const count = Number(this.get('code-count').value), days = Number(this.get('code-days').value);
    await this.run(async (options, revision) => {
      // Do not leave a previous one-time batch visible after issuing another batch.
      const result = await issueCodes(count, days, options);
      if (revision !== this.revision || !this.active) return;
      this.clearIssued();
      this.issuedCodes = result.codes;
      this.renderIssued();
      // The successful issue response is server-confirmed: avoid a second request
      // that could fail and obscure newly issued, non-recoverable raw codes.
      this.codes = [
        ...result.codes.map(item => ({
          id:item.id, code_hint:item.code.slice(-4),
          expires_at:result.expires_at, status:'available'
        })), ...this.codes
      ].slice(0,250);
      this.renderCodes();
    }, {loading: 'Generowanie kodów…', complete: ''});
  }
  renderIssued() {
    const doc = this.root.ownerDocument, frag = doc.createDocumentFragment();
    for (const item of this.issuedCodes) {
      const row = node(doc,'div','users-issued-row');
      const field = node(doc,'input','users-issued-code');
      field.readOnly = true; field.autocomplete = 'off'; field.spellcheck = false; field.value = item.code; field.setAttribute('aria-label','Wygenerowany kod');
      field.addEventListener('focus', () => field.select());
      field.addEventListener('click', () => field.select());
      row.append(field, button(doc,'Kopiuj kod','copy-code',item.id), button(doc,'Kopiuj link','copy-link',item.id));
      frag.append(row);
    }
    this.get('issued-list').replaceChildren(frag);
    this.get('issued').hidden = false;
  }
  async copy(text, success, target = null) {
    try {
      await this.copyText(text);
      this.notify(success);
      if (target?.isConnected) {
        clearTimeout(this.copyButtonTimers.get(target));
        const originalLabel = target.dataset.originalCopyLabel || target.textContent;
        target.dataset.originalCopyLabel = originalLabel;
        target.textContent = 'Skopiowano ✓';
        const timer = setTimeout(() => {
          if (target.isConnected) target.textContent = originalLabel;
          delete target.dataset.originalCopyLabel;
        }, 1800);
        this.copyButtonTimers.set(target, timer);
      }
    }
    catch { this.notify('Nie udało się skopiować. Zaznacz kod w polu i skopiuj ręcznie.'); }
  }
  async copyAll() {
    if (!this.issuedCodes.length) return;
    await this.copy(this.issuedCodes.map(row => `${row.code}  ${row.link}`).join('\n'), 'Kody i linki skopiowane!', this.get('copy-all'));
  }
  renderCodes() {
    const doc = this.root.ownerDocument, frag = doc.createDocumentFragment();
    const filter = this.get('code-filter').value;
    // Revoked codes disappear from the operator's list immediately. The server
    // keeps their non-secret audit metadata so they cannot be reused.
    const rows = this.codes.filter(row => row.status !== 'revoked' && (!filter || row.status === filter));
    if (!rows.length) frag.append(node(doc,'p','users-empty','Brak kodów.'));
    for (const item of rows) {
      const row = node(doc,'div','users-row');
      const meta = node(doc,'div','users-row-main');
      meta.append(node(doc,'strong','',`Kod ····${item.code_hint || '—'}`));
      const hint = node(doc,'span','users-meta',`Ważny do ${shortDate(item.expires_at)}`);
      meta.append(hint);
      const right = node(doc,'div','users-row-actions');
      const state = node(doc,'span',`users-state users-state-${item.status}`, displayStatus(item.status));
      right.append(state);
      if (item.status === 'available') right.append(button(doc,'Unieważnij','revoke',item.id,true));
      row.append(meta,right); frag.append(row);
    }
    this.get('codes-list').replaceChildren(frag);
  }
  async revoke(id) {
    if (!this.active || this.busy || !this.codes.some(item => item.id === id && item.status === 'available')) return;
    if (!this.confirmAction('Unieważnić ten kod? Nie będzie można go już wykorzystać.')) return;
    await this.run(async (options, revision) => {
      await revokeIssuedCode(id, options);
      if (revision === this.revision) {
        // The successful API response is authoritative. A failed follow-up
        // listing must not leave a server-revoked code visible/copyable.
        this.codes = this.codes.map(item => item.id === id ? {...item,status:'revoked'} : item);
        this.issuedCodes = this.issuedCodes.filter(item => item.id !== id);
        if (this.issuedCodes.length) this.renderIssued();
        else this.clearIssued();
        this.renderCodes();
        this.notify('Kod unieważniony.');
      }
    }, {loading:'Unieważnianie kodu…', complete:'Kod unieważniony.'});
  }
  renderAccounts() {
    const doc = this.root.ownerDocument, frag = doc.createDocumentFragment();
    const rows = this.accounts;
    if (!rows.length) frag.append(node(doc,'p','users-empty',this.accounts.length ? 'Brak pasujących kont.' : 'Brak zarejestrowanych graczy.'));
    for (const item of rows) {
      const row = node(doc,'div','users-row');
      const meta = node(doc,'div','users-row-main');
      meta.append(node(doc,'strong','',item.player_name));
      meta.append(node(doc,'span','users-meta',`Od ${shortDate(item.created_at)} · ${item.user_id.slice(0,8)}…`));
      const right = node(doc,'div','users-row-actions');
      right.append(node(doc,'span',`users-state users-state-${item.status}`,displayStatus(item.status)));
      right.append(button(doc,item.status === 'blocked' ? 'Odblokuj' : 'Zablokuj', 'change-status',item.user_id,item.status !== 'blocked'));
      row.append(meta,right); frag.append(row);
    }
    this.get('accounts-list').replaceChildren(frag);
    this.get('accounts-more').hidden = this.accounts.length >= this.total;
  }
  async loadMore() {
    if (!this.active || this.busy || this.accounts.length >= this.total) return;
    await this.run(async (options, revision) => {
      const result = await listPlayerAccounts(this.accounts.length, this.filters(), options);
      if (revision !== this.revision) return;
      this.accounts = [...this.accounts, ...result.accounts]; this.total = result.total;
      this.renderAccounts();
    }, {loading:'Ładowanie kont…'});
  }
  async changeStatus(id) {
    const account = this.accounts.find(item => item.user_id === id);
    if (!this.active || this.busy || !account) return;
    const next = account.status === 'blocked' ? 'active' : 'blocked';
    if (!this.confirmAction(next === 'blocked' ? `Zablokować konto ${account.player_name}?` : `Odblokować konto ${account.player_name}?`)) return;
    await this.run(async (options, revision) => {
      await changePlayerStatus(id, next, options);
      // Server remains authoritative; do not assume the mutation succeeded locally.
      const users = await listPlayerAccounts(0, this.filters(), options);
      if (revision === this.revision) {
        this.accounts = users.accounts; this.total = users.total;
        this.renderAccounts();
      }
    }, {loading:'Zmiana statusu…',complete:next === 'blocked' ? 'Konto oznaczone jako zablokowane.' : 'Konto odblokowane.'});
  }
}
