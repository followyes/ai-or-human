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
  formatBytes
} from "../js/avif-converter.js";
import {
  promoteQueueItem,
  runPipelinedUploadBatch,
  summarizeUploadBatch
} from "../js/upload-batch.js";
import { DeleteDrainCoordinator } from "../js/delete-queue.js";
import { UploadPreparationWorkerClient } from "../js/upload-worker-client.js";

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

const inventorySelectButton = document.querySelector("#inventory-select");
const inventorySelectionActions = document.querySelector("#inventory-selection-actions");
const inventorySelectAllButton = document.querySelector("#inventory-select-all");
const inventorySelectionCancelButton = document.querySelector("#inventory-selection-cancel");
const inventoryDeleteSelectedButton = document.querySelector("#inventory-delete-selected");
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
let deleteBusy = false;
let completedCount = 0;
let duplicateCount = 0;
let failedCount = 0;

let inventoryRows = [];
let inventoryFilter = "all";
let inventoryBusy = false;
let storageUsage = null;
let storageUsagePromise = null;
let selectionMode = false;
const selectedImageIds = new Set();
const deletingIds = new Set();
let singleDeleteStats = createSingleDeleteStats();
let sessionRefreshPromise = null;
const uploadPreparationWorker = new UploadPreparationWorkerClient();


const BOOT_REVEAL_DELAY_MS = 320;
const VIEW_NODES = Object.freeze({
  login: loginView,
  authorized: authorizedView,
  boot: bootView
});

function createSingleDeleteStats() {
  return {
    deletedCount: 0,
    failedCount: 0,
    reconcileFailed: false
  };
}

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

function uploadEntryReady() {
  return Boolean(selectedContentClass()) && !uploadBusy && !deleteBusy && !inventoryBusy;
}

function syncBusyControls() {
  loginButton.disabled = authBusy;
  emailInput.disabled = authBusy;
  passwordInput.disabled = authBusy;

  const contentMutationBusy = uploadBusy || deleteBusy;
  const contentInteractionBusy = contentMutationBusy || inventoryBusy;
  const categorySelected = Boolean(selectedContentClass());
  dropZone.disabled = contentInteractionBusy;
  dropZone.classList.toggle("is-category-locked", !categorySelected);
  dropZone.setAttribute("aria-disabled", contentInteractionBusy || !categorySelected ? "true" : "false");
  fileInput.disabled = contentInteractionBusy || !categorySelected;
  for (const input of classInputs) input.disabled = contentInteractionBusy;

  logoutButton.disabled = authBusy || contentInteractionBusy;
  inventorySelectButton.disabled = contentInteractionBusy;
  inventorySelectAllButton.disabled = contentInteractionBusy || filteredInventoryRows().length === 0;
  inventorySelectionCancelButton.disabled = contentMutationBusy;
  inventoryDeleteSelectedButton.disabled =
    contentInteractionBusy || selectedImageIds.size === 0;
  for (const button of inventoryFilterButtons) button.disabled = deleteBusy || inventoryBusy;
  for (const button of inventoryGrid.querySelectorAll("[data-delete-id]")) {
    button.disabled = deletingIds.has(button.dataset.deleteId) || uploadBusy || inventoryBusy;
  }
}

function setAuthBusy(value) {
  authBusy = Boolean(value);
  syncBusyControls();
}

function setUploadBusy(value) {
  uploadBusy = Boolean(value);
  syncBusyControls();
}

