/** Compact authenticated editor, rendered with DOM text nodes (no HTML injection). */
import {
  AdminStreakError, listAdminStreakMessages, addAdminStreakMessage,
  updateAdminStreakMessage, deleteAdminStreakMessage
} from "./admin-streak-messages.js";
import { normalizeStreakMessage } from "./streak-messages.js";

export class AdminStreakPanel {
  constructor({ root, getSession, onAuthFailure, fetchImpl, confirmDelete = (message) => window.confirm(message) } = {}) {
    if (!root) throw new Error("Missing streak workspace");
    this.root = root;
    this.getSession = getSession;
    this.onAuthFailure = onAuthFailure;
    this.fetchImpl = fetchImpl;
    this.confirmDelete = confirmDelete;
    this.list = root.querySelector("#streak-admin-list");
    this.form = root.querySelector("#streak-admin-form");
    this.input = root.querySelector("#streak-admin-input");
    this.addButton = root.querySelector("#streak-admin-add");
    this.status = root.querySelector("#streak-admin-status");
    if (![this.list, this.form, this.input, this.addButton, this.status].every(Boolean)) {
      throw new Error("Incomplete Admin Gratifications markup");
    }
    this.active = false;
    this.busy = false;
    this.revision = 0;
    this.editingId = null;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.active || this.busy) return;
      void this.add();
    });
    this.list.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-streak-action]");
      if (!button || this.busy || !this.active) return;
      const { streakAction: action, streakId: id } = button.dataset;
      if (action === "edit") this.beginEdit(id);
      if (action === "cancel") void this.load();
      if (action === "save") void this.save(id);
      if (action === "delete") void this.remove(id);
    });
  }
  setActive(active) {
    this.active = Boolean(active);
    ++this.revision;
    this.editingId = null;
    if (this.active) void this.load();
    else this.clear();
  }
  clear() {
    this.active = false;
    ++this.revision;
    this.editingId = null;
    this.list.replaceChildren();
    this.status.textContent = "";
    this.input.value = "";
  }
  lock(value) {
    this.busy = Boolean(value);
    this.addButton.disabled = this.busy;
    this.input.disabled = this.busy;
    for (const element of this.list.querySelectorAll("button, input")) element.disabled = this.busy;
  }
  handleError(error, revision) {
    if (revision !== this.revision || !this.active) return;
    if (error instanceof AdminStreakError && error.code === "SESSION") {
      this.clear();
      this.onAuthFailure();
    } else this.status.textContent = error?.message || "Nie udało się wykonać operacji.";
  }
  async credentials() { return this.getSession(); }
  async load() {
    if (!this.active) return;
    const revision = ++this.revision;
    this.lock(true);
    this.status.textContent = "Ładowanie…";
    try {
      const session = await this.credentials();
      const rows = await listAdminStreakMessages({ session, fetchImpl: this.fetchImpl });
      if (!this.active || revision !== this.revision) return;
      this.rows = rows;
      this.render(rows);
      this.status.textContent = rows.length ? "" : "Brak komunikatów. Dodaj pierwszy.";
    } catch (error) {
      this.handleError(error, revision);
    } finally { if (revision === this.revision) this.lock(false); }
  }
  createButton(title, action, id, danger = false) {
    const button = this.root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `admin-secondary-button compact-button${danger ? " danger-button" : ""}`;
    button.textContent = title;
    button.dataset.streakAction = action;
    button.dataset.streakId = id;
    return button;
  }
  render(rows) {
    const fragment = this.root.ownerDocument.createDocumentFragment();
    for (const row of rows) {
      const element = this.root.ownerDocument.createElement("div");
      element.className = "streak-admin-row";
      const label = this.root.ownerDocument.createElement("span");
      label.className = "streak-admin-message";
      label.textContent = row.message;
      label.dataset.streakText = row.id;
      const actions = this.root.ownerDocument.createElement("div");
      actions.className = "streak-admin-actions";
      actions.append(this.createButton("Edytuj", "edit", row.id), this.createButton("Usuń", "delete", row.id, true));
      element.append(label, actions);
      fragment.appendChild(element);
    }
    this.list.replaceChildren(fragment);
  }
  beginEdit(id) {
    if (!this.rows?.some(row => row.id === id)) return;
    // One inline editor; no nested popups or duplicate explanations.
    this.render(this.rows);
    const row = [...this.list.children].find((node) => node.querySelector(`[data-streak-text="${id}"]`));
    if (!row) return;
    const input = this.root.ownerDocument.createElement("input");
    input.className = "streak-admin-edit";
    input.maxLength = 60;
    input.value = this.rows.find(entry => entry.id === id).message;
    input.setAttribute("aria-label", "Edytuj komunikat");
    const actions = row.querySelector(".streak-admin-actions");
    row.querySelector(".streak-admin-message").replaceWith(input);
    actions.replaceChildren(this.createButton("Zapisz", "save", id), this.createButton("Anuluj", "cancel", id));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void this.save(id); }
      if (event.key === "Escape") void this.load();
    });
    input.focus();
    this.editingId = id;
  }
  async modify(action) {
    if (!this.active || this.busy) return;
    const revision = ++this.revision;
    this.lock(true);
    this.status.textContent = "";
    try {
      const session = await this.credentials();
      await action(session);
      if (this.active && revision === this.revision) {
        this.input.value = "";
        // Reload is authoritative; never claim saved before server confirmation.
        await this.load();
      }
    } catch (error) {
      this.handleError(error, revision);
    } finally { if (revision === this.revision) this.lock(false); }
  }
  async add() {
    const message = normalizeStreakMessage(this.input.value);
    if (!message) { this.status.textContent = "Wpisz komunikat do 60 znaków."; return; }
    await this.modify(async (session) => addAdminStreakMessage(message, { session, fetchImpl: this.fetchImpl }));
  }
  async save(id) {
    const input = this.list.querySelector(".streak-admin-edit");
    const message = normalizeStreakMessage(input?.value);
    if (!message) { this.status.textContent = "Wpisz komunikat do 60 znaków."; return; }
    await this.modify(async (session) => updateAdminStreakMessage(id, message, { session, fetchImpl: this.fetchImpl }));
  }
  async remove(id) {
    if (!this.confirmDelete("Usunąć ten komunikat?")) return;
    await this.modify(async (session) => deleteAdminStreakMessage(id, { session, fetchImpl: this.fetchImpl }));
  }
}
