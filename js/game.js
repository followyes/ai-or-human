import { getSeenImageIds, rememberImageId, resetSessionHistory } from "./history.js";

const ROUND_SIZE = 20;
const SWIPE_MIN_PX = 72;
const SWIPE_RATIO = 0.22;
const SWIPE_MAX_ROTATION = 12;
const FEEDBACK_DELAY_MS = 420;
const THROW_DURATION_MS = 430;
const IMAGE_ERROR_SKIP_MS = 700;

const startScreen = document.querySelector("#start-screen");
const gameScreen = document.querySelector("#game-screen");
const endScreen = document.querySelector("#end-screen");
const errorScreen = document.querySelector("#error-screen");

const startButton = document.querySelector("#start-button");
const roundCounter = document.querySelector("#round-counter");
const scoreDisplay = document.querySelector("#score");
const gameImage = document.querySelector("#game-image");
const imageLoader = document.querySelector("#image-loader");
const imageCard = document.querySelector("#image-card");
const feedbackBadge = document.querySelector("#feedback-badge");
const humanButton = document.querySelector("#human-button");
const aiButton = document.querySelector("#ai-button");
const playAgainButton = document.querySelector("#play-again-button");
const finalScore = document.querySelector("#final-score");
const endMessage = document.querySelector("#end-message");
const errorMessage = document.querySelector("#error-message");

let allImages = [];
let roundDeck = [];
let currentIndex = 0;
let score = 0;
let answerLocked = false;
let loadToken = 0;

let activePointerId = null;
let dragStartX = 0;
let dragStartY = 0;
let dragDeltaX = 0;
let dragDeltaY = 0;
let dragging = false;
let dragAxisLocked = null;

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


function getAvailableImages() {
  const seen = getSeenImageIds();
  return allImages.filter((item) => !seen.has(item.id));
}

function buildRoundDeck() {
  return fisherYates(getAvailableImages()).slice(0, ROUND_SIZE);
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

  imageCard.querySelector(".choice-hint-human").style.opacity = "0";
  imageCard.querySelector(".choice-hint-ai").style.opacity = "0";
}

function preloadNextImage() {
  const nextItem = roundDeck[currentIndex + 1];
  if (!nextItem) return;

  const preload = new Image();
  preload.src = nextItem.src;
}

function showFatalError(message) {
  errorMessage.textContent = message;
  showOnly(errorScreen);
}

function skipBrokenImage(token) {
  if (token !== loadToken) return;

  roundDeck.splice(currentIndex, 1);

  if (roundDeck.length === 0) {
    showFatalError("Nie udało się wczytać żadnego obrazu z bieżącej puli.");
    return;
  }

  loadCurrentCard();
}

function loadCurrentCard() {
  const item = roundDeck[currentIndex];

  if (!item) {
    finishRound();
    return;
  }

  loadToken += 1;
  const token = loadToken;

  resetCardVisualState();
  feedbackBadge.className = "feedback-badge";
  feedbackBadge.textContent = "";
  answerLocked = true;
  setControlsDisabled(true);

  roundCounter.textContent = `${currentIndex + 1} / ${roundDeck.length}`;
  scoreDisplay.textContent = String(score);

  gameImage.classList.remove("is-ready");
  gameImage.removeAttribute("src");
  imageLoader.hidden = true;
  imageLoader.textContent = "";

  gameImage.onload = () => {
    if (token !== loadToken) return;

    imageLoader.hidden = true;
    gameImage.classList.add("is-ready");
    answerLocked = false;
    setControlsDisabled(false);
  };

  gameImage.onerror = () => {
    if (token !== loadToken) return;

    imageLoader.hidden = false;
    imageLoader.textContent = "Nie udało się wczytać obrazu. Pomijam go…";
    window.setTimeout(() => skipBrokenImage(token), IMAGE_ERROR_SKIP_MS);
  };

  gameImage.src = item.src;
  preloadNextImage();
}

function startRound() {
  roundDeck = buildRoundDeck();

  if (roundDeck.length === 0) {
    showPoolExhausted();
    return;
  }

  currentIndex = 0;
  score = 0;
  answerLocked = true;
  scoreDisplay.textContent = "0";

  endMessage.classList.add("is-hidden");
  endMessage.textContent = "";
  playAgainButton.classList.remove("is-hidden");

  showOnly(gameScreen);
  loadCurrentCard();
}

function showFeedback(correct) {
  feedbackBadge.textContent = correct ? "DOBRZE" : "ŹLE";
  feedbackBadge.className = "feedback-badge is-visible";
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
  const remaining = getAvailableImages().length;

  finalScore.textContent = `${score} / ${played}`;

  if (remaining === 0) {
    endMessage.textContent = "Na razie wykorzystałeś wszystkie dostępne obrazy.";
    endMessage.classList.remove("is-hidden");
    playAgainButton.classList.add("is-hidden");
  } else {
    endMessage.textContent = "";
    endMessage.classList.add("is-hidden");
    playAgainButton.classList.remove("is-hidden");
  }

  showOnly(endScreen);
}

