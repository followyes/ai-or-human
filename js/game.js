import {
  getSeenImageIds,
  rememberImageId,
  resetSeenImageIds
} from "./storage.js";

const ROUND_SIZE = 20;
const SWIPE_MIN_PX = 72;
const SWIPE_RATIO = 0.22;
const SWIPE_MAX_ROTATION = 12;
const FEEDBACK_DELAY_MS = 420;
const THROW_DURATION_MS = 430;

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const endScreen = document.querySelector("#end-screen");
const errorScreen = document.querySelector("#error-screen");

const startButton = document.querySelector("#start-button");
const startStatus = document.querySelector("#start-status");
const roundCounter = document.querySelector("#round-counter");
const scoreDisplay = document.querySelector("#score");
const gameImage = document.querySelector("#game-image");
const imageLoader = document.querySelector("#image-loader");
const imageCard = document.querySelector("#image-card");
const feedbackBadge = document.querySelector("#feedback-badge");
const humanButton = document.querySelector("#human-button");
const aiButton = document.querySelector("#ai-button");
const playAgainButton = document.querySelector("#play-again-button");
const resetHistoryButton = document.querySelector("#reset-history-button");
const finalScore = document.querySelector("#final-score");
const finalPercent = document.querySelector("#final-percent");
const endMessage = document.querySelector("#end-message");
const errorMessage = document.querySelector("#error-message");

let allImages = [];
let roundDeck = [];
let currentIndex = 0;
let score = 0;
let answerLocked = false;

let activePointerId = null;
let dragStartX = 0;
let dragDeltaX = 0;
let dragging = false;

function showOnly(screen) {
  [startScreen, gameScreen, endScreen, errorScreen].forEach((element) => {
    element.classList.toggle("is-hidden", element !== screen);
  });
}

