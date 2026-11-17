/** AUTH-04C: one persistent metadata list; plaintext exists only while this tab is active. */
import {
  AdminUsersError, listIssuedCodes, revealIssuedCode, issueCodes, revokeIssuedCode,
  listPlayerAccounts, changePlayerStatus
} from './admin-users.js?v=auth04c';

const labels = Object.freeze({
  available: 'Aktywny', reserved: 'Zarezerwowany', consumed: 'Wykorzystany',
  expired: 'Wygasł', active: 'Aktywne', blocked: 'Zablokowane'
});
const shortDate = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pl-PL', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date) : '—';
};
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

export class AdminUsersPanel {
  constructor({root, getSession, onAuthFailure, fetchImpl, confirmAction = message => window.confirm(message),
    copyText = text => navigator.clipboard.writeText(text)} = {}) {
    if (!root) throw new Error('Missing Users workspace');
    this.root = root; this.getSession = getSession; this.onAuthFailure = onAuthFailure;
    this.fetchImpl = fetchImpl; this.confirmAction = confirmAction; this.copyText = copyText;
    this.els = Object.fromEntries([
      'users-generate-form','users-code-count','users-code-days','users-generate-button',
      'users-code-filter','users-codes-list','users-codes-refresh',
      'users-account-search','users-account-filter','users-accounts-list','users-accounts-more',
      'users-status'
    ].map(id => [id, root.querySelector(`#${id}`)]));
    if (Object.values(this.els).some(value => !value)) throw new Error('Incomplete Admin Users markup');
    this.active = false; this.busy = false; this.revision = 0;
    this.codes = []; this.accounts = []; this.total = 0;
    this.codesLoaded = false;
    this.revealed = new Map();
    this.toast = root.querySelector('#users-toast');
    this.toastTimer = null; this.searchTimer = null;
    this.bind();
  }
  get(id) { return this.els[`users-${id}`]; }
  bind() {
    this.get('generate-form').addEventListener('submit', event => { event.preventDefault(); void this.generate(); });
    this.get('codes-refresh').addEventListener('click', () => void this.refreshCodes());
    this.get('code-filter').addEventListener('change', () => this.renderCodes());
    this.get('account-search').addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.refreshAccounts(), 300);
    });
    this.get('account-filter').addEventListener('change', () => void this.refreshAccounts());
    this.get('accounts-more').addEventListener('click', () => void this.loadMore());
    this.get('codes-list').addEventListener('click', event => {
      const target = event.target.closest('[data-users-action]');
      if (!target || this.busy) return;
      const id = target.dataset.id;
      switch (target.dataset.usersAction) {
        case 'reveal': void this.reveal(id); break;
        case 'hide': this.hide(id); break;
        case 'copy-code': void this.copy(id, 'code'); break;
        case 'copy-link': void this.copy(id, 'link'); break;
        case 'revoke': void this.revoke(id); break;
        default: break;
      }
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
    this.toast.textContent = text; this.toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true; this.toast.textContent = '';
    }, 2400);
  }
  setActive(active) {
    if (!active) { this.clear(); return; }
    if (this.active) return;
    this.active = true;
    void this.load();
  }
  clear() {
    this.active = false; ++this.revision;
    clearTimeout(this.searchTimer); clearTimeout(this.toastTimer);
    if (this.toast) { this.toast.hidden = true; this.toast.textContent = ''; }
    this.revealed.clear(); this.codesLoaded = false;
    this.codes = []; this.accounts = []; this.total = 0;
    this.get('codes-list').replaceChildren(); this.get('accounts-list').replaceChildren();
    this.get('account-search').value = ''; this.get('account-filter').value = '';
    this.get('code-filter').value = '';
    this.get('account-filter')._usersChoice?.sync();
    this.get('code-filter')._usersChoice?.sync();
    this.get('accounts-more').hidden = true;
    this.lock(false); this.status('');
  }
  lock(locked) {
    this.busy = Boolean(locked);
    for (const child of Object.values(this.els)) {
      if ('disabled' in child && child.tagName !== 'FIELDSET') child.disabled = this.busy;
    }
    for (const child of this.root.querySelectorAll('[data-users-action]')) child.disabled = this.busy;
  }
  options(session) { return {session, fetchImpl: this.fetchImpl}; }
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
  filters() { return {search: this.get('account-search').value, status: this.get('account-filter').value}; }
  async load() {
    await this.run(async (options, revision) => {
      const [codes, users] = await Promise.all([listIssuedCodes(options), listPlayerAccounts(0, this.filters(), options)]);
      if (revision !== this.revision || !this.active) return;
      this.codes = codes; this.codesLoaded = true;
      this.accounts = users.accounts; this.total = users.total;
      this.renderCodes(); this.renderAccounts();
    });
  }
  async refreshCodes() {
    await this.run(async (options, revision) => {
      const codes = await listIssuedCodes(options);
      if (revision !== this.revision || !this.active) return;
      this.codes = codes; this.codesLoaded = true;
      for (const id of this.revealed.keys()) {
        if (!codes.some(row => row.id === id && row.can_reveal)) this.revealed.delete(id);
      }
      this.renderCodes();
    }, {loading:'Odświeżanie kodów…'});
  }
  async refreshAccounts() {
    await this.run(async (options, revision) => {
      const users = await listPlayerAccounts(0, this.filters(), options);
      if (revision === this.revision) {
        this.accounts = users.accounts; this.total = users.total; this.renderAccounts();
      }
    }, {loading:'Szukanie kont…'});
  }
  async generate() {
    if (!this.active || this.busy) return;
    if (!this.codesLoaded) {
      this.status('Najpierw wczytaj historię kodów. Nie generuj kolejnych w ciemno.');
      return;
    }
    if (this.codes.some(row => row.status === 'available') &&
      !this.confirmAction('Masz już aktywne kody. Możesz je otworzyć przyciskiem „Pokaż”. Czy na pewno wygenerować kolejne?')) return;
    const count = Number(this.get('code-count').value), days = Number(this.get('code-days').value);
    await this.run(async (options, revision) => {
      const result = await issueCodes(count, days, options);
      if (revision !== this.revision || !this.active) return;
      const rows = result.codes.map(item => ({
        id:item.id, code_hint:item.code.slice(-4), expires_at:result.expires_at,
        status:'available', can_reveal:true, can_delete:true
      }));
      this.codes = [...rows, ...this.codes].slice(0,250);
      for (const item of result.codes) this.revealed.set(item.id, {code:item.code, link:item.link});
      this.renderCodes(); this.notify('Nowe kody są gotowe. Możesz je skopiować z listy.');
    }, {loading:'Generowanie kodów…'});
  }
  async reveal(id) {
    if (!this.active || this.busy || !this.codes.some(row => row.id === id && row.can_reveal)) return;
    if (this.revealed.has(id)) { this.renderCodes(); return; }
    await this.run(async (options, revision) => {
      const result = await revealIssuedCode(id, options);
      if (revision !== this.revision || !this.active) return;
      this.revealed.set(id, {code:result.code, link:result.link});
      this.renderCodes();
    }, {loading:'Otwieranie kodu…'});
  }
  hide(id) {
    if (!this.active || this.busy) return;
    this.revealed.delete(id); this.renderCodes();
  }
  async copy(id, kind) {
    const secret = this.revealed.get(id);
    if (!this.active || this.busy || !secret || !['code','link'].includes(kind)) return;
    try {
      await this.copyText(secret[kind]);
      if (this.active && this.revealed.get(id) === secret)
        this.notify(kind === 'code' ? 'Kod skopiowany!' : 'Link skopiowany!');
    } catch {
      if (!this.active || this.revealed.get(id) !== secret) return;
      const input = [...this.get('codes-list').querySelectorAll('input[data-code-field]')]
        .find(field => field.dataset.id === id && field.dataset.codeField === kind);
      input?.focus(); input?.select();
      this.notify('Zaznaczony tekst skopiuj ręcznie (Ctrl+C).');
    }
  }
  renderCodes() {
    if (!this.active) return;
    const doc = this.root.ownerDocument, frag = doc.createDocumentFragment();
    const filter = this.get('code-filter').value;
    const rows = this.codes.filter(row => !filter || row.status === filter);
    if (!rows.length) frag.append(node(doc,'p','users-empty','Brak kodów.'));
    for (const item of rows) {
      const wrapper = node(doc, 'div', 'users-code-entry');
      const row = node(doc, 'div', 'users-row');
      const meta = node(doc, 'div', 'users-row-main');
      meta.append(node(doc,'strong','',`Kod ····${item.code_hint || '—'}`));
      meta.append(node(doc,'span','users-meta',`Ważny do ${shortDate(item.expires_at)}`));
      const actions = node(doc, 'div', 'users-row-actions');
      actions.append(node(doc,'span',`users-state users-state-${item.status}`,labels[item.status] || 'Nieznany'));
      if (item.can_reveal) actions.append(button(doc,this.revealed.has(item.id) ? 'Ukryj' : 'Pokaż',
        this.revealed.has(item.id) ? 'hide' : 'reveal',item.id));
      if (item.can_delete) actions.append(button(doc,'Usuń','revoke',item.id,true));
      row.append(meta,actions); wrapper.append(row);
      const secret = this.revealed.get(item.id);
      if (item.can_reveal && secret) {
        const panel = node(doc,'div','users-secret-panel');
        for (const [kind,description] of [['code','Kod aktywacyjny'],['link','Link do rejestracji']]) {
          const fieldRow = node(doc,'div','users-secret-row');
          const label = node(doc,'label','users-secret-label',description);
          const input = node(doc,'input','users-secret-input');
          input.type = 'text'; input.readOnly = true; input.value = secret[kind];
          input.autocomplete = 'off'; input.spellcheck = false;
          input.dataset.codeField = kind; input.dataset.id = item.id;
          input.id = `users-${kind}-${item.id}`; label.htmlFor = input.id;
          input.addEventListener('focus', () => input.select());
          input.addEventListener('click', () => input.select());
          fieldRow.append(label,input,button(doc,kind === 'code' ? 'Kopiuj kod' : 'Kopiuj link',
            kind === 'code' ? 'copy-code' : 'copy-link',item.id));
          panel.append(fieldRow);
        }
        wrapper.append(panel);
      } else if (item.status === 'available' && !item.can_reveal) {
        wrapper.append(node(doc,'p','users-legacy-note','Starszy kod bez możliwości odczytu. Usuń go, jeśli nie został przekazany.'));
      }
      frag.append(wrapper);
    }
    this.get('codes-list').replaceChildren(frag);
  }
  async revoke(id) {
    if (!this.active || this.busy || !this.codes.some(item => item.id === id && item.can_delete)) return;
    if (!this.confirmAction('Usunąć ten niewykorzystany kod? Nie będzie można go już wykorzystać.')) return;
    await this.run(async (options, revision) => {
      await revokeIssuedCode(id, options);
      if (revision !== this.revision) return;
      this.revealed.delete(id);
      this.codes = this.codes.filter(item => item.id !== id);
      this.renderCodes(); this.notify('Kod usunięty.');
    }, {loading:'Usuwanie kodu…'});
  }
  renderAccounts() {
    if (!this.active) return;
    const doc = this.root.ownerDocument, frag = doc.createDocumentFragment();
    if (!this.accounts.length) frag.append(node(doc,'p','users-empty','Brak zarejestrowanych graczy.'));
    for (const item of this.accounts) {
      const row = node(doc,'div','users-row'), meta = node(doc,'div','users-row-main');
      meta.append(node(doc,'strong','',item.player_name));
      meta.append(node(doc,'span','users-meta',`Od ${shortDate(item.created_at)} · ${item.user_id.slice(0,8)}…`));
      const actions = node(doc,'div','users-row-actions');
      actions.append(node(doc,'span',`users-state users-state-${item.status}`,labels[item.status] || 'Nieznany'));
      actions.append(button(doc,item.status === 'blocked' ? 'Odblokuj' : 'Zablokuj',
        'change-status',item.user_id,item.status !== 'blocked'));
      row.append(meta,actions); frag.append(row);
    }
    this.get('accounts-list').replaceChildren(frag);
    this.get('accounts-more').hidden = this.accounts.length >= this.total;
  }
  async loadMore() {
    if (!this.active || this.busy || this.accounts.length >= this.total) return;
    await this.run(async (options, revision) => {
      const result = await listPlayerAccounts(this.accounts.length, this.filters(), options);
      if (revision !== this.revision) return;
      this.accounts = [...this.accounts,...result.accounts]; this.total = result.total;
      this.renderAccounts();
    }, {loading:'Ładowanie kont…'});
  }
  async changeStatus(id) {
    const account = this.accounts.find(item => item.user_id === id);
    if (!this.active || this.busy || !account) return;
    const next = account.status === 'blocked' ? 'active' : 'blocked';
    if (!this.confirmAction(next === 'blocked' ? `Zablokować konto ${account.player_name}?` :
      `Odblokować konto ${account.player_name}?`)) return;
    await this.run(async (options, revision) => {
      await changePlayerStatus(id, next, options);
      const users = await listPlayerAccounts(0,this.filters(),options);
      if (revision !== this.revision) return;
      this.accounts = users.accounts; this.total = users.total;
      this.renderAccounts();
    }, {loading:'Zmiana statusu…',complete:next === 'blocked' ?
      'Konto oznaczone jako zablokowane.' : 'Konto odblokowane.'});
  }
}
