/** Admin-only DOM adapter for game_results. No private rows persisted on disk. */
import { listAdminResults, deleteAdminResult, clearAdminResults, dateInputRange, RESULTS_PAGE_SIZE, AdminResultsError } from "./admin-results.js";

const uiDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) : "—";
};
const labelMode = (row) => row.game_mode === "classic" ? "Klasyczny" : `Speed Run · ${({easy:"łatwy", medium:"średni", hard:"trudny"})[row.difficulty] || "—"}`;
const shortId = (id) => typeof id === "string" ? `${id.slice(0, 8)}…` : "—";

export class AdminResultsPanel {
  constructor({ root, getSession, onAuthFailure, fetchImpl } = {}) {
    this.root = root;
    this.getSession = getSession;
    this.onAuthFailure = onAuthFailure;
    this.fetchImpl = fetchImpl;
    this.controls = {};
    const ids = ["results-search", "results-mode", "results-difficulty", "results-date-from", "results-date-to", "results-sort", "results-reset", "results-status", "results-list", "results-page-label", "results-prev", "results-next", "results-clear", "results-scroll"];
    for (const id of ids) {
      const node = root.querySelector(`#${id}`);
      if (!node) throw new Error(`Admin results missing DOM control: ${id}`);
      this.controls[id] = node;
    }
    this.active = false;
    this.seq = 0;
    this.page = 0;
    this.total = null;
    this.hasNext = false;
    this.busy = false;
    this.mutationBusy = false;
    this.pendingTimer = null;
    this.lastActionMessage = "";
    this.bind();
  }

  get(id) { return this.controls[`results-${id}`]; }

