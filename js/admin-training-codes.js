/** Authorized admin UI. Raw codes exist only in this tab after creation. */
import { generateTrainingCodes, getTrainingCodeStats, TRAINING_BATCH_MAX } from "./training-access.js";

export class AdminTrainingCodesPanel {
  constructor({ root, getSession, onAuthFailure }) {
    this.root = root;
    this.getSession = getSession;
    this.onAuthFailure = onAuthFailure;
    this.active = false;
    this.busy = false;
    this.revision = 0;
    this.codes = [];
    this.count = root.querySelector("#codes-count");
    this.generateButton = root.querySelector("#codes-generate");
    this.copyButton = root.querySelector("#codes-copy");
    this.output = root.querySelector("#codes-output");
    this.status = root.querySelector("#codes-status");
    this.stats = root.querySelector("#codes-stats");
    this.count.max = TRAINING_BATCH_MAX;
    this.generateButton.addEventListener("click", () => void this.generate());
    this.copyButton.addEventListener("click", () => void this.copy());
  }

  setActive(active) {
    this.active = active;
    ++this.revision;
    if (!active) {
      this.codes = [];
      this.output.value = "";
      this.copyButton.disabled = true;
      this.status.textContent = "";
    } else {
      void this.refreshStats();
    }
  }

  async session() {
    try { return await this.getSession(); }
    catch (error) {
      if (error?.status === 401 || error?.status === 403 ||
          ["AUTH_ACCESS_TOKEN_MISSING", "ADMIN_FORBIDDEN"].includes(error?.code)) {
        this.onAuthFailure();
      }
      throw error;
    }
  }

  async refreshStats() {
    const revision = this.revision;
    try {
      const session = await this.session();
      const counts = await getTrainingCodeStats(session.access_token);
      if (this.active && revision === this.revision) {
        this.stats.textContent = `Wygenerowane: ${counts.total_count} · Wolne: ${counts.unused_count} · Wykorzystane: ${counts.used_count}`;
      }
    } catch (error) {
      if (this.active && revision === this.revision) {
        this.stats.textContent = error?.message || "Nie można pobrać liczników.";
      }
    }
  }

  async generate() {
    if (!this.active || this.busy) return;
    const count = Number(this.count.value);
    if (!Number.isInteger(count) || count < 1 || count > TRAINING_BATCH_MAX) {
      this.status.textContent = `Wpisz liczbę od 1 do ${TRAINING_BATCH_MAX}.`;
      return;
    }
    const revision = this.revision;
    this.busy = true;
    this.generateButton.disabled = true;
    this.copyButton.disabled = true;
    this.codes = [];
    this.output.value = "";
    this.status.textContent = "Generowanie w Supabase…";
    try {
      const session = await this.session();
      const codes = await generateTrainingCodes(count, session.access_token);
      if (!this.active || revision !== this.revision) return;
      this.codes = codes;
      this.output.value = codes.join("\n");
      this.copyButton.disabled = false;
      this.status.textContent = `Utworzono ${codes.length} kodów. Skopiuj je teraz — po opuszczeniu tej zakładki nie będzie można ich ponownie odczytać.`;
      void this.refreshStats();
    } catch (error) {
      if (this.active && revision === this.revision) {
        this.status.textContent = error?.message || "Generowanie kodów nie powiodło się.";
      }
    } finally {
      this.busy = false;
      this.generateButton.disabled = false;
    }
  }

  async copy() {
    if (!this.active || !this.codes.length) return;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await globalThis.navigator.clipboard.writeText(this.codes.join("\n"));
      if (this.active) this.status.textContent = `Skopiowano ${this.codes.length} kodów do schowka.`;
    } catch {
      this.output.focus();
      this.output.select();
      this.status.textContent = "Nie udało się użyć schowka. Zaznaczony tekst skopiuj Ctrl+C.";
    }
  }
}
