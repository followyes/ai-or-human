import {
  AdminAuthError,
  authorizeAdminSession,
  ensureFreshAdminSession,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  signInWithPassword,
  signOutAdmin
} from "../js/admin-auth.js";
import {
  AdminContentError,
  deleteGameImage,
  findImageByHash,
  listGameImages,
  registerPreparedImage
} from "../js/admin-content.js";
import {
  AvifConversionError,
  convertSourceFileToAvif,
  formatBytes,
  inspectSourceFile
} from "../js/avif-converter.js";
import {
  promoteQueueItem,
  runSequentialUploadBatch,
  summarizeUploadBatch
} from "../js/upload-batch.js";

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

const inventoryRefreshButton = document.querySelector("#inventory-refresh");
const inventoryStatus = document.querySelector("#inventory-status");
const inventoryGrid = document.querySelector("#inventory-grid");
const inventoryFilterButtons = [...document.querySelectorAll("[data-filter]")];
const countTotal = document.querySelector("#count-total");
const countAi = document.querySelector("#count-ai");
const countHuman = document.querySelector("#count-human");
const countActive = document.querySelector("#count-active");


let currentSession = null;
let authBusy = false;
let uploadBusy = false;
let completedCount = 0;
let duplicateCount = 0;
let failedCount = 0;

let inventoryRows = [];
let inventoryFilter = "all";
let inventoryBusy = false;
const deletingIds = new Set();



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

  if (error instanceof AdminAuthError) {
    if (error.code === "ADMIN_FORBIDDEN") return "Konto utraciło uprawnienia administratora.";
    return "Sesja administratora wymaga ponownego logowania.";
  }

  if (error instanceof AdminContentError) {
    if (error.code === "SOURCE_DUPLICATE" || error.code === "AVIF_DUPLICATE") return error.message;
    if (error.code === "23505") return "Ten obraz już istnieje w bazie.";
    if (error.code === "CONTENT_SESSION_MISSING" || error.status === 401 || error.status === 403) return "Sesja administratora wygasła.";
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
  }
}


function showLogin(message = "") {
  currentSession = null;
  inventoryRows = [];
  deletingIds.clear();
  passwordInput.value = "";
  loginStatus.textContent = message;
  setAuthBusy(false);
  setUploadBusy(false);
  renderInventory();
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
  return authorized;
}

function queueFileLabel(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  const extension = name.includes(".") ? name.split(".").pop().toUpperCase() : "IMG";
  return extension && extension.length <= 5 ? extension : "IMG";
}

function createQueueItem(file) {
  const item = document.createElement("article");
  item.className = "queue-item";
  item.dataset.state = "pending";

  // Keep pending rows lightweight. Creating 150 object URLs / decoded previews at
  // once would defeat the sequential-memory contract of the uploader.
  const preview = document.createElement("div");
  preview.className = "queue-thumb";
  preview.setAttribute("aria-hidden", "true");
  preview.textContent = queueFileLabel(file);

  const main = document.createElement("div");
  main.className = "queue-main";

  const name = document.createElement("p");
  name.className = "queue-name";
  name.textContent = file.name;

  const detail = document.createElement("p");
  detail.className = "queue-detail";
  detail.textContent = `${formatBytes(file.size)} · czeka w kolejce`;

  main.append(name, detail);

  const state = document.createElement("div");
  state.className = "queue-state";
  state.textContent = "OCZEKUJE";

  item.append(preview, main, state);
  uploadQueue.append(item);

  return {
    item,
    detail,
    state,
    set(status, detailText, itemState = "working") {
      item.dataset.state = itemState;
      state.textContent = status;
      detail.textContent = detailText;
    },
    promoteToTop() {
      promoteQueueItem(uploadQueue, item);
    }
  };
}

function updateQueueSummary(total) {
  queueHeader.classList.remove("is-hidden");
  const summary = summarizeUploadBatch(total, {
    completed: completedCount,
    duplicates: duplicateCount,
    failed: failedCount
  });
  queueSummary.textContent =
    `${summary.completed} gotowe · ${summary.duplicates} duplikatów · ${summary.failed} błędów · ` +
    `${summary.waiting} oczekuje · ${summary.total} w partii`;
}