function fisherYates(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function isTouchFirstDevice() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function getAvailableImages() {
  const seen = getSeenImageIds();
  return allImages.filter((item) => !seen.has(item.id));
}

function buildRoundDeck() {
  const available = fisherYates(getAvailableImages());
  return available.slice(0, Math.min(ROUND_SIZE, available.length));
}

async function loadManifest() {
  const response = await fetch("./data/images.json", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Nie udało się wczytać data/images.json (${response.status}).`);
  }

  const manifest = await response.json();

  if (!manifest || !Array.isArray(manifest.images)) {
    throw new Error("data/images.json ma nieprawidłowy format.");
  }

  const validTypes = new Set(["ai", "human"]);
  allImages = manifest.images.filter((item) => (
    item &&
    typeof item.id === "string" &&
    typeof item.src === "string" &&
    validTypes.has(item.type)
  ));

  if (allImages.length === 0) {
    throw new Error(
      "Brak obrazów w talii. Dodaj pliki do images/AI i images/HUMAN, a następnie uruchom: npm run images"
    );
  }

  const uniqueIds = new Set(allImages.map((item) => item.id));
  if (uniqueIds.size !== allImages.length) {
    throw new Error("Manifest zawiera zduplikowane identyfikatory obrazów.");
  }
}

function updateStartStatus() {
  const remaining = getAvailableImages().length;

  if (remaining === 0 && allImages.length > 0) {
    startStatus.textContent = "Wykorzystano już wszystkie dostępne obrazy.";
    return;
  }

  startStatus.textContent = `${remaining} niewidzianych obrazów w puli.`;
}

function setControlsDisabled(disabled) {
  humanButton.disabled = disabled;
  aiButton.disabled = disabled;
}

function resetCardVisualState() {
  imageCard.classList.remove(
    "is-dragging",
    "is-returning",
    "is-throwing",
    "throw-left",
    "throw-right"
  );
  imageCard.style.transform = "";
  imageCard.style.opacity = "";

  const humanHint = imageCard.querySelector(".choice-hint-human");
  const aiHint = imageCard.querySelector(".choice-hint-ai");
  humanHint.style.opacity = "0";
  aiHint.style.opacity = "0";
}

function preloadNextImage() {
  const nextItem = roundDeck[currentIndex + 1];
  if (!nextItem) return;

  const preload = new Image();
  preload.src = nextItem.src;
}

function loadCurrentCard() {
  const item = roundDeck[currentIndex];

  if (!item) {
    finishRound();
    return;
  }

  resetCardVisualState();
  feedbackBadge.className = "feedback-badge";
  feedbackBadge.textContent = "";
  answerLocked = false;
  setControlsDisabled(false);

  roundCounter.textContent = `${currentIndex + 1} / ${roundDeck.length}`;
  scoreDisplay.textContent = String(score);

  gameImage.classList.remove("is-ready");
  gameImage.removeAttribute("src");
  imageLoader.hidden = false;
  imageLoader.textContent = "Ładowanie…";

  gameImage.onload = () => {
    imageLoader.hidden = true;
    gameImage.classList.add("is-ready");
  };

  gameImage.onerror = () => {
    imageLoader.hidden = false;
    imageLoader.textContent = "Nie udało się wczytać tego obrazu.";
  };

  gameImage.src = item.src;
  preloadNextImage();
}

function startRound() {
  roundDeck = buildRoundDeck();

  if (roundDeck.length === 0) {
    showEndOfPool();
    return;
  }

  currentIndex = 0;
  score = 0;
  answerLocked = false;
  scoreDisplay.textContent = "0";

  showOnly(gameScreen);
  loadCurrentCard();
}

function showFeedback(correct) {
  feedbackBadge.textContent = correct ? "DOBRZE" : "ŹLE";
  feedbackBadge.className = `feedback-badge is-visible ${correct ? "is-correct" : "is-wrong"}`;
}

function throwCard(direction) {
  imageCard.classList.remove("is-dragging", "is-returning");
  imageCard.classList.add("is-throwing", direction === "right" ? "throw-right" : "throw-left");
}

function answer(type, source = "button") {
  if (answerLocked) return;

  const item = roundDeck[currentIndex];
  if (!item) return;

  answerLocked = true;
  setControlsDisabled(true);

  const correct = type === item.type;
  if (correct) {
    score += 1;
    scoreDisplay.textContent = String(score);
  }

  rememberImageId(item.id);
  showFeedback(correct);

  const direction = type === "ai" ? "right" : "left";

  // Jeśli odpowiedź przyszła z gestu, karta jest już przesunięta.
  if (source !== "swipe") {
    imageCard.style.transform = "";
  }

  window.setTimeout(() => {
    throwCard(direction);
  }, FEEDBACK_DELAY_MS);

  window.setTimeout(() => {
    currentIndex += 1;
    loadCurrentCard();
  }, FEEDBACK_DELAY_MS + THROW_DURATION_MS);
}

function finishRound() {
  const played = roundDeck.length;
  const percent = played > 0 ? Math.round((score / played) * 100) : 0;
  const remaining = getAvailableImages().length;

  finalScore.textContent = `${score} / ${played}`;
  finalPercent.textContent = `${percent}%`;

  if (remaining === 0) {
    endMessage.textContent = "Widziałeś już wszystkie obrazy dostępne w puli.";
    playAgainButton.classList.add("is-hidden");
    resetHistoryButton.classList.remove("is-hidden");
  } else {
    endMessage.textContent = `${remaining} niewidzianych obrazów pozostało w puli.`;
    playAgainButton.classList.remove("is-hidden");
    resetHistoryButton.classList.add("is-hidden");
  }

  showOnly(endScreen);
}

function showEndOfPool() {
  finalScore.textContent = "—";
  finalPercent.textContent = "";
  endMessage.textContent = "Widziałeś już wszystkie obrazy dostępne w puli.";
  playAgainButton.classList.add("is-hidden");
  resetHistoryButton.classList.remove("is-hidden");
  showOnly(endScreen);
}

function dragThreshold() {
  return Math.max(
    SWIPE_MIN_PX,
    Math.min(imageCard.clientWidth * SWIPE_RATIO, 130)
  );
}

function updateDragVisual(deltaX) {
  const width = Math.max(imageCard.clientWidth, 1);
  const progress = Math.max(-1, Math.min(1, deltaX / width));
  const rotation = progress * SWIPE_MAX_ROTATION;

  imageCard.style.transform = `translate3d(${deltaX}px, 0, 0) rotate(${rotation}deg)`;

  const humanHint = imageCard.querySelector(".choice-hint-human");
  const aiHint = imageCard.querySelector(".choice-hint-ai");

  humanHint.style.opacity = String(Math.max(0, Math.min(1, -progress * 3)));
  aiHint.style.opacity = String(Math.max(0, Math.min(1, progress * 3)));
}

function cancelDrag() {
  imageCard.classList.remove("is-dragging");
  imageCard.classList.add("is-returning");
  imageCard.style.transform = "translate3d(0, 0, 0) rotate(0deg)";

  const humanHint = imageCard.querySelector(".choice-hint-human");
  const aiHint = imageCard.querySelector(".choice-hint-ai");
  humanHint.style.opacity = "0";
  aiHint.style.opacity = "0";

  window.setTimeout(() => {
    imageCard.classList.remove("is-returning");
    imageCard.style.transform = "";
  }, 250);
}

function onPointerDown(event) {
  if (!isTouchFirstDevice() || answerLocked) return;
  if (event.pointerType === "mouse") return;

  activePointerId = event.pointerId;
  dragStartX = event.clientX;
  dragDeltaX = 0;
  dragging = true;

  imageCard.setPointerCapture?.(event.pointerId);
  imageCard.classList.add("is-dragging");
}

function onPointerMove(event) {
  if (!dragging || event.pointerId !== activePointerId || answerLocked) return;

  dragDeltaX = event.clientX - dragStartX;
  updateDragVisual(dragDeltaX);
}

function onPointerUp(event) {
  if (!dragging || event.pointerId !== activePointerId || answerLocked) return;

  dragging = false;
  imageCard.releasePointerCapture?.(event.pointerId);

  const threshold = dragThreshold();

  if (Math.abs(dragDeltaX) < threshold) {
    cancelDrag();
  } else {
    const type = dragDeltaX > 0 ? "ai" : "human";
    answer(type, "swipe");
  }

  activePointerId = null;
  dragStartX = 0;
  dragDeltaX = 0;
}

function onPointerCancel(event) {
  if (!dragging || event.pointerId !== activePointerId) return;

  dragging = false;
  activePointerId = null;
  cancelDrag();
}

humanButton.addEventListener("click", () => answer("human"));
aiButton.addEventListener("click", () => answer("ai"));
startButton.addEventListener("click", startRound);
playAgainButton.addEventListener("click", startRound);

resetHistoryButton.addEventListener("click", () => {
  resetSeenImageIds();
  updateStartStatus();
  startRound();
});

imageCard.addEventListener("pointerdown", onPointerDown);
imageCard.addEventListener("pointermove", onPointerMove);
imageCard.addEventListener("pointerup", onPointerUp);
imageCard.addEventListener("pointercancel", onPointerCancel);

if (isTouchFirstDevice()) {
  imageCard.classList.add("is-draggable");
}

async function bootstrap() {
  try {
    startButton.disabled = true;
    startStatus.textContent = "Wczytywanie puli obrazów…";

    await loadManifest();

    startButton.disabled = false;
    updateStartStatus();
  } catch (error) {
    console.error(error);
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    showOnly(errorScreen);
  }
}

bootstrap();
