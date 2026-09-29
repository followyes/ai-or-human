import {
  AdminAuthError,
  authorizeAdminSession,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  signInWithPassword,
  signOutAdmin
} from "../js/admin-auth.js";
import {
  AdminContentError,
  assertImageHashAvailable,
  cutoverExternalContent,
  deleteGameImage,
  fetchRepositoryMigrationTarget,
  getContentMigrationStatus,
  listGameImages,
  registerPreparedImage,
  rollbackExternalContentCutover
} from "../js/admin-content.js";
import {
  AvifConversionError,
  convertSourceFileToAvif,
  formatBytes,
  inspectSourceFile
} from "../js/avif-converter.js";

const loginView = document.querySelector("#login-view");
const authorizedView = document.querySelector("#authorized-view");
const bootView = document.querySelector("#boot-view");

const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const loginStatus = document.querySelector("#login-status");
const adminEmail = document.querySelector("#admin-email");
const logoutButton = document.querySelector("#logout-button");

const classInputs = [...document.querySelectorAll('input[name="content-class"]')];
const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const queueHeader = document.querySelector("#queue-header");
const queueSummary = document.querySelector("#queue-summary");
const uploadQueue = document.querySelector("#upload-queue");
const uploadModeBadge = document.querySelector("#upload-mode-badge");

const inventoryRefreshButton = document.querySelector("#inventory-refresh");
const inventoryStatus = document.querySelector("#inventory-status");
const inventoryGrid = document.querySelector("#inventory-grid");
const inventoryFilterButtons = [...document.querySelectorAll("[data-filter]")];
const countTotal = document.querySelector("#count-total");
const countAi = document.querySelector("#count-ai");
const countHuman = document.querySelector("#count-human");
const countActive = document.querySelector("#count-active");
const migrationMode = document.querySelector("#migration-mode");
const migrationTargetTotal = document.querySelector("#migration-target-total");
const migrationTargetAi = document.querySelector("#migration-target-ai");
const migrationTargetHuman = document.querySelector("#migration-target-human");
const migrationDbTotal = document.querySelector("#migration-db-total");
const migrationDbAi = document.querySelector("#migration-db-ai");
const migrationDbHuman = document.querySelector("#migration-db-human");
const migrationDbActive = document.querySelector("#migration-db-active");
const migrationChecks = document.querySelector("#migration-checks");
const migrationRefreshButton = document.querySelector("#migration-refresh");
const migrationCutoverButton = document.querySelector("#migration-cutover");
const migrationRollbackButton = document.querySelector("#migration-rollback");
const migrationStatus = document.querySelector("#migration-status");


let currentSession = null;
let authBusy = false;
let uploadBusy = false;
let completedCount = 0;
let failedCount = 0;

let inventoryRows = [];
let inventoryFilter = "all";
let inventoryBusy = false;
const deletingIds = new Set();

let migrationTarget = null;
let migrationSnapshot = null;
let migrationBusy = false;


function showOnly(view) {
  for (const node of [loginView, authorizedView, bootView]) {
    node.classList.toggle("is-hidden", node !== view);
  }
}

function setAuthBusy(value) {
  authBusy = Boolean(value);
  loginButton.disabled = authBusy;
  logoutButton.disabled = authBusy || uploadBusy;
  emailInput.disabled = authBusy;
  passwordInput.disabled = authBusy;
}

function setUploadBusy(value) {
  uploadBusy = Boolean(value);
  dropZone.disabled = uploadBusy;
  for (const input of classInputs) input.disabled = uploadBusy;
  logoutButton.disabled = authBusy || uploadBusy;
}

function selectedContentClass() {
  return classInputs.find((input) => input.checked)?.value || "";
}

function messageForAuthError(error) {
  if (!(error instanceof AdminAuthError)) return "Nie udało się zalogować. Spróbuj ponownie.";
  if (error.code === "email_not_confirmed") return "Adres e-mail tego konta nie został jeszcze potwierdzony.";
  if (error.code === "invalid_credentials" || error.code === "INVALID_CREDENTIALS") return "Nieprawidłowy e-mail lub hasło.";
  if (error.code === "ADMIN_FORBIDDEN") return "To konto nie ma uprawnień administratora.";
  if (error.code === "AUTH_REQUEST_TIMEOUT") return "Supabase nie odpowiedział na czas. Spróbuj ponownie.";
  if (error.code === "AUTH_NETWORK_FAILED") return "Nie udało się połączyć z Supabase.";
  return "Nie udało się zalogować. Spróbuj ponownie.";
}