function duplicateErrorFromExisting(existing, requestedClass) {
  const existingClass = existing?.content_class?.toUpperCase?.() || "INNEJ KATEGORII";
  const requested = requestedClass?.toUpperCase?.() || "WYBRANEJ KATEGORII";
  const filename = existing?.original_filename ? ` (${existing.original_filename})` : "";

  if (existing?.content_class === requestedClass) {
    return new AdminContentError(
      "SOURCE_DUPLICATE",
      `Ten obraz już istnieje w kategorii ${existingClass}${filename}.`,
      { details: existing }
    );
  }

  return new AdminContentError(
    "SOURCE_DUPLICATE",
    `Ten sam obraz jest już przypisany do ${existingClass}${filename}. ` +
      `Usuń go z ${existingClass}, jeśli chcesz dodać go jako ${requested}.`,
    { details: existing }
  );
}

function isSessionUploadError(error) {
  if (error instanceof AdminAuthError) return true;

  return error instanceof AdminContentError &&
    (error.code === "CONTENT_SESSION_MISSING" || error.status === 401 || error.status === 403);
}


async function refreshCurrentSessionForUpload() {
  const refreshed = await ensureFreshAdminSession({
    session: currentSession,
    marginSeconds: 180
  });

  if (refreshed !== currentSession) {
    currentSession = refreshed;
    saveAdminSession(currentSession);
  }

  return currentSession;
}

async function processFile(file, contentClass, queueItem) {
  await refreshCurrentSessionForUpload();

  queueItem.set("HASH", `${formatBytes(file.size)} · SHA-256 + kontrola duplikatu`);

  const sourceInspection = await inspectSourceFile(file);
  const existingSource = await findImageByHash({
    session: currentSession,
    field: "source_sha256",
    hash: sourceInspection.sha256
  });

  if (existingSource) {
    throw duplicateErrorFromExisting(existingSource, contentClass);
  }

  const passthrough = sourceInspection.mimeType === "image/avif";
  queueItem.set(
    passthrough ? "AVIF 1:1" : "AVIF",
    passthrough
      ? `${formatBytes(file.size)} · walidacja bez rekompresji`
      : `${formatBytes(file.size)} · dekodowanie + konwersja`
  );

  const prepared = await convertSourceFileToAvif(file, { sourceInspection });

  queueItem.set(
    "UPLOAD",
    prepared.output.passthrough
      ? `${prepared.output.width}×${prepared.output.height} · ${formatBytes(prepared.output.size)} · bez rekompresji`
      : `${prepared.output.width}×${prepared.output.height} · ${formatBytes(prepared.source.size)} → ${formatBytes(prepared.output.size)}`
  );

  const result = await registerPreparedImage({
    session: currentSession,
    contentClass,
    prepared,
    sourceHashPreflightDone: true
  });

  const publicationState = result.row?.is_active ? "aktywny" : "nieaktywny";

  queueItem.set(
    "GOTOWE",
    `${contentClass.toUpperCase()} · ${formatBytes(prepared.output.size)} · ${result.storagePath} · ${publicationState}`,
    "done"
  );

  return Object.freeze({ kind: "uploaded", row: result.row });
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

  // A batch owns one bounded queue. Old rows are intentionally removed so a
  // second 77-file batch does not leave 227 historical rows in the page DOM.
  uploadQueue.replaceChildren();
  uploadQueue.scrollTop = 0;

  completedCount = 0;
  duplicateCount = 0;
  failedCount = 0;

  // Materialize every lightweight row before any hashing/network work starts.
  // This makes a 150-file drop visible immediately while processing remains
  // strictly sequential.
  const queueEntries = files.map((file) => ({
    file,
    queueItem: createQueueItem(file)
  }));

  updateQueueSummary(files.length);
  setUploadBusy(true);

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    const batchResult = await runSequentialUploadBatch(queueEntries, {
      processEntry: ({ file, queueItem }) => processFile(file, contentClass, queueItem),
      onSuccess: () => {
        completedCount += 1;
        updateQueueSummary(files.length);
      },
      onFailure: ({ entry, error }) => {
        if (isDuplicateError(error)) {
          duplicateCount += 1;
          entry.queueItem.set("DUPLIKAT", messageForUploadError(error), "duplicate");
        } else {
          failedCount += 1;
          entry.queueItem.set("BŁĄD", messageForUploadError(error), "error");
          entry.queueItem.promoteToTop();
        }
        updateQueueSummary(files.length);
      },
      shouldAbort: (error) => isSessionUploadError(error)
    });

    if (batchResult.aborted) {
      clearAdminSession();
      showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
      return;
    }
  } finally {
    setUploadBusy(false);
    fileInput.value = "";
    updateQueueSummary(files.length);

    if (completedCount > 0 && currentSession) {
      await refreshInventory({ quiet: true });
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