function setDeleteBusy(value) {
  deleteBusy = Boolean(value);
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

function syncSelectionControls() {
  inventorySelectButton.classList.toggle("is-hidden", selectionMode);
  inventorySelectionActions.classList.toggle("is-hidden", !selectionMode);
  inventoryDeleteSelectedButton.textContent = `Usuń zaznaczone (${selectedImageIds.size})`;
  syncBusyControls();
}

function clearInventorySelection({ exitMode = false } = {}) {
  selectedImageIds.clear();
  if (exitMode) selectionMode = false;
  syncSelectionControls();
}

function toggleInventorySelection(imageId) {
  if (!selectionMode || deleteBusy || inventoryBusy) return;

  if (selectedImageIds.has(imageId)) selectedImageIds.delete(imageId);
  else selectedImageIds.add(imageId);

  renderInventory();
}

function setCardDeletingState(imageId, value) {
  const card = [...inventoryGrid.querySelectorAll(".inventory-card")]
    .find((node) => node.dataset.imageId === imageId);
  if (!card) return;
  card.classList.toggle("is-deleting", Boolean(value));
}

function isSessionMutationError(error) {
  if (error instanceof AdminAuthError) return true;
  return error instanceof AdminContentError &&
    (error.code === "CONTENT_SESSION_MISSING" || error.status === 401 || error.status === 403);
}

function setInventoryStatus(message = "", { error = false } = {}) {
  inventoryStatus.textContent = message;
  inventoryStatus.classList.toggle("is-error", Boolean(error));
}

function createDeleteMarkerIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("delete-marker-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const circle = document.createElementNS(namespace, "circle");
  circle.classList.add("delete-marker-circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");

  const cross = document.createElementNS(namespace, "path");
  cross.classList.add("delete-marker-x");
  cross.setAttribute("d", "M8.5 8.5 15.5 15.5 M15.5 8.5 8.5 15.5");

  svg.append(circle, cross);
  return svg;
}

function renderInventory() {
  updateInventoryStats();
  inventoryGrid.replaceChildren();
  inventoryGrid.classList.toggle("is-selection-mode", selectionMode);

  if (selectionMode) {
    inventoryGrid.setAttribute("role", "listbox");
    inventoryGrid.setAttribute("aria-multiselectable", "true");
  } else {
    inventoryGrid.removeAttribute("role");
    inventoryGrid.removeAttribute("aria-multiselectable");
  }

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
    syncSelectionControls();
    return;
  }

  for (const row of rows) {
    const card = document.createElement("article");
    const selected = selectedImageIds.has(row.id);
    card.className = "inventory-card";
    card.dataset.imageId = row.id;
    card.classList.toggle("is-deleting", deletingIds.has(row.id));
    card.classList.toggle("is-selection-mode", selectionMode);
    card.classList.toggle("is-selected", selected);

    if (selectionMode) {
      card.tabIndex = 0;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", selected ? "true" : "false");
      card.setAttribute("aria-label", `${selected ? "Odznacz" : "Zaznacz"} ${row.original_filename || "obraz"}`);
    }

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

    const actionButton = document.createElement("button");
    actionButton.type = "button";

    if (selectionMode) {
      actionButton.className = "inventory-select-control";
      actionButton.dataset.selectId = row.id;
      if (selected) actionButton.append(createDeleteMarkerIcon());
      actionButton.setAttribute("aria-label", `${selected ? "Odznacz" : "Zaznacz"} ${row.original_filename || "obraz"}`);
      actionButton.setAttribute("aria-pressed", selected ? "true" : "false");
      actionButton.disabled = deleteBusy;
    } else {
      actionButton.className = "inventory-delete";
      actionButton.append(createDeleteMarkerIcon());
      actionButton.dataset.deleteId = row.id;
      actionButton.setAttribute("aria-label", `Usuń ${row.original_filename || "obraz"}`);
      actionButton.disabled = deletingIds.has(row.id) || uploadBusy || inventoryBusy;
    }

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
    card.append(imageWrap, actionButton, body);
    inventoryGrid.append(card);
  }

  syncSelectionControls();
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

async function reconcileSingleDeleteAuthority() {
  if (!currentSession) return false;

  currentSession = await authorizeAdminSession({ session: currentSession });
  saveAdminSession(currentSession);

  inventoryRows = [...await listGameImages({ session: currentSession })];
  renderInventory();

  if (currentSession) await refreshStorageUsage({ force: true });
  return true;
}

async function processSingleDeleteItem(image) {
  await refreshCurrentSessionForMutation();
  await deleteGameImage({
    session: currentSession,
    image
  });
}

const singleDeleteCoordinator = new DeleteDrainCoordinator({
  keyOf: (image) => image.id,
  processItem: processSingleDeleteItem,
  reconcile: reconcileSingleDeleteAuthority,
  isFatalError: isSessionMutationError,
  onWorkerStart: () => {
    singleDeleteStats = createSingleDeleteStats();
    setDeleteBusy(true);
  },
  onPhaseChange: (phase) => {
    if (phase === "reconciling" && deletingIds.size === 0) {
      setInventoryStatus("Synchronizacja biblioteki…");
    }
  },
  onItemStart: (image, { pendingCount }) => {
    setInventoryStatus(
      pendingCount > 0
        ? `Usuwanie ${image.original_filename}… · ${pendingCount} w kolejce`
        : `Usuwanie ${image.original_filename}…`
    );
  },
  onItemSuccess: (image) => {
    singleDeleteStats.deletedCount += 1;
    selectedImageIds.delete(image.id);
    deletingIds.delete(image.id);
    inventoryRows = inventoryRows.filter((row) => row.id !== image.id);
    renderInventory();
  },
  onItemFailure: (image) => {
    singleDeleteStats.failedCount += 1;
    deletingIds.delete(image.id);
    renderInventory();
  },
  onReconcileFailure: () => {
    singleDeleteStats.reconcileFailed = true;
  },
  onFatal: () => {
    deletingIds.clear();
    clearAdminSession();
    showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
  },
  onWorkerIdle: ({ fatal }) => {
    if (fatal) return;

    setDeleteBusy(false);
    renderInventory();

    const { deletedCount, failedCount, reconcileFailed } = singleDeleteStats;
    if (failedCount > 0 || reconcileFailed) {
      const parts = [];
      if (deletedCount > 0) parts.push(`Usunięto ${deletedCount}.`);
      if (failedCount > 0) parts.push(`Nie udało się usunąć ${failedCount}.`);
      if (reconcileFailed) parts.push("Nie udało się odświeżyć biblioteki.");
      setInventoryStatus(parts.join(" "), { error: true });
    } else if (deletedCount > 0) {
      setInventoryStatus(`Usunięto ${deletedCount} ${deletedCount === 1 ? "obraz" : "obrazów"}.`);
    }
  }
});

async function handleDelete(imageId) {
  if (selectionMode || deletingIds.has(imageId) || uploadBusy || inventoryBusy) return;

  const image = inventoryRows.find((row) => row.id === imageId);
  if (!image) return;

  const accepted = window.confirm(
    `Usunąć "${image.original_filename}" z kategorii ${image.content_class.toUpperCase()}?\n\nObraz zostanie trwale usunięty z biblioteki.`
  );
  if (!accepted) return;

  const workerWasActive = deleteBusy;
  deletingIds.add(imageId);
  const queued = singleDeleteCoordinator.enqueue(image);

  if (!queued) {
    deletingIds.delete(imageId);
    renderInventory();
    return;
  }

  renderInventory();

  if (workerWasActive) {
    setInventoryStatus(`Dodano ${image.original_filename} do kolejki usuwania.`);
  }
}

async function handleBulkDelete() {
  if (uploadBusy || deleteBusy || inventoryBusy || selectedImageIds.size === 0) return;

  const selectedRows = inventoryRows.filter((row) => selectedImageIds.has(row.id));
  if (!selectedRows.length) {
    clearInventorySelection({ exitMode: true });
    renderInventory();
    return;
  }

  const accepted = window.confirm(
    `Usunąć ${selectedRows.length} zaznaczonych obrazów?\n\nObrazy zostaną trwale usunięte z biblioteki.`
  );
  if (!accepted) return;

  setDeleteBusy(true);
  let deletedCount = 0;
  const failedIds = new Set();
  let sessionFailed = false;

  try {
    for (let index = 0; index < selectedRows.length; index += 1) {
      const image = selectedRows[index];
      setInventoryStatus(`Usuwanie ${index + 1}/${selectedRows.length}…`);
      deletingIds.add(image.id);
      setCardDeletingState(image.id, true);

      try {
        await refreshCurrentSessionForMutation();

        await deleteGameImage({
          session: currentSession,
          image
        });

        deletedCount += 1;
        deletingIds.delete(image.id);
        selectedImageIds.delete(image.id);
        inventoryRows = inventoryRows.filter((row) => row.id !== image.id);
        const card = [...inventoryGrid.querySelectorAll(".inventory-card")]
          .find((node) => node.dataset.imageId === image.id);
        card?.remove();
        updateInventoryStats();
        syncSelectionControls();
      } catch (error) {
        deletingIds.delete(image.id);
        setCardDeletingState(image.id, false);

        if (isSessionMutationError(error)) {
          sessionFailed = true;
          break;
        }

        failedIds.add(image.id);
      }
    }

    if (sessionFailed) {
      clearAdminSession();
      showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
      return;
    }

    selectedImageIds.clear();
    for (const imageId of failedIds) selectedImageIds.add(imageId);
    selectionMode = failedIds.size > 0;

    await refreshInventory({ quiet: true, refreshStorage: false });
    if (currentSession) await refreshStorageUsage({ force: true });

    if (failedIds.size > 0) {
      setInventoryStatus(
        `Usunięto ${deletedCount} z ${selectedRows.length}. Nie udało się usunąć ${failedIds.size}.`,
        { error: true }
      );
    } else {
      setInventoryStatus(`Usunięto ${deletedCount} ${deletedCount === 1 ? "obraz" : "obrazów"}.`);
    }
  } finally {
    deletingIds.clear();
    setDeleteBusy(false);
    renderInventory();
  }
}


function showLogin(message = "", { morph = true, focus = true } = {}) {
  currentSession = null;
  inventoryRows = [];
  selectionMode = false;
  selectedImageIds.clear();
  deletingIds.clear();
  deleteBusy = false;
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
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = (async () => {
      const refreshed = await ensureFreshAdminSession({
        session: currentSession,
        marginSeconds: 180
      });

      if (refreshed !== currentSession) {
        currentSession = refreshed;
        saveAdminSession(currentSession);
      }

      return currentSession;
    })();
  }

  const activeRefresh = sessionRefreshPromise;
  try {
    return await activeRefresh;
  } finally {
    if (sessionRefreshPromise === activeRefresh) sessionRefreshPromise = null;
  }
}

