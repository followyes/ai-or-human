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
  getAdminStorageUsage,
  listGameImages,
  registerPreparedImage
} from "../js/admin-content.js";
import {
  AvifConversionError,
  convertSourceFileToAvif,
  createInventoryPreviewAvif,
  formatBytes,
  inspectSourceFile
} from "../js/avif-converter.js";
import {
  promoteQueueItem,
  runSequentialUploadBatch,
  summarizeUploadBatch
} from "../js/upload-batch.js";

const adminCard = document.querySelector("#admin-card");
const loginView = document.querySelector("#login-view");
const authorizedView = document.querySelector("#authorized-view");
const bootView = document.querySelector("#boot-view");

const form = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const loginStatus = document.querySelector("#login-status");
const logoutButton = document.querySelector("#logout-button");
const loginTitle = document.querySelector("#login-title");
const adminTitle = document.querySelector("#admin-title");

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
const storageUsageValue = document.querySelector("#storage-usage-value");
const storageUsagePercent = document.querySelector("#storage-usage-percent");
const storageRemaining = document.querySelector("#storage-remaining");
const storageMeter = document.querySelector("#storage-meter");
const storageMeterFill = document.querySelector("#storage-meter-fill");


let currentSession = null;
let authBusy = false;
let uploadBusy = false;
let completedCount = 0;
let duplicateCount = 0;
let failedCount = 0;

let inventoryRows = [];
let inventoryFilter = "all";
let inventoryBusy = false;
let storageUsage = null;
let storageUsagePromise = null;
const deletingIds = new Set();


const BOOT_REVEAL_DELAY_MS = 320;
const VIEW_NODES = Object.freeze({
  login: loginView,
  authorized: authorizedView,
  boot: bootView
});

function syncViewAccessibility(viewName) {
  for (const [name, node] of Object.entries(VIEW_NODES)) {
    const bootConcealed = name === "boot" && adminCard.dataset.bootVisible !== "true";
    const active = name === viewName && !bootConcealed;
    node.setAttribute("aria-hidden", active ? "false" : "true");
    node.inert = !active;
  }
}

function releaseShellTransitionSkip() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => adminCard.classList.remove("skip-shell-morph"));
  });
}

function setView(viewName, { morph = true } = {}) {
  if (!VIEW_NODES[viewName]) throw new Error(`Unknown admin view: ${viewName}`);

  if (!morph) {
    adminCard.classList.add("skip-shell-morph");
  }

  adminCard.dataset.view = viewName;
  syncViewAccessibility(viewName);

  if (adminCard.classList.contains("skip-shell-morph")) {
    releaseShellTransitionSkip();
  }
}

function setBootVisible(value) {
  adminCard.dataset.bootVisible = value ? "true" : "false";
  syncViewAccessibility(adminCard.dataset.view || "boot");
}

function focusViewTarget(target) {
  if (!target || typeof target.focus !== "function") return;
  window.requestAnimationFrame(() => {
    target.focus({ preventScroll: true });
  });
}

function syncBusyControls() {
  loginButton.disabled = authBusy;
  emailInput.disabled = authBusy;
  passwordInput.disabled = authBusy;

  const contentMutationBusy = uploadBusy;
  dropZone.disabled = contentMutationBusy;
  for (const input of classInputs) input.disabled = contentMutationBusy;

  logoutButton.disabled = authBusy || contentMutationBusy;
  inventoryRefreshButton.disabled = inventoryBusy || contentMutationBusy;
}

function setAuthBusy(value) {
  authBusy = Boolean(value);
  syncBusyControls();
}

