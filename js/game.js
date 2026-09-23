import { RoundSelector } from "./round-selector.js";
import { RoundPreloader, loadImageIntoElement } from "./image-preloader.js";
import { SwipeController } from "./swipe-controller.js";
import {
  DEFAULT_SESSION_SIZE,
  MIN_SESSION_SIZE,
  SESSION_SIZE_OPTIONS,
  isSessionSizeAvailable as isConfiguredSessionSizeAvailable,
  resolveSessionSize
} from "./session-config.js";

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const endScreen = document.querySelector("#end-screen");
const errorScreen = document.querySelector("#error-screen");

const startButton = document.querySelector("#start-button");
const retryButton = document.querySelector("#retry-button");
const playAgainButton = document.querySelector("#play-again-button");
const humanButton = document.querySelector("#human-button");
const aiButton = document.querySelector("#ai-button");
const sessionSizeButtons = [...document.querySelectorAll("[data-session-size]")];

const roundCounter = document.querySelector("#round-counter");
const scoreDisplay = document.querySelector("#score");
const finalScore = document.querySelector("#final-score");
const errorMessage = document.querySelector("#error-message");

const imageCard = document.querySelector("#image-card");
const gameImage = document.querySelector("#game-image");
const feedbackBadge = document.querySelector("#feedback-badge");
const humanHint = imageCard.querySelector(".choice-hint-human");
const aiHint = imageCard.querySelector(".choice-hint-ai");

let selector = null;
let preloader = null;
let swipe = null;

let sessionNumber = 0;
let sessionDeck = [];
let selectedSessionSize = DEFAULT_SESSION_SIZE;
let activeSessionSize = DEFAULT_SESSION_SIZE;
let availableImageCount = 0;
let currentIndex = 0;
let score = 0;
let state = "boot";
let presentationRevision = 0;

function showOnly(screen) {
  [startScreen, gameScreen, endScreen, errorScreen].forEach((element) => {
    element.classList.toggle("is-hidden", element !== screen);
  });
}

function setState(nextState) {
  state = nextState;
  const playing = nextState === "playing";
  humanButton.disabled = !playing;
  aiButton.disabled = !playing;
  swipe?.setEnabled(playing);
}

function setButtonBusy(button, busy, normalText) {
  button.disabled = busy;
  button.textContent = busy ? "Przygotowywanie…" : normalText;
}

function nextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function updateSwipeHints(progress) {
  humanHint.style.opacity = String(Math.max(0, Math.min(1, -progress * 3)));
  aiHint.style.opacity = String(Math.max(0, Math.min(1, progress * 3)));
}

function clearCardOverlays() {
  feedbackBadge.classList.remove("is-visible");
  feedbackBadge.textContent = "";
  updateSwipeHints(0);
}

function hideImageContent() {
  gameImage.classList.remove("is-ready");
}

function getUsableImageCount() {
  return Math.max(0, availableImageCount - (preloader?.invalidImageIds?.size ?? 0));
}

function isSessionSizeAvailable(size) {
  return isConfiguredSessionSizeAvailable(size, getUsableImageCount());
}

function syncSessionSizeControls({ busy = false } = {}) {
  for (const button of sessionSizeButtons) {
    const size = Number(button.dataset.sessionSize);
    const available = isSessionSizeAvailable(size);
    const selected = size === selectedSessionSize;

    button.disabled = busy || !available;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-selected", selected);

    if (!available && availableImageCount > 0) {
      button.title = `Ta opcja wymaga co najmniej ${size} obrazów w puli.`;
    } else {
      button.removeAttribute("title");
    }
  }
}

function chooseSessionSize(size) {
  if (!isSessionSizeAvailable(size)) return false;
  selectedSessionSize = size;
  syncSessionSizeControls();
  return true;
}

function configureSessionSizeAvailability(imageCount) {
  availableImageCount = imageCount;

  if (!isSessionSizeAvailable(selectedSessionSize)) {
    selectedSessionSize = resolveSessionSize(imageCount, selectedSessionSize) ?? MIN_SESSION_SIZE;
  }

  syncSessionSizeControls();
}

function showFatalError(message) {
  presentationRevision += 1;
  setState("error");
  swipe?.resetVisuals();
  errorMessage.textContent = message;
  showOnly(errorScreen);
}

function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.images)) {
    throw new Error("Manifest obrazów ma nieprawidłowy format.");
  }

  const ids = new Set();
  const images = [];

  for (const item of manifest.images) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.src !== "string" ||
      !["ai", "human"].includes(item.type)
    ) {
      throw new Error("Manifest zawiera nieprawidłowy rekord obrazu.");
    }

    if (ids.has(item.id)) {
      throw new Error("Manifest zawiera zduplikowane identyfikatory obrazów.");
    }

    ids.add(item.id);
    images.push(item);
  }

  if (images.length < MIN_SESSION_SIZE) {
    throw new Error(`Gra wymaga co najmniej ${MIN_SESSION_SIZE} unikalnych obrazów w puli.`);
  }

  return images;
}