function messageForUploadError(error) {
  if (error instanceof AvifConversionError) return error.message;

  if (error instanceof AdminContentError) {
    if (error.code === "SOURCE_DUPLICATE" || error.code === "AVIF_DUPLICATE") return error.message;
    if (error.code === "23505") return "Ten obraz już istnieje w bazie.";
    if (error.code === "CONTENT_SESSION_MISSING" || error.status === 401) return "Sesja administratora wygasła.";
    return error.message || "Supabase odrzucił upload.";
  }

  return "Nie udało się przetworzyć obrazu.";
}


function isDuplicateError(error) {
  return error instanceof AdminContentError &&
    (error.code === "SOURCE_DUPLICATE" || error.code === "AVIF_DUPLICATE");
}

function formatInventoryDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function updateInventoryStats() {
  countTotal.textContent = String(inventoryRows.length);
  countAi.textContent = String(inventoryRows.filter((row) => row.content_class === "ai").length);
  countHuman.textContent = String(inventoryRows.filter((row) => row.content_class === "human").length);
  countActive.textContent = String(inventoryRows.filter((row) => row.is_active === true).length);
}

function filteredInventoryRows() {
  if (inventoryFilter === "all") return inventoryRows;
  return inventoryRows.filter((row) => row.content_class === inventoryFilter);
}

function setInventoryStatus(message = "", { error = false } = {}) {
  inventoryStatus.textContent = message;
  inventoryStatus.classList.toggle("is-error", Boolean(error));
}

function renderInventory() {
  updateInventoryStats();
  inventoryGrid.replaceChildren();

  for (const button of inventoryFilterButtons) {
    button.classList.toggle("is-active", button.dataset.filter === inventoryFilter);
  }

  const rows = filteredInventoryRows();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "inventory-empty";
    empty.textContent = inventoryRows.length
      ? "Brak obrazów w tej kategorii."
      : "Biblioteka jest pusta.";
    inventoryGrid.append(empty);
    return;
  }

  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "inventory-card";
    card.dataset.imageId = row.id;
    card.classList.toggle("is-deleting", deletingIds.has(row.id));

    const imageWrap = document.createElement("div");
    imageWrap.className = "inventory-image-wrap";

    const image = document.createElement("img");
    image.className = "inventory-image";
    image.src = row.public_url;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt = "Brak podglądu";
    }, { once: true });
    imageWrap.append(image);

    const deleteButton = document.createElement("button");
    deleteButton.className = "inventory-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.dataset.deleteId = row.id;
    deleteButton.setAttribute("aria-label", `Usuń ${row.original_filename || "obraz"}`);
    deleteButton.disabled = deletingIds.has(row.id);

    const body = document.createElement("div");
    body.className = "inventory-body";

    const meta = document.createElement("div");
    meta.className = "inventory-meta-row";

    const classBadge = document.createElement("span");
    classBadge.className = "inventory-class";
    classBadge.textContent = row.content_class.toUpperCase();

    const stateBadge = document.createElement("span");
    stateBadge.className = "inventory-state";
    stateBadge.classList.toggle("is-active", row.is_active === true);
    stateBadge.textContent = row.is_active ? "AKTYWNY" : "NIEAKTYWNY";

    meta.append(classBadge, stateBadge);

    const name = document.createElement("p");
    name.className = "inventory-name";
    name.textContent = row.original_filename || row.storage_path;

    const detail = document.createElement("p");
    detail.className = "inventory-detail";
    detail.textContent =
      `${row.width}×${row.height} · ${formatBytes(row.file_size_bytes)} · ${formatInventoryDate(row.created_at)}`;

    body.append(meta, name, detail);
    card.append(imageWrap, deleteButton, body);
    inventoryGrid.append(card);
  }
}