function setUploadBusy(value) {
  uploadBusy = Boolean(value);
  syncBusyControls();
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

function buildStorageUsageState(usedBytes, quotaBytes) {
  const used = Math.max(0, Math.round(Number(usedBytes) || 0));
  const quota = Math.max(1, Math.round(Number(quotaBytes) || 0));
  const remaining = Math.max(quota - used, 0);
  const percentage = (used / quota) * 100;

  return Object.freeze({
    usedBytes: used,
    quotaBytes: quota,
    remainingBytes: remaining,
    usagePercent: percentage
  });
}

function renderStorageUsage() {
  storageMeter.classList.remove("is-warning", "is-critical");

  if (!storageUsage) {
    storageUsageValue.textContent = "—";
    storageUsagePercent.textContent = "—";
    storageRemaining.textContent = "—";
    storageMeterFill.style.width = "0%";
    storageMeter.removeAttribute("aria-valuenow");
    storageMeter.setAttribute("aria-valuetext", "Dane wykorzystania Storage są niedostępne");
    return;
  }

  const percent = Math.max(0, storageUsage.usagePercent);
  const clampedPercent = Math.min(percent, 100);
  const formattedPercent = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(percent);

  storageUsageValue.textContent =
    `${formatBytes(storageUsage.usedBytes)} / ${formatBytes(storageUsage.quotaBytes)}`;
  storageUsagePercent.textContent = `${formattedPercent}%`;
  storageRemaining.textContent =
    storageUsage.remainingBytes > 0
      ? `≈${formatBytes(storageUsage.remainingBytes)} wolne`
      : "Brak wolnego miejsca w limicie";
  storageMeterFill.style.width = `${clampedPercent}%`;
  storageMeter.setAttribute("aria-valuenow", String(Math.round(clampedPercent)));
  storageMeter.setAttribute(
    "aria-valuetext",
    `${formattedPercent}% wykorzystane, ${formatBytes(storageUsage.remainingBytes)} wolne`
  );

  if (percent >= 90) storageMeter.classList.add("is-critical");
  else if (percent >= 70) storageMeter.classList.add("is-warning");
}

function clearStorageUsage() {
  storageUsage = null;
  renderStorageUsage();
}

function applyStorageUsageDelta(bytes) {
  if (!storageUsage) return false;

  const delta = Math.max(0, Math.round(Number(bytes) || 0));
  if (!delta) return false;

  storageUsage = buildStorageUsageState(
    storageUsage.usedBytes + delta,
    storageUsage.quotaBytes
  );
  renderStorageUsage();
  return true;
}

async function refreshStorageUsage({ force = false } = {}) {
  if (!currentSession) {
    clearStorageUsage();
    return false;
  }

  if (storageUsagePromise) {
    await storageUsagePromise;
    if (!force) return Boolean(storageUsage);
  }

  const run = (async () => {
    try {
      const usage = await getAdminStorageUsage({
        session: currentSession
      });
      storageUsage = buildStorageUsageState(usage.usedBytes, usage.quotaBytes);
      renderStorageUsage();
      return true;
    } catch (error) {
      if (
        error instanceof AdminContentError &&
        (error.code === "CONTENT_SESSION_MISSING" || error.status === 401)
      ) {
        clearAdminSession();
        showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
        return false;
      }

      clearStorageUsage();
      return false;
    }
  })();

  storageUsagePromise = run;

  try {
    return await run;
  } finally {
    if (storageUsagePromise === run) storageUsagePromise = null;
  }
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
    image.src = row.thumbnail_public_url || row.public_url;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      if (row.thumbnail_public_url && image.src !== row.public_url) {
        image.src = row.public_url;
        return;
      }
      image.removeAttribute("src");
      image.alt = "Brak podglądu";
    });
    imageWrap.append(image);

    const deleteButton = document.createElement("button");
    deleteButton.className = "inventory-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.dataset.deleteId = row.id;
    deleteButton.setAttribute("aria-label", `Usuń ${row.original_filename || "obraz"}`);
    deleteButton.disabled = deletingIds.has(row.id) || uploadBusy;

    const body = document.createElement("div");
    body.className = "inventory-body";

    const meta = document.createElement("div");
    meta.className = "inventory-meta-row";

    const classBadge = document.createElement("span");
    classBadge.className = "inventory-class";
    classBadge.textContent = row.content_class.toUpperCase();

    meta.append(classBadge);

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

async function refreshInventory({ quiet = false, refreshStorage = true } = {}) {
  if (inventoryBusy || !currentSession) return false;

  inventoryBusy = true;
  syncBusyControls();

  if (!quiet) setInventoryStatus("Ładowanie biblioteki…");

  try {
    currentSession = await authorizeAdminSession({ session: currentSession });
    saveAdminSession(currentSession);

    inventoryRows = [...await listGameImages({ session: currentSession })];
    renderInventory();
    setInventoryStatus();

    if (refreshStorage && currentSession) {
      await refreshStorageUsage({ force: true });
    }

    return true;
  } catch (error) {
    if (
      error instanceof AdminContentError &&
      (error.code === "CONTENT_SESSION_MISSING" || error.status === 401)
    ) {
      clearAdminSession();
      showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
      return false;
    }

    setInventoryStatus(
      error instanceof Error ? error.message : "Nie udało się odświeżyć biblioteki.",
      { error: true }
    );
    return false;
  } finally {
    inventoryBusy = false;
    syncBusyControls();
  }
}

