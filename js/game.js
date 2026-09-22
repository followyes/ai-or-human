import { RoundSelector } from "./round-selector.js";
import { RoundPreloader } from "./image-preloader.js";
import { SwipeController } from "./swipe-controller.js";

const ROUND_SIZE = 20;
const FEEDBACK_HOLD_MS = 280;

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const endScreen = document.querySelector("#end-screen");
const errorScreen = document.querySelector("#error-screen");

const startButton = document.querySelector("#start-button");
const retryButton = document.querySelector("#retry-button");
const playAgainButton = document.querySelector("#play-again-button");
const humanButton = document.querySelector("#human-button");
const aiButton = document.querySelector("#ai-button");

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

let roundNumber = 0;
let roundDeck = [];
let currentIndex = 0;
let score = 0;
let state = "boot";

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

function showFatalError(message) {
  setState("error");
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

  if (images.length < ROUND_SIZE) {
    throw new Error(`Gra wymaga co najmniej ${ROUND_SIZE} unikalnych obrazów w puli.`);
  }

  return images;
}

async function loadManifest() {
  const response = await fetch("./data/images.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Nie udało się wczytać katalogu obrazów (${response.status}).`);
  }

  const images = validateManifest(await response.json());
  selector = new RoundSelector(images);
  preloader = new RoundPreloader(selector, { roundSize: ROUND_SIZE });
}

function updateSwipeHints(progress) {
  humanHint.style.opacity = String(Math.max(0, Math.min(1, -progress * 3)));
  aiHint.style.opacity = String(Math.max(0, Math.min(1, progress * 3)));
}

function resetCard() {
  gameImage.classList.remove("is-ready");
  feedbackBadge.classList.remove("is-visible");
  feedbackBadge.textContent = "";
  updateSwipeHints(0);
  swipe?.resetVisuals();
}

function renderCurrentCard() {
  const item = roundDeck[currentIndex];
  if (!item) {
    finishRound();
    return;
  }

  resetCard();
  roundCounter.textContent = `${currentIndex + 1} / ${ROUND_SIZE}`;
  scoreDisplay.textContent = String(score);

  gameImage.onload = () => gameImage.classList.add("is-ready");
  gameImage.onerror = () => {
    showFatalError("Przygotowany obraz przestał być dostępny. Odśwież stronę i spróbuj ponownie.");
  };
  gameImage.src = item.src;

  selector.recordExposure(item.id, roundNumber);
  setState("playing");
}

async function prepareAndStartRound(triggerButton, normalText) {
  if (!preloader || state === "preparing") return;

  setState("preparing");
  setButtonBusy(triggerButton, true, normalText);

  try {
    const nextRoundNumber = roundNumber + 1;
    const preparedDeck = await preloader.prepare(nextRoundNumber);

    roundNumber = nextRoundNumber;
    roundDeck = preparedDeck;
    currentIndex = 0;
    score = 0;
    scoreDisplay.textContent = "0";

    showOnly(gameScreen);
    renderCurrentCard();
  } catch (error) {
    console.error(error);
    showFatalError(error instanceof Error ? error.message : String(error));
  } finally {
    setButtonBusy(triggerButton, false, normalText);
  }
}

function showFeedback(correct) {
  feedbackBadge.textContent = correct ? "DOBRZE" : "ŹLE";
  feedbackBadge.classList.add("is-visible");
}

async function answer(type) {
  if (state !== "playing") return;

  const item = roundDeck[currentIndex];
  if (!item) return;

  setState("answering");

  const correct = type === item.type;
  if (correct) {
    score += 1;
    scoreDisplay.textContent = String(score);
  }

  showFeedback(correct);
  await delay(FEEDBACK_HOLD_MS);
  await swipe.throw(type);

  currentIndex += 1;
  renderCurrentCard();
}

function finishRound() {
  setState("result");
  finalScore.textContent = `${score} / ${ROUND_SIZE}`;
  playAgainButton.disabled = false;
  playAgainButton.textContent = "Zagraj ponownie";
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
    await loadManifest();
    startButton.disabled = false;
    setState("ready");
  } catch (error) {
    console.error(error);
    showFatalError(error instanceof Error ? error.message : String(error));
  }
}

startButton.addEventListener("click", () => prepareAndStartRound(startButton, "Rozpocznij"));
playAgainButton.addEventListener("click", () => prepareAndStartRound(playAgainButton, "Zagraj ponownie"));
retryButton.addEventListener("click", () => window.location.reload());
humanButton.addEventListener("click", () => answer("human"));
aiButton.addEventListener("click", () => answer("ai"));

bootstrap();