async function refreshInventory({ quiet = false } = {}) {
  if (inventoryBusy || !currentSession) return;

  inventoryBusy = true;
  inventoryRefreshButton.disabled = true;

  if (!quiet) setInventoryStatus("Ładowanie biblioteki…");

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    inventoryRows = [...await listGameImages({ session: currentSession })];
    renderInventory();
    setInventoryStatus(`${inventoryRows.length} obrazów w bibliotece.`);
  } catch (error) {
    if (
      error instanceof AdminContentError &&
      (error.code === "CONTENT_SESSION_MISSING" || error.status === 401)
    ) {
      clearAdminSession();
      showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
      return;
    }

    setInventoryStatus(
      error instanceof Error ? error.message : "Nie udało się odświeżyć biblioteki.",
      { error: true }
    );
  } finally {
    inventoryBusy = false;
    inventoryRefreshButton.disabled = false;
  }
}

async function handleDelete(imageId) {
  if (deletingIds.has(imageId) || uploadBusy) return;

  const image = inventoryRows.find((row) => row.id === imageId);
  if (!image) return;

  const accepted = window.confirm(
    `Usunąć "${image.original_filename}" z kategorii ${image.content_class.toUpperCase()}?\n\nPlik AVIF i rekord metadata zostaną usunięte.`
  );
  if (!accepted) return;

  deletingIds.add(imageId);
  renderInventory();
  setInventoryStatus(`Usuwanie ${image.original_filename}…`);

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    await deleteGameImage({
      session: currentSession,
      image
    });

    inventoryRows = inventoryRows.filter((row) => row.id !== imageId);
    setInventoryStatus(`Usunięto ${image.original_filename}.`);
  } catch (error) {
    setInventoryStatus(
      error instanceof Error ? error.message : "Nie udało się usunąć obrazu.",
      { error: true }
    );
  } finally {
    deletingIds.delete(imageId);
    renderInventory();
    await refreshInventory({ quiet: true });
    await refreshMigration({ quiet: true });
  }
}


function setMigrationStatus(message = "", { error = false } = {}) {
  migrationStatus.textContent = message;
  migrationStatus.classList.toggle("is-error", Boolean(error));
}

function setMigrationBusy(value) {
  migrationBusy = Boolean(value);
  migrationRefreshButton.disabled = migrationBusy;
  migrationCutoverButton.disabled =
    migrationBusy || migrationSnapshot?.ready_for_cutover !== true;
  migrationRollbackButton.disabled = migrationBusy;
}

function appendMigrationCheck(label, passed) {
  const row = document.createElement("p");
  row.className = "migration-check";
  row.classList.add(passed ? "is-pass" : "is-fail");
  row.textContent = `${passed ? "✓" : "×"} ${label}`;
  migrationChecks.append(row);
}

function renderMigration() {
  migrationTargetTotal.textContent = migrationTarget ? String(migrationTarget.total) : "—";
  migrationTargetAi.textContent = migrationTarget ? String(migrationTarget.ai) : "—";
  migrationTargetHuman.textContent = migrationTarget ? String(migrationTarget.human) : "—";

  const metadata = migrationSnapshot?.metadata;
  const storage = migrationSnapshot?.storage;
  const integrity = migrationSnapshot?.integrity;
  const runtime = migrationSnapshot?.runtime;

  migrationDbTotal.textContent = metadata ? String(metadata.total) : "—";
  migrationDbAi.textContent = metadata ? String(metadata.ai) : "—";
  migrationDbHuman.textContent = metadata ? String(metadata.human) : "—";
  migrationDbActive.textContent = metadata ? String(metadata.active) : "—";

  migrationChecks.replaceChildren();

  if (migrationTarget && migrationSnapshot) {
    appendMigrationCheck(
      `Metadata: ${metadata.total}/${migrationTarget.total}`,
      metadata.total === migrationTarget.total
    );
    appendMigrationCheck(
      `AI: ${metadata.ai}/${migrationTarget.ai}`,
      metadata.ai === migrationTarget.ai
    );
    appendMigrationCheck(
      `HUMAN: ${metadata.human}/${migrationTarget.human}`,
      metadata.human === migrationTarget.human
    );
    appendMigrationCheck(
      `Storage: ${storage.total}/${migrationTarget.total}`,
      storage.total === migrationTarget.total
    );
    appendMigrationCheck(
      "Brak brakujących plików z manifestu repo",
      migrationSnapshot.identity?.missing_expected === 0
    );
    appendMigrationCheck(
      "Brak dodatkowych rekordów spoza manifestu repo",
      migrationSnapshot.identity?.unexpected_metadata === 0
    );
    appendMigrationCheck(
      "Klasy AI/HUMAN zgodne z manifestem",
      migrationSnapshot.identity?.class_mismatch === 0
    );
    appendMigrationCheck(
      "Brak metadata bez pliku Storage",
      integrity.metadata_missing_storage === 0
    );
    appendMigrationCheck(
      "Brak osieroconych plików Storage",
      integrity.storage_orphans === 0
    );
  }

  const live = runtime?.external_live === true;
  uploadModeBadge.textContent = live ? "PRODUKCJA · AKTYWNE" : "STAGING · NIEAKTYWNE";
  uploadModeBadge.classList.toggle("is-live", live);
  migrationMode.classList.toggle("is-ready", !live && migrationSnapshot?.ready_for_cutover === true);
  migrationMode.classList.toggle("is-live", live);

  if (live) {
    migrationMode.textContent = "SUPABASE LIVE";
  } else if (migrationSnapshot?.ready_for_cutover === true) {
    migrationMode.textContent = "GOTOWE DO AKTYWACJI";
  } else {
    migrationMode.textContent = "STAGING";
  }

  migrationCutoverButton.classList.toggle("is-hidden", live);
  migrationRollbackButton.classList.toggle("is-hidden", !live);
  migrationCutoverButton.disabled =
    migrationBusy || migrationSnapshot?.ready_for_cutover !== true;
}