  bind() {
    const trigger = (delay = 0) => {
      if (this.mutationBusy) return;
      ++this.seq; // stale responses must not repaint immediately after filter input
      this.lastActionMessage = "";
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => { this.page = 0; void this.load(); }, delay);
    };
    this.get("search").addEventListener("input", () => trigger(280));
    for (const id of ["mode", "difficulty", "date-from", "date-to", "sort"]) {
      this.get(id).addEventListener("change", () => {
        if (id === "mode") {
          this.get("difficulty").disabled = this.get("mode").value !== "speed-run";
          if (this.get("difficulty").disabled) this.get("difficulty").value = "";
        }
        trigger();
      });
    }
    this.get("reset").addEventListener("click", () => {
      for (const id of ["search", "mode", "difficulty", "date-from", "date-to"]) this.get(id).value = "";
      this.get("sort").value = "newest";
      this.get("difficulty").disabled = true;
      trigger();
    });
    this.get("prev").addEventListener("click", () => {
      if (this.busy || this.page <= 0) return;
      this.page -= 1;
      void this.load();
    });
    this.get("next").addEventListener("click", () => {
      if (this.busy || !this.hasNext) return;
      this.page += 1;
      void this.load();
    });
    this.get("clear").addEventListener("click", () => void this.clearHistory());
    this.get("list").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-result-action]");
      if (!button || this.busy) return;
      const { resultAction: action, resultId: id } = button.dataset;
      if (action === "delete") void this.deleteRow(id);
      if (action === "browser" || action === "player" || action === "game") {
        this.get("search").value = id;
        this.page = 0;
        void this.load();
      }
      if (action === "copy") {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(id)
            .then(() => this.status("Pełny identyfikator skopiowany."))
            .catch(() => { this.get("search").value = id; void this.load(); });
        } else {
          this.get("search").value = id;
          void this.load();
        }
      }
    });
  }

  filters() {
    const { fromInstant, untilInstant } = dateInputRange(this.get("date-from").value, this.get("date-to").value);
    return {
      search: this.get("search").value, mode: this.get("mode").value,
      difficulty: this.get("difficulty").value, sort: this.get("sort").value,
      fromInstant, untilInstant
    };
  }

  status(message) { this.get("status").textContent = message; }

  setActive(active) {
    this.active = Boolean(active);
    ++this.seq;
    clearTimeout(this.pendingTimer);
    if (this.active) { this.page = 0; void this.load(); }
    else this.clearPrivateRows();
  }

  clearPrivateRows() {
    this.get("list").replaceChildren();
    this.get("page-label").textContent = "—";
    this.get("prev").disabled = true;
    this.get("next").disabled = true;
    this.hasNext = false;
    this.total = null;
  }

  clear() {
    this.active = false;
    ++this.seq;
    clearTimeout(this.pendingTimer);
    this.busy = false;
    this.mutationBusy = false;
    this.clearPrivateRows();
    this.status("");
    this.lastActionMessage = "";
    for (const id of ["search", "mode", "difficulty", "date-from", "date-to"]) this.get(id).value = "";
    this.get("sort").value = "newest";
  }

  async credentials() { return await this.getSession(); }

  handleError(error, seq) {
    if (!this.active || seq !== this.seq) return;
    if (error instanceof AdminResultsError && (error.code === "SESSION" || error.status === 401 || error.status === 403)) {
      this.clear();
      this.onAuthFailure();
      return;
    }
    this.status(error?.message || "Nie udało się pobrać wyników.");
  }

  async load() {
    if (!this.active) return;
    const seq = ++this.seq;
    this.busy = true;
    this.get("prev").disabled = true;
    this.get("next").disabled = true;
    this.status("Ładowanie wyników…");
    try {
      const session = await this.credentials();
      const result = await listAdminResults({ session, page: this.page, filters: this.filters(), fetchImpl: this.fetchImpl });
      if (!this.active || seq !== this.seq) return;
      if (result.rows.length === 0 && this.page > 0) {
        this.page -= 1;
        return void this.load();
      }
      this.total = result.total;
      this.hasNext = result.hasNext;
      this.render(result.rows);
      const currentMessage = result.rows.length
        ? `Wyświetlono ${result.rows.length} ${result.rows.length === 1 ? "wynik" : "wyników"}.`
        : "Brak wyników dla wybranych filtrów.";
      this.status([this.lastActionMessage, currentMessage].filter(Boolean).join(" "));
      this.get("page-label").textContent = `Strona ${this.page + 1}${this.total !== null ? ` · ${this.total} wyników` : ""}`;
    } catch (error) {
      this.clearPrivateRows();
      this.handleError(error, seq);
    } finally {
      if (seq === this.seq) {
        this.busy = false;
        this.get("prev").disabled = this.page === 0;
        this.get("next").disabled = !this.hasNext;
      }
    }
  }

  render(rows) {
    const list = this.get("list");
    list.replaceChildren();
    for (const record of rows) {
      const row = document.createElement("article");
      row.className = "results-row";
      const player = document.createElement("div");
      player.className = "results-row-player";
      const name = document.createElement("strong");
      name.textContent = record.player_name || "—";
      const profile = document.createElement("span");
      profile.className = "results-small";
      profile.textContent = `Profil: ${shortId(record.player_id)}`;
      player.append(name, profile);
      const score = document.createElement("div");
      score.className = "results-score";
      const percent = document.createElement("strong");
      percent.textContent = `${record.accuracy_percent ?? "—"}%`;
      const count = document.createElement("span");
      count.className = "results-small";
      count.textContent = `${record.correct_answers}/${record.attempts} · ${labelMode(record)}`;
      score.append(percent, count);
      const dates = document.createElement("div");
      dates.className = "results-row-dates";
      const done = document.createElement("span");
      done.textContent = `Koniec: ${uiDate(record.finished_at_client)}`;
      const saved = document.createElement("span");
      saved.className = "results-small";
      saved.textContent = `Zapis: ${uiDate(record.received_at)}`;
      dates.append(done, saved);
      const actions = document.createElement("div");
      actions.className = "results-row-actions";
      const action = (label, type, id, danger = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `results-action${danger ? " is-danger" : ""}`;
        button.textContent = label;
        button.dataset.resultAction = type;
        button.dataset.resultId = id;
        return button;
      };
      actions.append(
        action("Profil", "player", record.player_id),
        action("Przeglądarka", "browser", record.browser_id),
        action("Kopiuj Game ID", "copy", record.client_session_id),
        action("Usuń", "delete", record.id, true)
      );
      const ids = document.createElement("div");
      ids.className = "results-small results-id-line";
      ids.textContent = `Browser: ${shortId(record.browser_id)} · Game: ${shortId(record.client_session_id)}`;
      actions.append(ids);
      row.append(player, score, dates, actions);
      list.append(row);
    }
    this.get("scroll").scrollTop = 0;
  }

  async deleteRow(id) {
    if (!this.active || this.busy || !window.confirm("Usunąć tę rozgrywkę? Tej operacji nie można cofnąć.")) return;
    await this.mutate(() => deleteAdminResult(id, { session: this.getSessionValue, fetchImpl: this.fetchImpl }), "Usunięto wynik");
  }

  async clearHistory() {
    if (!this.active || this.busy) return;
    if (!window.confirm("Usunąć WSZYSTKIE zapisane wyniki graczy? To nieodwracalna operacja. Biblioteka obrazów pozostanie bez zmian.")) return;
    await this.mutate(() => clearAdminResults({ session: this.getSessionValue, fetchImpl: this.fetchImpl }), "Wyczyszczono historię");
  }

  async mutate(operation, label) {
    this.busy = true;
    this.mutationBusy = true;
    const seq = ++this.seq;
    this.get("clear").disabled = true;
    this.get("prev").disabled = true;
    this.get("next").disabled = true;
    this.status("Zapisywanie zmiany…");
    try {
      this.getSessionValue = await this.credentials();
      const count = await operation();
      if (!this.active || seq !== this.seq) return;
      this.lastActionMessage = `${label}: ${count}.`;
      this.status(this.lastActionMessage);
    } catch (error) {
      this.handleError(error, seq);
      return;
    } finally {
      this.getSessionValue = null;
      if (seq === this.seq) {
        this.busy = false;
        this.mutationBusy = false;
        this.get("clear").disabled = false;
      }
    }
    if (this.active) await this.load();
  }
}
