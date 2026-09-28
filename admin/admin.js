import {
  AdminAuthError,
  authorizeAdminSession,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  signInWithPassword,
  signOutAdmin
} from "../js/admin-auth.js";

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

let currentSession = null;
let busy = false;

function showOnly(view) {
  for (const node of [loginView, authorizedView, bootView]) {
    node.classList.toggle("is-hidden", node !== view);
  }
}

function setBusy(value) {
  busy = Boolean(value);
  loginButton.disabled = busy;
  logoutButton.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
}

function messageForError(error) {
  if (!(error instanceof AdminAuthError)) {
    return "Nie udało się zalogować. Spróbuj ponownie.";
  }

  if (error.code === "email_not_confirmed") {
    return "Adres e-mail tego konta nie został jeszcze potwierdzony.";
  }

  if (
    error.code === "invalid_credentials" ||
    error.code === "INVALID_CREDENTIALS"
  ) {
    return "Nieprawidłowy e-mail lub hasło.";
  }

  if (error.code === "ADMIN_FORBIDDEN") {
    return "To konto nie ma uprawnień administratora.";
  }

  if (error.code === "AUTH_REQUEST_TIMEOUT") {
    return "Supabase nie odpowiedział na czas. Spróbuj ponownie.";
  }

  if (error.code === "AUTH_NETWORK_FAILED") {
    return "Nie udało się połączyć z Supabase.";
  }

  return "Nie udało się zalogować. Spróbuj ponownie.";
}

function showLogin(message = "") {
  currentSession = null;
  passwordInput.value = "";
  loginStatus.textContent = message;
  setBusy(false);
  showOnly(loginView);
}

function showAuthorized(session) {
  currentSession = session;
  adminEmail.textContent = session.user?.email || "Administrator";
  loginStatus.textContent = "";
  setBusy(false);
  showOnly(authorizedView);
}

async function establishAuthorizedSession(session) {
  const authorized = await authorizeAdminSession({ session });
  saveAdminSession(authorized);
  showAuthorized(authorized);
  return authorized;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  setBusy(true);
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

    showLogin(messageForError(error));
  }
});

logoutButton.addEventListener("click", async () => {
  if (busy) return;

  const session = currentSession;
  setBusy(true);

  try {
    if (session) {
      await signOutAdmin({ session });
    }
  } catch {
    // Signing out locally is authoritative for this tab even if remote revoke fails.
  } finally {
    clearAdminSession();
    showLogin();
  }
});

async function bootstrap() {
  const saved = loadAdminSession();

  if (!saved) {
    showLogin();
    return;
  }

  setBusy(true);
  showOnly(bootView);

  try {
    await establishAuthorizedSession(saved);
  } catch {
    clearAdminSession();
    showLogin("Sesja administratora wygasła. Zaloguj się ponownie.");
  }
}

bootstrap();