async function refreshMigration({ quiet = false } = {}) {
  if (migrationBusy || !currentSession) return;

  migrationBusy = true;
  setMigrationBusy(true);

  if (!quiet) setMigrationStatus("Sprawdzanie manifestu repo i stanu Supabase…");

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    migrationTarget = await fetchRepositoryMigrationTarget();
    migrationSnapshot = await getContentMigrationStatus({
      session: currentSession,
      expectedManifest: migrationTarget.entries
    });

    renderMigration();

    if (migrationSnapshot.runtime?.external_live === true) {
      setMigrationStatus(
        migrationSnapshot.live_matches_expected
          ? `Supabase LIVE · ${migrationSnapshot.metadata.total} aktywnych obrazów.`
          : "Supabase jest LIVE, ale stan nie odpowiada obecnemu manifestowi repo.",
        { error: migrationSnapshot.live_matches_expected !== true }
      );
    } else if (migrationSnapshot.ready_for_cutover === true) {
      setMigrationStatus("Pełna zgodność. Można wykonać kontrolowaną aktywację Supabase.");
    } else {
      setMigrationStatus(
        `Migracja w toku: ${migrationSnapshot.metadata.total}/${migrationTarget.total} metadata · ` +
        `brakujące ${migrationSnapshot.identity?.missing_expected ?? "?"} · ` +
        `dodatkowe ${migrationSnapshot.identity?.unexpected_metadata ?? "?"}.`
      );
    }
  } catch (error) {
    migrationTarget = null;
    migrationSnapshot = null;
    renderMigration();
    setMigrationStatus(
      error instanceof Error ? error.message : "Nie udało się sprawdzić migracji.",
      { error: true }
    );
  } finally {
    migrationBusy = false;
    setMigrationBusy(false);
  }
}

async function handleMigrationCutover() {
  if (
    migrationBusy ||
    !currentSession ||
    !migrationTarget ||
    migrationSnapshot?.ready_for_cutover !== true
  ) return;

  const accepted = window.confirm(
    `Aktywować Supabase jako produkcyjne źródło?\n\n` +
    `RAZEM: ${migrationTarget.total}\n` +
    `AI: ${migrationTarget.ai}\n` +
    `HUMAN: ${migrationTarget.human}\n\n` +
    `Wszystkie zweryfikowane rekordy staną się aktywne jednocześnie.`
  );
  if (!accepted) return;

  migrationBusy = true;
  setMigrationBusy(true);
  setMigrationStatus("Aktywacja Supabase…");

  try {
    migrationSnapshot = await cutoverExternalContent({
      session: currentSession,
      expectedManifest: migrationTarget.entries
    });

    await refreshInventory({ quiet: true });
    renderMigration();

    if (migrationSnapshot.live_matches_expected !== true) {
      throw new Error("Cutover zakończył się bez pełnego potwierdzenia oczekiwanego stanu.");
    }

    setMigrationStatus(
      `Supabase LIVE · ${migrationSnapshot.metadata.total} aktywnych obrazów.`
    );
  } catch (error) {
    setMigrationStatus(
      error instanceof Error ? error.message : "Aktywacja Supabase nie powiodła się.",
      { error: true }
    );
  } finally {
    migrationBusy = false;
    setMigrationBusy(false);
    await refreshMigration({ quiet: true });
  }
}