async function loadManifest() {
  let response;

  try {
    response = await fetch("./data/images.json", { cache: "no-store" });
  } catch (error) {
    console.error("[AI OR HUMAN] Nie udało się pobrać manifestu obrazów.", error);
    throw new Error("Gra jest chwilowo niedostępna. Spróbuj ponownie za chwilę.");
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.error(
        "[AI OR HUMAN] Brak dist/data/images.json. Na GitHub Pages aplikacja musi być publikowana przez workflow GitHub Actions. " +
        "Sprawdź: repo zawiera .github/workflows/pages.yml, Settings > Pages > Source = GitHub Actions oraz ostatni workflow zakończył się PASS."
      );
    } else {
      console.error(`[AI OR HUMAN] Manifest obrazów zwrócił HTTP ${response.status}.`);
    }

    throw new Error("Gra jest chwilowo niedostępna. Spróbuj ponownie za chwilę.");
  }

  const images = validateManifest(await response.json());
  selector = new RoundSelector(images);
  preloader = new RoundPreloader(selector);
  configureSessionSizeAvailability(images.length);
}

async function presentCurrentCard({ revealGameScreen = false } = {}) {
  const item = sessionDeck[currentIndex];
  if (!item) {
    finishSession();
    return false;
  }

  const revision = ++presentationRevision;
  setState("presenting");
  clearCardOverlays();
  hideImageContent();
  swipe.prepareHidden();

  roundCounter.textContent = `${currentIndex + 1} / ${activeSessionSize}`;
  scoreDisplay.textContent = String(score);

  try {
    await loadImageIntoElement(gameImage, item.src);
  } catch (error) {
    console.error("[AI OR HUMAN] Obraz sesji nie jest już dostępny po preloadzie.", error);
    showFatalError("Przygotowany obraz przestał być dostępny. Odśwież stronę i spróbuj ponownie.");
    return false;
  }

  if (revision !== presentationRevision || state === "error") return false;

  gameImage.classList.add("is-ready");

  if (revealGameScreen) {
    showOnly(gameScreen);
  }

  // Give the browser a paint opportunity while the card itself is still hidden.
  // The new src is therefore committed before the card can return to the centre.
  await nextPaint();
  if (revision !== presentationRevision || state === "error") return false;

  const revealed = await swipe.reveal();
  if (!revealed || revision !== presentationRevision || state === "error") return false;

  selector.recordExposure(item.id, sessionNumber);
  setState("playing");
  return true;
}

async function prepareAndStartSession(triggerButton, normalText) {
  if (!preloader || state === "preparing") return;
  if (!isSessionSizeAvailable(selectedSessionSize)) return;

  setState("preparing");
  setButtonBusy(triggerButton, true, normalText);
  syncSessionSizeControls({ busy: true });

  try {
    const requestedSessionSize = selectedSessionSize;
    const nextSessionNumber = sessionNumber + 1;
    const preparedDeck = await preloader.prepare(nextSessionNumber, {
      roundSize: requestedSessionSize
    });

    sessionNumber = nextSessionNumber;
    sessionDeck = preparedDeck;
    activeSessionSize = requestedSessionSize;
    currentIndex = 0;
    score = 0;
    scoreDisplay.textContent = "0";

    await presentCurrentCard({ revealGameScreen: true });
  } catch (error) {
    console.error(error);
    showFatalError(error instanceof Error ? error.message : String(error));
  } finally {
    setButtonBusy(triggerButton, false, normalText);
    syncSessionSizeControls();
  }
}

function showFeedback(correct) {
  feedbackBadge.textContent = correct ? "DOBRZE" : "ŹLE";
  feedbackBadge.classList.add("is-visible");
}

async function answer(type) {
  if (state !== "playing") return;

  const item = sessionDeck[currentIndex];
  if (!item) return;

  setState("answering");

  const correct = type === item.type;
  if (correct) {
    score += 1;
    scoreDisplay.textContent = String(score);
  }

  showFeedback(correct);

  // The feedback travels with the outgoing card. There is no artificial pause
  // between releasing a swipe and the throw animation.
  const thrown = await swipe.throw(type);
  if (!thrown || state === "error") return;

  currentIndex += 1;

  if (currentIndex >= activeSessionSize) {
    finishSession();
    return;
  }

  await presentCurrentCard();
}

function finishSession() {
  presentationRevision += 1;
  setState("result");
  clearCardOverlays();
  hideImageContent();
  // After the final throw the card intentionally stays hidden. Do not reset it
  // before switching screens, otherwise the final image can flash back on screen.
  finalScore.textContent = `${score} / ${activeSessionSize}`;
  playAgainButton.disabled = false;
  playAgainButton.textContent = "Zagraj ponownie";
  syncSessionSizeControls();
  showOnly(endScreen);
}

function initializeSwipe() {
  swipe = new SwipeController(imageCard, {
    onDecision: (type) => answer(type),
    onProgress: updateSwipeHints
  });
  swipe.setEnabled(false);
}

async function bootstrap() {
  try {
    initializeSwipe();
    setState("boot");
    showOnly(startScreen);
    startButton.disabled = true;
    syncSessionSizeControls({ busy: true });
    await loadManifest();
    startButton.disabled = false;
    setState("ready");
  } catch (error) {
    console.error(error);
    showFatalError(error instanceof Error ? error.message : String(error));
  }
}

sessionSizeButtons.forEach((button) => {
  button.addEventListener("click", () => chooseSessionSize(Number(button.dataset.sessionSize)));
});

startButton.addEventListener("click", () => prepareAndStartSession(startButton, "Rozpocznij"));
playAgainButton.addEventListener("click", () => prepareAndStartSession(playAgainButton, "Zagraj ponownie"));
retryButton.addEventListener("click", () => window.location.reload());
humanButton.addEventListener("click", () => answer("human"));
aiButton.addEventListener("click", () => answer("ai"));

bootstrap();