function showPoolExhausted() {
  finalScore.textContent = "—";
  endMessage.textContent = "Na razie wykorzystałeś wszystkie dostępne obrazy.";
  endMessage.classList.remove("is-hidden");
  playAgainButton.classList.add("is-hidden");
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

  imageCard.querySelector(".choice-hint-human").style.opacity = "0";
  imageCard.querySelector(".choice-hint-ai").style.opacity = "0";

  window.setTimeout(() => {
    imageCard.classList.remove("is-returning");
    imageCard.style.transform = "";
  }, 250);
}

function beginDrag(clientX, clientY, pointerId = null) {
  if (answerLocked || dragging) return false;

  activePointerId = pointerId;
  dragStartX = clientX;
  dragStartY = clientY;
  dragDeltaX = 0;
  dragDeltaY = 0;
  dragAxisLocked = null;
  dragging = true;
  imageCard.classList.add("is-dragging");
  return true;
}

function moveDrag(clientX, clientY) {
  if (!dragging || answerLocked) return;

  dragDeltaX = clientX - dragStartX;
  dragDeltaY = clientY - dragStartY;

  if (!dragAxisLocked) {
    if (Math.abs(dragDeltaX) < 6 && Math.abs(dragDeltaY) < 6) return;
    dragAxisLocked = Math.abs(dragDeltaX) >= Math.abs(dragDeltaY) ? "horizontal" : "vertical";
  }

  if (dragAxisLocked !== "horizontal") return;
  updateDragVisual(dragDeltaX);
}

function finishDrag() {
  if (!dragging || answerLocked) return;

  dragging = false;

  if (dragAxisLocked !== "horizontal" || Math.abs(dragDeltaX) < dragThreshold()) {
    cancelDrag();
  } else {
    answer(dragDeltaX > 0 ? "ai" : "human", "swipe");
  }

  activePointerId = null;
  dragStartX = 0;
  dragStartY = 0;
  dragDeltaX = 0;
  dragDeltaY = 0;
  dragAxisLocked = null;
}

function abortDrag() {
  if (!dragging) return;

  dragging = false;
  activePointerId = null;
  dragStartX = 0;
  dragStartY = 0;
  dragDeltaX = 0;
  dragDeltaY = 0;
  dragAxisLocked = null;
  cancelDrag();
}

function onPointerDown(event) {
  // Desktop zostaje przy przyciskach. Touch/pen korzystają ze swipe.
  if (event.pointerType === "mouse" || event.isPrimary === false) return;

  if (!beginDrag(event.clientX, event.clientY, event.pointerId)) return;
  imageCard.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (!dragging || event.pointerId !== activePointerId) return;
  moveDrag(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (!dragging || event.pointerId !== activePointerId) return;
  imageCard.releasePointerCapture?.(event.pointerId);
  finishDrag();
}

function onPointerCancel(event) {
  if (!dragging || event.pointerId !== activePointerId) return;
  abortDrag();
}

function onTouchStart(event) {
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  beginDrag(touch.clientX, touch.clientY, "touch");
}

function onTouchMove(event) {
  if (!dragging || activePointerId !== "touch" || event.touches.length !== 1) return;

  const touch = event.touches[0];
  moveDrag(touch.clientX, touch.clientY);

  // Gdy gest jest już poziomy, nie pozwalamy przeglądarce przejąć go jako scroll/nawigację.
  if (dragAxisLocked === "horizontal" && event.cancelable) {
    event.preventDefault();
  }
}

function onTouchEnd() {
  if (!dragging || activePointerId !== "touch") return;
  finishDrag();
}

function onTouchCancel() {
  if (!dragging || activePointerId !== "touch") return;
  abortDrag();
}

humanButton.addEventListener("click", () => answer("human"));
aiButton.addEventListener("click", () => answer("ai"));
startButton.addEventListener("click", startRound);
playAgainButton.addEventListener("click", startRound);

if ("PointerEvent" in window) {
  imageCard.addEventListener("pointerdown", onPointerDown);
  imageCard.addEventListener("pointermove", onPointerMove);
  imageCard.addEventListener("pointerup", onPointerUp);
  imageCard.addEventListener("pointercancel", onPointerCancel);
} else {
  // Fallback dla starszych / nietypowych silników mobilnych.
  imageCard.addEventListener("touchstart", onTouchStart, { passive: true });
  imageCard.addEventListener("touchmove", onTouchMove, { passive: false });
  imageCard.addEventListener("touchend", onTouchEnd, { passive: true });
  imageCard.addEventListener("touchcancel", onTouchCancel, { passive: true });
}

async function bootstrap() {
  try {
    // Każde pełne odświeżenie strony zaczyna nową sesję gry i nową historię obrazów.
    resetSessionHistory();
    roundDeck = [];
    currentIndex = 0;
    score = 0;
    answerLocked = true;
    scoreDisplay.textContent = "0";
    showOnly(startScreen);

    startButton.disabled = true;
    await loadManifest();
    startButton.disabled = false;
  } catch (error) {
    console.error(error);
    showFatalError(error instanceof Error ? error.message : String(error));
  }
}

bootstrap();