async function prepareFile(file, contentClass, queueItem) {
  await refreshCurrentSessionForMutation();

  queueItem.set("HASH", `${formatBytes(file.size)} · SHA-256 + kontrola duplikatu`);

  const sourceInspection = await uploadPreparationWorker.inspect(file);
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

  return uploadPreparationWorker.prepare(file, sourceInspection);
}

async function commitPreparedFile({ prepared, inventoryPreview }, contentClass, queueItem) {
  await refreshCurrentSessionForMutation();

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
  if (uploadBusy || deleteBusy || inventoryBusy) return;

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

    const batchResult = await runPipelinedUploadBatch(queueEntries, {
      prepareEntry: ({ file, queueItem }) => prepareFile(file, contentClass, queueItem),
      commitEntry: ({ entry, prepared }) => commitPreparedFile(prepared, contentClass, entry.queueItem),
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
    // A batch never owns more than one preparation Worker. Terminate it after
    // the bounded prepare/commit pipeline settles so large WASM/canvas heaps
    // cannot remain resident between batches. The next batch recreates it lazily.
    uploadPreparationWorker.terminate();
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
  if (authBusy || uploadBusy || deleteBusy || inventoryBusy) return;

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

for (const input of classInputs) {
  input.addEventListener("change", syncBusyControls);
}

dropZone.addEventListener("click", () => {
  if (uploadEntryReady()) fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (!uploadEntryReady()) {
    fileInput.value = "";
    return;
  }
  handleFiles(fileInput.files);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadEntryReady()) dropZone.classList.add("is-dragover");
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
  if (uploadEntryReady()) handleFiles(event.dataTransfer?.files);
});


inventorySelectButton.addEventListener("click", () => {
  if (uploadBusy || deleteBusy || inventoryBusy) return;
  selectionMode = true;
  selectedImageIds.clear();
  setInventoryStatus();
  renderInventory();
});

inventorySelectAllButton.addEventListener("click", () => {
  if (!selectionMode || uploadBusy || deleteBusy || inventoryBusy) return;
  selectedImageIds.clear();
  for (const row of filteredInventoryRows()) selectedImageIds.add(row.id);
  renderInventory();
});

inventorySelectionCancelButton.addEventListener("click", () => {
  if (deleteBusy) return;
  clearInventorySelection({ exitMode: true });
  setInventoryStatus();
  renderInventory();
});

inventoryDeleteSelectedButton.addEventListener("click", () => {
  void handleBulkDelete();
});

for (const button of inventoryFilterButtons) {
  button.addEventListener("click", () => {
    if (deleteBusy || inventoryBusy) return;
    const nextFilter = button.dataset.filter || "all";
    if (nextFilter !== inventoryFilter) selectedImageIds.clear();
    inventoryFilter = nextFilter;
    renderInventory();
  });
}

inventoryGrid.addEventListener("click", (event) => {
  if (selectionMode) {
    const card = event.target.closest("[data-image-id]");
    if (!card) return;
    toggleInventorySelection(card.dataset.imageId);
    return;
  }

  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  void handleDelete(button.dataset.deleteId);
});

inventoryGrid.addEventListener("keydown", (event) => {
  if (!selectionMode || deleteBusy) return;
  if (event.target?.classList?.contains("inventory-card") && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    toggleInventorySelection(event.target.dataset.imageId);
  }
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