async function handleMigrationRollback() {
  if (
    migrationBusy ||
    !currentSession ||
    migrationSnapshot?.runtime?.external_live !== true
  ) return;

  const accepted = window.confirm(
    "Przywrócić repository fallback?\n\nWszystkie rekordy Supabase zostaną zdezaktywowane."
  );
  if (!accepted) return;

  migrationBusy = true;
  setMigrationBusy(true);
  setMigrationStatus("Przywracanie fallbacku repo…");

  try {
    await rollbackExternalContentCutover({ session: currentSession });
    await refreshInventory({ quiet: true });
    setMigrationStatus("Fallback repo został przywrócony.");
  } catch (error) {
    setMigrationStatus(
      error instanceof Error ? error.message : "Rollback nie powiódł się.",
      { error: true }
    );
  } finally {
    migrationBusy = false;
    setMigrationBusy(false);
    await refreshMigration({ quiet: true });
  }
}

function showLogin(message = "") {
  currentSession = null;
  inventoryRows = [];
  deletingIds.clear();
  migrationTarget = null;
  migrationSnapshot = null;
  passwordInput.value = "";
  loginStatus.textContent = message;
  setAuthBusy(false);
  setUploadBusy(false);
  renderInventory();
  renderMigration();
  showOnly(loginView);
}

function showAuthorized(session) {
  currentSession = session;
  adminEmail.textContent = session.user?.email || "Administrator";
  loginStatus.textContent = "";
  setAuthBusy(false);
  showOnly(authorizedView);
}

async function establishAuthorizedSession(session) {
  const authorized = await authorizeAdminSession({ session });
  saveAdminSession(authorized);
  showAuthorized(authorized);
  void refreshInventory();
  void refreshMigration();
  return authorized;
}

function createQueueItem(file) {
  const item = document.createElement("article");
  item.className = "queue-item";
  item.dataset.state = "working";

  const preview = document.createElement("img");
  preview.className = "queue-thumb";
  preview.alt = "";
  preview.decoding = "async";

  const previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  preview.addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });
  preview.addEventListener("error", () => URL.revokeObjectURL(previewUrl), { once: true });

  const main = document.createElement("div");
  main.className = "queue-main";

  const name = document.createElement("p");
  name.className = "queue-name";
  name.textContent = file.name;

  const detail = document.createElement("p");
  detail.className = "queue-detail";
  detail.textContent = `${formatBytes(file.size)} · przygotowanie SHA-256`;

  main.append(name, detail);

  const state = document.createElement("div");
  state.className = "queue-state";
  state.textContent = "START";

  item.append(preview, main, state);
  uploadQueue.prepend(item);

  return {
    item,
    detail,
    state,
    set(status, detailText, itemState = "working") {
      item.dataset.state = itemState;
      state.textContent = status;
      detail.textContent = detailText;
    }
  };
}

function updateQueueSummary(total) {
  queueHeader.classList.remove("is-hidden");
  queueSummary.textContent = `${completedCount} zapisanych · ${failedCount} błędów · ${total} w partii`;
}