async function handleDelete(imageId) {
  if (deletingIds.has(imageId) || uploadBusy) return;

  const image = inventoryRows.find((row) => row.id === imageId);
  if (!image) return;

  const accepted = window.confirm(
    `Usunąć "${image.original_filename}" z kategorii ${image.content_class.toUpperCase()}?\n\nObraz zostanie trwale usunięty z biblioteki.`
  );
  if (!accepted) return;

  deletingIds.add(imageId);
  syncBusyControls();
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
    syncBusyControls();
    renderInventory();
    await refreshInventory({ quiet: true });
  }
}


function showLogin(message = "", { morph = true, focus = true } = {}) {
  currentSession = null;
  inventoryRows = [];
  deletingIds.clear();
  clearStorageUsage();
  passwordInput.value = "";
  loginStatus.textContent = message;
  setAuthBusy(false);
  setUploadBusy(false);
    renderInventory();
  setBootVisible(false);
  setView("login", { morph });
  if (focus) focusViewTarget(message ? loginTitle : emailInput);
}

function showAuthorized(session, { morph = true, focus = false } = {}) {
  currentSession = session;
  loginStatus.textContent = "";
  setAuthBusy(false);
  setBootVisible(false);
  setView("authorized", { morph });
  if (focus) focusViewTarget(adminTitle);
}

async function establishAuthorizedSession(session, options = {}) {
  const authorized = await authorizeAdminSession({ session });
  saveAdminSession(authorized);
  showAuthorized(authorized, options);
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
    (
      error.code === "CONTENT_SESSION_MISSING" ||
      ((error.status === 401 || error.status === 403) && error.code !== "PUBLIC_AVIF_FETCH_FAILED")
    );
}


async function refreshCurrentSessionForMutation() {
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
  await refreshCurrentSessionForMutation();

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
  const inventoryPreview = await createInventoryPreviewAvif(prepared.output.blob);

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
    inventoryPreview,
    sourceHashPreflightDone: true
  });

  queueItem.set(
    "GOTOWE",
    `${contentClass.toUpperCase()} · ${formatBytes(prepared.output.size)} · ${result.storagePath}`,
    "done"
  );

  return Object.freeze({
    kind: "uploaded",
    row: result.row,
    storageBytesAdded: prepared.output.size + inventoryPreview.blob.size
  });
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

    // Start optimistic file-by-file movement only from an authoritative baseline.
    // A meter failure must never block the uploader; in that case the final
    // reconciliation can recover the UI after the batch.
    if (!storageUsage) {
      await refreshStorageUsage();
    }

    const batchResult = await runSequentialUploadBatch(queueEntries, {
      processEntry: ({ file, queueItem }) => processFile(file, contentClass, queueItem),
      onSuccess: ({ result }) => {
        completedCount += 1;
        applyStorageUsageDelta(result?.storageBytesAdded);
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

    if (currentSession) {
      if (completedCount > 0) {
        await refreshInventory({ quiet: true, refreshStorage: false });
      }
      await refreshStorageUsage({ force: true });
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

    await establishAuthorizedSession(signedInSession, { morph: true, focus: true });
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
    showLogin("", { morph: false, focus: true });
    return;
  }

  setAuthBusy(true);
  setBootVisible(false);
  setView("boot", { morph: false });

  let bootWasRevealed = false;
  const revealTimer = window.setTimeout(() => {
    bootWasRevealed = true;
    setBootVisible(true);
  }, BOOT_REVEAL_DELAY_MS);

  try {
    await establishAuthorizedSession(saved, {
      morph: bootWasRevealed,
      focus: false
    });
  } catch {
    clearAdminSession();
    showLogin("Sesja administratora wygasła. Zaloguj się ponownie.", {
      morph: bootWasRevealed,
      focus: true
    });
  } finally {
    window.clearTimeout(revealTimer);
    setBootVisible(false);
  }
}

bootstrap();
