/**
 * AUTH-04: accessible styled alternatives to system-native option menus.
 * The original <select> remains the single value authority (form and tests).
 * Keyboard: arrows, Home/End, Enter/Space, Escape, Tab. Native select is fallback
 * when JavaScript is disabled or the enhancement cannot initialize.
 */
export class AdminChoiceSelect {
  constructor(select, doc = select.ownerDocument) {
    this.select = select; this.doc = doc;
    this.options = [...select.options];
    this.opened = false;
    this.activeIndex = Math.max(0, select.selectedIndex);
    this.root = doc.createElement('span');
    this.root.className = 'users-choice';
    this.trigger = doc.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'users-choice-trigger';
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.menu = doc.createElement('div');
    this.menu.className = 'users-choice-menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.tabIndex = -1;
    this.menu.hidden = true;
    this.rootId = `${select.id}-choice`;
    this.menu.id = `${this.rootId}-menu`;
    this.trigger.setAttribute('aria-controls', this.menu.id);
    // Labels already wrap generator selects; controls in filters have aria-label.
    this.trigger.setAttribute('aria-label', select.getAttribute('aria-label') ||
      select.closest('label')?.firstChild?.textContent?.trim() || 'Wybierz opcję');
    this.menuButtons = [];
    this.options.forEach((option, index) => {
      const row = doc.createElement('div');
      row.id = `${this.rootId}-option-${index}`;
      row.className = 'users-choice-option';
      row.setAttribute('role','option');
      row.tabIndex = -1;
      row.textContent = option.textContent;
      row.addEventListener('click', () => this.choose(index));
      row.addEventListener('pointermove', () => { if (this.opened) this.setActive(index); });
      this.menu.append(row);
      this.menuButtons.push(row);
    });
    select.parentNode.insertBefore(this.root, select);
    this.root.append(select, this.trigger, this.menu);
    select.classList.add('users-choice-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden','true');
    select._usersChoice = this;
    this.trigger.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.trigger.addEventListener('keydown', event => this.onKey(event));
    this.menu.addEventListener('keydown', event => this.onKey(event));
    select.addEventListener('change', () => this.sync());
    this.doc.addEventListener('pointerdown', event => {
      if (this.opened && !this.root.contains(event.target)) this.close();
    });
    this.doc.addEventListener('focusin', event => {
      if (this.opened && !this.root.contains(event.target)) this.close();
    });
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(select, {attributes:true, attributeFilter:['disabled']});
    this.sync();
  }

  sync() {
    this.trigger.disabled = this.select.disabled;
    if (this.select.disabled && this.opened) this.close();
    this.activeIndex = Math.max(0, this.select.selectedIndex);
    const selected = this.options[this.activeIndex];
    const label = selected?.textContent || 'Wybierz';
    this.trigger.textContent = label;
    const arrow = this.doc.createElement('span');
    arrow.className = 'users-choice-chevron';
    arrow.setAttribute('aria-hidden','true');
    this.trigger.append(arrow);
    for (let i=0; i<this.menuButtons.length; ++i) {
      this.menuButtons[i].setAttribute('aria-selected', String(i === this.activeIndex));
    }
  }

  setActive(index) {
    this.activeIndex = Math.max(0, Math.min(this.options.length - 1, index));
    const active = this.menuButtons[this.activeIndex];
    this.trigger.setAttribute('aria-activedescendant', active.id);
    this.menuButtons.forEach((row,i) => row.classList.toggle('is-highlighted', i === this.activeIndex));
    active.scrollIntoView?.({block:'nearest'});
  }

  open() {
    if (this.trigger.disabled) return;
    this.opened = true;
    this.menu.hidden = false;
    this.trigger.setAttribute('aria-expanded','true');
    this.setActive(Math.max(0,this.select.selectedIndex));
    this.root.classList.add('is-open');
  }

  close() {
    this.opened = false;
    this.menu.hidden = true;
    this.trigger.setAttribute('aria-expanded','false');
    this.trigger.removeAttribute('aria-activedescendant');
    this.root.classList.remove('is-open');
  }

  choose(index) {
    if (this.select.disabled || !this.options[index]) return;
    const changed = this.select.selectedIndex !== index;
    this.select.selectedIndex = index;
    this.sync();
    this.close();
    this.trigger.focus({preventScroll:true});
    if (changed) this.select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  onKey(event) {
    const key = event.key;
    if (key === 'Tab') { this.close(); return; }
    if (key === 'Escape') { if (this.opened) { event.preventDefault(); this.close(); } return; }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (!this.opened) this.open(); else this.choose(this.activeIndex);
      return;
    }
    const next = {
      ArrowDown: this.activeIndex + 1, ArrowUp: this.activeIndex - 1,
      Home: 0, End: this.options.length - 1
    }[key];
    if (next === undefined) return;
    event.preventDefault();
    if (!this.opened) this.open();
    this.setActive(next);
  }
}

export function enhanceAdminChoiceSelects(root) {
  if (!root || typeof MutationObserver !== 'function') return [];
  return [...root.querySelectorAll('select[data-users-choice]')]
    .map(select => new AdminChoiceSelect(select));
}