async function processFile(file, contentClass, queueItem) {
  queueItem.set("HASH", `${formatBytes(file.size)} · SHA-256 + kontrola duplikatu`);

  const sourceInspection = await inspectSourceFile(file);

await assertImageHashAvailable({
  session: currentSession,
  field: "source_sha256",
  hash: sourceInspection.sha256,
  requestedClass: contentClass
});

queueItem.set("AVIF",
 `${formatBytes(file.size)} · dekodowanie + konwersja`);

  const prepared = await convertSourceFileToAvif(file, { sourceInspection });

  queueItem.set(
    "UPLOAD",
    `${prepared.output.width}×${prepared.output.height} · ${formatBytes(prepared.source.size)} → ${formatBytes(prepared.output.size)}`
  );

  const result = await registerPreparedImage({
    session: currentSession,
    contentClass,
    prepared
  });

  const publicationState = result.row?.is_active ? "aktywny" : "nieaktywny";

  queueItem.set(
    "GOTOWE",
    `${contentClass.toUpperCase()} · ${formatBytes(prepared.output.size)} · ${result.storagePath} · ${publicationState}`,
    "done"
  );
}

async function handleFiles(fileList) {
  if (uploadBusy) return;

  const files = [...(fileList || [])].filter((file) => file && file.size > 0);
  if (!files.length) return;

  const contentClass = selectedContentClass();
  if (!contentClass) {
    window.alert("Najpierw wybierz kategorię AI albo HUMAN.");
    fileInput.value = "";
    return;
  }

  setUploadBusy(true);
  completedCount = 0;
  failedCount = 0;
  updateQueueSummary(files.length);

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    for (const file of files) {
      const queueItem = createQueueItem(file);

      try {
        await processFile(file, contentClass, queueItem);
        completedCount += 1;
      } catch (error) {
        failedCount += 1;

if (isDuplicateError(error)) {
  queueItem.set("DUPLIKAT", messageForUploadError(error), "duplicate");
} else {
  queueItem.set("BŁĄD", messageForUploadError(error), "error");
}

        if (
          error instanceof AdminContentError &&
          (error.code === "CONTENT_SESSION_MISSING" || error.status === 401)
        ) {
          clearAdminSession();
          showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
          return;
        }
      }

      updateQueueSummary(files.length);
    }
  } finally {
    setUploadBusy(false);
    fileInput.value = "";
    updateQueueSummary(files.length);

    if (completedCount > 0 && currentSession) {
      await refreshInventory({ quiet: true });
      await refreshMigration({ quiet: true });
    }
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (authBusy) return;

  setAuthBusy(true);
  loginStatus.textContent = "Logowanie…";

  let signedInSession = null;

  try {
    signedInSession = await signInWithPassword({
      email: emailInput.value,
      password: passwordInput.value
    });

    await establishAuthorizedSession(signedInSession);
  } catch (error) {
    clearAdminSession();

    if (signedInSession) {
      try {
        await signOutAdmin({ session: signedInSession });
      } catch {
        // Local session is cleared regardless of a remote logout failure.
      }
    }

    showLogin(messageForAuthError(error));
  }
});

logoutButton.addEventListener("click", async () => {
  if (authBusy || uploadBusy) return;

  const session = currentSession;
  setAuthBusy(true);

  try {
    if (session) await signOutAdmin({ session });
  } catch {
    // Signing out locally is authoritative for this tab even if remote revoke fails.
  } finally {
    clearAdminSession();
    showLogin();
  }
});

dropZone.addEventListener("click", () => {
  if (!uploadBusy) fileInput.click();
});

fileInput.addEventListener("change", () => handleFiles(fileInput.files));

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!uploadBusy) dropZone.classList.add("is-dragover");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove("is-dragover");
  });
}

dropZone.addEventListener("drop", (event) => {
  if (!uploadBusy) handleFiles(event.dataTransfer?.files);
});


inventoryRefreshButton.addEventListener("click", () => {
  void refreshInventory();
});

for (const button of inventoryFilterButtons) {
  button.addEventListener("click", () => {
    inventoryFilter = button.dataset.filter || "all";
    renderInventory();
  });
}

inventoryGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  void handleDelete(button.dataset.deleteId);
});


migrationRefreshButton.addEventListener("click", () => {
  void refreshMigration();
});

migrationCutoverButton.addEventListener("click", () => {
  void handleMigrationCutover();
});

migrationRollbackButton.addEventListener("click", () => {
  void handleMigrationRollback();
});

async function bootstrap() {
  const saved = loadAdminSession();

  if (!saved) {
    showLogin();
    return;
  }

  setAuthBusy(true);
  showOnly(bootView);

  try {
    await establishAuthorizedSession(saved);
  } catch {
    clearAdminSession();
    showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
  }
}

bootstrap();
