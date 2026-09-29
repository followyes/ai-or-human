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
  findImageByHash,
  registerPreparedImage
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

let currentSession = null;
let authBusy = false;
let uploadBusy = false;
let completedCount = 0;
let failedCount = 0;

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

function showLogin(message = "") {
  currentSession = null;
  passwordInput.value = "";
  loginStatus.textContent = message;
  setAuthBusy(false);
  setUploadBusy(false);
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
  const sourceDuplicate = await findImageByHash({
    session: currentSession,
    field: "source_sha256",
    hash: sourceInspection.sha256
  });

  if (sourceDuplicate) {
    throw new AdminContentError(
      "SOURCE_DUPLICATE",
      `Ten obraz już istnieje w kategorii ${sourceDuplicate.content_class.toUpperCase()}.`,
      { details: sourceDuplicate }
    );
  }

  queueItem.set("AVIF", `${formatBytes(file.size)} · dekodowanie + konwersja`);

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

  queueItem.set(
    "GOTOWE",
    `${contentClass.toUpperCase()} · ${formatBytes(prepared.output.size)} · ${result.storagePath} · nieaktywny`,
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
        queueItem.set("BŁĄD", messageForUploadError(error), "error");

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
