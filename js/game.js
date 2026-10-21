import { RoundSelector } from "./round-selector.js";
import { RoundPreloader, loadImageIntoElement } from "./image-preloader.js";
import { SwipeController } from "./swipe-controller.js";
import { AnswerFeedbackController } from "./answer-feedback.js?v=1.7.1a";
import { SessionSizePicker } from "./session-size-picker.js";
import { loadContentManifest } from "./content-source.js";
import { initializeThemeController } from "./theme-controller.js?v=1.7.1";
import { GAME_MODE_IDS, getGameModeDefinition, isGameModeSelectable } from "./game-modes.js";
import { preloadImage } from "./image-preloader.js";
import { SpeedDeadlineClock, SpeedRunDeck, createSpeedRunState, resolveSpeedRunOutcome, getSpeedDifficulty, getSpeedTimerView, DEFAULT_SPEED_DIFFICULTY } from "./speed-run.js?v=1.7.1a";
import { PreGameTransitionCoordinator } from "./pre-game-transition.js";
import { ResultCelebrationController } from "./result-celebration.js?v=1.7.1";
import {
  DEFAULT_SESSION_SIZE,
  MIN_SESSION_SIZE,
  isSessionSizeAvailable as isConfiguredSessionSizeAvailable,
  resolveSessionSize
} from "./session-config.js";

const preGameScreen = document.querySelector("#pre-game-screen");
const modeSelectPanel = document.querySelector("#mode-select-panel");
const modeSetupPanel = document.querySelector("#mode-setup-panel");
const gameScreen = document.querySelector("#game-screen");
const endScreen = document.querySelector("#end-screen");
const errorScreen = document.querySelector("#error-screen");
const publicScreens = [preGameScreen, gameScreen, endScreen, errorScreen];
const preGamePanels = [modeSelectPanel, modeSetupPanel];

const speedModeButton = document.querySelector("#speed-run-mode-button");
const classicModeButton = document.querySelector('#classic-mode-button[data-game-mode="classic"]');
const modeSetupTitle = document.querySelector("#mode-setup-title");
const modeSetupBackButton = document.querySelector("#mode-setup-back");
const setupStatus = document.querySelector("#classic-setup-status");
const setupRetryButton = document.querySelector("#setup-retry-button");

const startButton = document.querySelector("#start-button");
const retryButton = document.querySelector("#retry-button");
const playAgainButton = document.querySelector("#play-again-button");
const resultHomeButton = document.querySelector("#result-home-button");
const resultStartButton = document.querySelector("#result-start-button");
const resultActions = document.querySelector("#result-actions");
const resultReplaySetup = document.querySelector("#result-replay-setup");
const humanButton = document.querySelector("#human-button");
const aiButton = document.querySelector("#ai-button");
const classicSetupPicker = document.querySelector("#classic-setup-picker");
const classicReplayPicker = document.querySelector("#classic-replay-picker");
const speedSetupPicker = document.querySelector("#speed-setup-picker");
const speedReplayPicker = document.querySelector("#speed-replay-picker");
const speedDifficultyButtons = [...document.querySelectorAll("[data-speed-difficulty]")];
const classicProgressStat = document.querySelector("#classic-progress-stat");
const speedTimer = document.querySelector("#speed-timer");
const speedTimeTrack = document.querySelector("#speed-time-track");
const speedTimeFill = document.querySelector("#speed-time-fill");
const speedLivesStat = document.querySelector("#speed-lives-stat");
const speedTimeDisplay = document.querySelector("#speed-time");
const speedLivesDisplay = document.querySelector("#speed-lives");
const sessionSizeButtons = [...document.querySelectorAll("[data-session-size]")];
const sessionSizeOptionGroups = [...document.querySelectorAll(".session-size-options")];

const roundCounter = document.querySelector("#round-counter");
const scoreDisplay = document.querySelector("#score");
const finalScore = document.querySelector("#final-score");
const errorMessage = document.querySelector("#error-message");

const imageCard = document.querySelector("#image-card");
const gameImage = document.querySelector("#game-image");
const answerFeedbackElement = document.querySelector("#answer-feedback");
const resultFloatingCardSurfaces = [...document.querySelectorAll(".floating-card__surface")];
const resultFireworkBursts = [...document.querySelectorAll("[data-result-firework]")].map((element) => ({
  element,
  core: element.querySelector("[data-firework-core]"),
  particles: [...element.querySelectorAll("[data-firework-particle]")]
}));
const resultAmbientHalo = document.querySelector("[data-result-halo]");
const resultDividerStar = document.querySelector("#end-screen .result-brand .cosmic-divider > span");
const resultFireworkExclusions = [
  document.querySelector("#end-screen .result-eyebrow"),
  document.querySelector("#end-screen .result-brand .cosmic-divider"),
  document.querySelector("#end-screen .result-title"),
  document.querySelector("#end-screen .result-score-stage"),
  document.querySelector("#end-screen .result-action-stage"),
  document.querySelector("#theme-switch")
].filter(Boolean);
const humanHint = imageCard.querySelector(".choice-hint-human");
const aiHint = imageCard.querySelector(".choice-hint-ai");

let selector = null;
let preloader = null;
let swipe = null;
let answerFeedback = null;
let sessionSizePickers = [];
let themeController = null;
let preGameTransition = null;
let resultCelebration = null;

let selectedGameMode = null;
let selectedSpeedDifficulty = DEFAULT_SPEED_DIFFICULTY;
let speedRunState = null;
let speedDeck = null;
const speedClock = new SpeedDeadlineClock();
let classicManifestStatus = "idle";
let classicManifestError = null;
let classicManifestPromise = null;
let preGameNavigationPending = false;

let sessionNumber = 0;
let sessionDeck = [];
let selectedSessionSize = DEFAULT_SESSION_SIZE;
let activeSessionSize = DEFAULT_SESSION_SIZE;
let availableImageCount = 0;
let currentIndex = 0;
let score = 0;
let state = "boot";
let resultSubstate = "celebration";
let presentationRevision = 0;

function publicViewForScreen(screen) {
  if (screen === preGameScreen) return state === "mode-setup" ? "mode-setup" : "mode-select";
  if (screen === gameScreen) return "gameplay";
  if (screen === endScreen) return "result";
  if (screen === errorScreen) return "error";
  return "unknown";
}

function refreshSessionSizePickersSoon() {
  if (!sessionSizePickers.length) return;
  window.requestAnimationFrame(() => {
    sessionSizePickers.forEach((picker) => picker.refresh());
  });
}

function applyPublicView(screen, { view = publicViewForScreen(screen), themeSwitchVisible = view !== "gameplay" } = {}) {
  document.body.dataset.publicView = view;
  themeController?.setVisible(themeSwitchVisible);
}

function showOnly(screen, options = {}) {
  if (preGameTransition) {
    preGameTransition.showImmediately(screen, publicScreens);
  } else {
    publicScreens.forEach((element) => {
      const active = element === screen;
      element.classList.toggle("is-hidden", !active);
      element.inert = !active;
      element.setAttribute("aria-hidden", String(!active));
    });
  }

  applyPublicView(screen, options);
  refreshSessionSizePickersSoon();
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

function setResultSubstate(nextSubstate, { focus = false } = {}) {
  const replaySetupVisible = nextSubstate === "replay-setup";
  resultSubstate = replaySetupVisible ? "replay-setup" : "celebration";
  endScreen.dataset.resultState = resultSubstate;

  resultActions.classList.toggle("is-active", !replaySetupVisible);
  resultActions.hidden = replaySetupVisible;
  resultActions.inert = replaySetupVisible;
  resultActions.setAttribute("aria-hidden", String(replaySetupVisible));

  resultReplaySetup.classList.toggle("is-active", replaySetupVisible);
  resultReplaySetup.hidden = !replaySetupVisible;
  resultReplaySetup.inert = !replaySetupVisible;
  resultReplaySetup.setAttribute("aria-hidden", String(!replaySetupVisible));

  if (!replaySetupVisible) return;

  syncSessionSizeControls();
  syncModePresentation();
  refreshSessionSizePickersSoon();

  if (focus) {
    window.requestAnimationFrame(() => {
      const selectedSizeButton = resultReplaySetup.querySelector(
        `[data-session-size="${selectedSessionSize}"]`
      );
      const speedButton = resultReplaySetup.querySelector(`[data-speed-difficulty="${selectedSpeedDifficulty}"]`);
      (selectedGameMode === GAME_MODE_IDS.SPEED_RUN ? speedButton : selectedSizeButton)?.focus({ preventScroll: true });
    });
  }
}

function resetResultPresentation() {
  setResultSubstate("celebration");
  playAgainButton.disabled = false;
  resultHomeButton.disabled = false;
  resultStartButton.disabled = false;
  playAgainButton.textContent = "Zagraj ponownie";
  resultStartButton.textContent = "Rozpocznij";
}

function openResultReplaySetup() {
  if (state !== "result" || resultSubstate === "replay-setup") return;
  resultCelebration?.leave();
  setResultSubstate("replay-setup", { focus: true });
}

function returnResultToHome() {
  if (state !== "result") return;

  resultCelebration?.leave();
  presentationRevision += 1;
  speedClock.stop();
  speedDeck?.cancel();
  speedDeck = null;
  speedRunState = null;
  resetResultPresentation();
  clearCardOverlays();
  hideImageContent();
  sessionDeck = [];
  currentIndex = 0;
  score = 0;
  scoreDisplay.textContent = "0";
  selectedGameMode = null;

  preGameTransition?.showImmediately(modeSelectPanel, preGamePanels);
  setState("mode-select");
  showOnly(preGameScreen, { view: "mode-select", themeSwitchVisible: true });

  window.requestAnimationFrame(() => {
    classicModeButton?.focus({ preventScroll: true });
  });
}

function updateSwipeHints(progress, { decisionProgress = null } = {}) {
  const normalizedDecision = Math.max(0, Math.min(1,
    Number.isFinite(decisionProgress) ? decisionProgress : Math.abs(progress) * 3
  ));
  const visualStrength = Math.min(1, Math.pow(normalizedDecision, 0.72) * 1.04);
  const humanStrength = progress < 0 ? visualStrength : 0;
  const aiStrength = progress > 0 ? visualStrength : 0;

  humanHint.style.opacity = String(humanStrength);
  aiHint.style.opacity = String(aiStrength);
  humanHint.style.setProperty("--swipe-commit", String(progress < 0 ? normalizedDecision : 0));
  aiHint.style.setProperty("--swipe-commit", String(progress > 0 ? normalizedDecision : 0));
}

function clearCardOverlays() {
  answerFeedback?.clear();
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

function syncSessionSizeControls({ busy = false, animate = false } = {}) {
  for (const button of sessionSizeButtons) {
    const size = Number(button.dataset.sessionSize);
    const available = isSessionSizeAvailable(size);
    const selected = size === selectedSessionSize;

    button.disabled = busy || !available;
    button.setAttribute("aria-pressed", String(selected));

    if (!available && availableImageCount > 0) {
      button.title = `Ta opcja wymaga co najmniej ${size} obrazów w puli.`;
    } else {
      button.removeAttribute("title");
    }
  }

  for (const picker of sessionSizePickers) {
    picker.sync(selectedSessionSize, { animate: animate && picker.isVisible() });
  }
}

function syncModePresentation() {
  const speed = selectedGameMode === GAME_MODE_IDS.SPEED_RUN;
  const classic = !speed;
  for (const [element, visible] of [
    [classicSetupPicker, classic], [classicReplayPicker, classic],
    [speedSetupPicker, speed], [speedReplayPicker, speed]
  ]) {
    element.classList.toggle("is-hidden", !visible);
    element.inert = !visible;
  }
  modeSetupTitle.textContent = speed ? "Speed Run" : "Klasyczny";
  classicProgressStat.classList.toggle("is-hidden", speed);
  speedTimer.classList.toggle("is-hidden", !speed);
  if (!speed) speedTimer.classList.remove("is-urgent", "is-critical", "is-paused");
  speedLivesStat.classList.toggle("is-hidden", !speed);
  gameScreen.classList.toggle("is-speed-run", speed);
  for (const button of speedDifficultyButtons) {
    const selected = button.dataset.speedDifficulty === selectedSpeedDifficulty;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function chooseSpeedDifficulty(id) {
  if (!getSpeedDifficulty(id) || state === "preparing") return false;
  selectedSpeedDifficulty = id;
  syncModePresentation();
  return true;
}

function updateSpeedHUD(remainingMs = null) {
  if (!speedRunState) return;
  const difficulty = getSpeedDifficulty(speedRunState.difficultyId);
  // A settled card keeps its last visual fraction but must never keep pulsing.
  speedTimer.classList.toggle("is-paused", remainingMs === "keep" || remainingMs === 0);
  if (remainingMs !== "keep") {
    const totalMs = difficulty.seconds * 1000;
    const timer = getSpeedTimerView(remainingMs ?? totalMs, totalMs);
    if (speedTimeDisplay.textContent !== timer.display) speedTimeDisplay.textContent = timer.display;
    // The deadline clock is the only time source. Writing transform every frame
    // does not reflow the card, controls or the timer's own geometry.
    speedTimeFill.style.transform = `scaleX(${timer.progress})`;
    speedTimer.classList.toggle("is-urgent", timer.urgency !== "normal");
    speedTimer.classList.toggle("is-critical", timer.urgency === "critical");
    const ariaValue = Math.round(timer.progress * 100);
    if (speedTimeTrack.getAttribute("aria-valuenow") !== String(ariaValue)) {
      speedTimeTrack.setAttribute("aria-valuenow", String(ariaValue));
    }
    const ariaText = `${timer.ariaSeconds} ${timer.ariaSeconds === 1 ? "sekunda" : "sekund"}`;
    if (speedTimeTrack.getAttribute("aria-valuetext") !== ariaText) {
      speedTimeTrack.setAttribute("aria-valuetext", ariaText);
    }
  }
  const livesText = "♥ ".repeat(speedRunState.lives).trim() || "0";
  if (speedLivesDisplay.textContent !== livesText) {
    speedLivesDisplay.textContent = livesText;
    speedLivesDisplay.setAttribute("aria-label", `Pozostałe życia: ${speedRunState.lives}`);
  }
  const scoreText = String(speedRunState.score);
  if (scoreDisplay.textContent !== scoreText) scoreDisplay.textContent = scoreText;
}

function syncClassicSetupControls({ animate = false } = {}) {
  const preparing = state === "preparing";
  const manifestReady = classicManifestStatus === "ready";
  const manifestLoading = classicManifestStatus === "loading" || classicManifestStatus === "idle";
  const manifestFailed = classicManifestStatus === "error";
  const canStart = manifestReady && !preparing && (
    (selectedGameMode === GAME_MODE_IDS.CLASSIC && isSessionSizeAvailable(selectedSessionSize)) ||
    (selectedGameMode === GAME_MODE_IDS.SPEED_RUN && getUsableImageCount() > 0 && Boolean(getSpeedDifficulty(selectedSpeedDifficulty)))
  );

  syncSessionSizeControls({ busy: preparing || !manifestReady, animate });
  startButton.disabled = !canStart;
  modeSetupBackButton.disabled = preparing;
  setupRetryButton.disabled = preparing;
  setupRetryButton.classList.toggle("is-hidden", !manifestFailed || preparing);
  setupStatus.classList.toggle("is-error", manifestFailed);

  if (preparing) {
    setupStatus.textContent = "Przygotowywanie rundy…";
  } else if (manifestLoading) {
    setupStatus.textContent = "Ładowanie obrazów…";
  } else if (manifestFailed) {
    setupStatus.textContent = classicManifestError ?? "Nie udało się przygotować gry.";
  } else {
    setupStatus.textContent = "";
  }
}

function chooseSessionSize(size) {
  if (!isSessionSizeAvailable(size)) return false;
  if (size === selectedSessionSize) return true;

  selectedSessionSize = size;
  syncClassicSetupControls({ animate: true });
  return true;
}

function configureSessionSizeAvailability(imageCount) {
  availableImageCount = imageCount;

  if (!isSessionSizeAvailable(selectedSessionSize)) {
    selectedSessionSize = resolveSessionSize(imageCount, selectedSessionSize) ?? MIN_SESSION_SIZE;
  }

  syncClassicSetupControls();
}

function showFatalError(message) {
  resultCelebration?.leave();
  presentationRevision += 1;
  speedClock.stop();
  speedDeck?.cancel();
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
  let result;

  try {
    result = await loadContentManifest({ minimumImageCount: MIN_SESSION_SIZE });
  } catch (error) {
    console.error("[AI OR HUMAN] Nie udało się pobrać katalogu obrazów z Supabase.", error);
    throw new Error("Gra jest chwilowo niedostępna. Spróbuj ponownie za chwilę.");
  }

  const images = validateManifest(result.manifest);
  console.info(`[AI OR HUMAN] Źródło obrazów: ${result.source}; pula: ${images.length}.`);

  selector = new RoundSelector(images);
  preloader = new RoundPreloader(selector);
  configureSessionSizeAvailability(images.length);
}

function ensureClassicManifest({ force = false } = {}) {
  if (classicManifestStatus === "ready" && !force) return Promise.resolve(true);
  if (classicManifestStatus === "loading" && classicManifestPromise) return classicManifestPromise;

  classicManifestStatus = "loading";
  classicManifestError = null;
  if (force) {
    selector = null;
    preloader = null;
    availableImageCount = 0;
  }
  syncClassicSetupControls();

  classicManifestPromise = loadManifest()
    .then(() => {
      classicManifestStatus = "ready";
      classicManifestError = null;
      return true;
    })
    .catch((error) => {
      classicManifestStatus = "error";
      classicManifestError = error instanceof Error ? error.message : String(error);
      return false;
    })
    .finally(() => {
      classicManifestPromise = null;
      syncClassicSetupControls();
    });

  return classicManifestPromise;
}

function prefetchClassicManifestAfterFirstPaint() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void ensureClassicManifest();
    });
  });
}

async function openGameMode(modeId) {
  if (preGameNavigationPending || preGameTransition?.busy || state === "preparing") return false;
  if (!isGameModeSelectable(modeId)) return false;

  const mode = getGameModeDefinition(modeId);
  if (!mode || ![GAME_MODE_IDS.CLASSIC, GAME_MODE_IDS.SPEED_RUN].includes(mode.id)) return false;

  preGameNavigationPending = true;
  try {
    if (preGameTransition?.busy || state === "preparing") return false;

    selectedGameMode = mode.id;
    syncModePresentation();
    setState("mode-setup");
    syncClassicSetupControls();
    applyPublicView(preGameScreen, { view: "mode-setup", themeSwitchVisible: true });
    void ensureClassicManifest();

    const moved = await preGameTransition.transition(modeSelectPanel, modeSetupPanel, {
      focusTarget: modeSetupTitle,
      direction: "forward"
    });

    if (moved) refreshSessionSizePickersSoon();
    return moved;
  } finally {
    preGameNavigationPending = false;
  }
}

async function returnToModeSelect() {
  if (preGameNavigationPending || preGameTransition?.busy || state === "preparing") return false;

  preGameNavigationPending = true;
  try {
    setState("mode-select");
    applyPublicView(preGameScreen, { view: "mode-select", themeSwitchVisible: true });

    const moved = await preGameTransition.transition(modeSetupPanel, modeSelectPanel, {
      focusTarget: classicModeButton,
      direction: "back"
    });

    if (moved) {
      selectedGameMode = null;
    }

    return moved;
  } finally {
    preGameNavigationPending = false;
  }
}

async function presentCurrentCard({ revealGameScreen = false } = {}) {
  const item = sessionDeck[currentIndex];
  if (!item) {
    finishSession();
    return false;
  }

  const revision = ++presentationRevision;
  speedClock.stop();
  setState("presenting");
  clearCardOverlays();
  hideImageContent();
  swipe.prepareHidden();

  roundCounter.textContent = `${currentIndex + 1} / ${activeSessionSize}`;
  scoreDisplay.textContent = String(score);
  if (selectedGameMode === GAME_MODE_IDS.SPEED_RUN) updateSpeedHUD();

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

  await nextPaint();
  if (revision !== presentationRevision || state === "error") return false;

  const revealed = await swipe.reveal();
  if (!revealed || revision !== presentationRevision || state === "error") return false;

  selector.recordExposure(item.id, sessionNumber);
  setState("playing");
  if (selectedGameMode === GAME_MODE_IDS.SPEED_RUN) {
    const seconds = getSpeedDifficulty(speedRunState.difficultyId).seconds;
    speedClock.start(seconds, {
      onTick: (remaining) => updateSpeedHUD(remaining),
      onExpire: () => { if (state === "playing" && revision === presentationRevision) void settleSpeedOutcome("timeout"); }
    });
  }
  return true;
}

async function prepareAndStartSpeedSession(triggerButton, normalText) {
  if (classicManifestStatus !== "ready" || !selector || state === "preparing") return;
  if (!getSpeedDifficulty(selectedSpeedDifficulty) || getUsableImageCount() < 1) return;
  setState("preparing");
  setButtonBusy(triggerButton, true, normalText);
  syncClassicSetupControls();
  const revision = ++presentationRevision;
  speedClock.stop();
  speedDeck?.cancel();
  const nextDeck = new SpeedRunDeck(
    selector.images.filter((item) => !preloader.invalidImageIds.has(item.id)),
    { preload: (src) => preloadImage(src) }
  );
  speedDeck = nextDeck;
  try {
    const first = await nextDeck.next();
    if (!first || revision !== presentationRevision || state !== "preparing") return;
    sessionNumber += 1;
    speedRunState = createSpeedRunState(selectedSpeedDifficulty);
    sessionDeck = [first];
    currentIndex = 0;
    score = 0;
    syncModePresentation();
    updateSpeedHUD();
    await presentCurrentCard({ revealGameScreen: true });
  } catch (error) {
    if (revision === presentationRevision) {
      console.error(error);
      showFatalError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    setButtonBusy(triggerButton, false, normalText);
    syncClassicSetupControls();
  }
}

async function prepareAndStartSession(triggerButton, normalText) {
  if (selectedGameMode === GAME_MODE_IDS.SPEED_RUN) {
    return prepareAndStartSpeedSession(triggerButton, normalText);
  }
  if (selectedGameMode !== GAME_MODE_IDS.CLASSIC) return;
  if (classicManifestStatus !== "ready" || !preloader || state === "preparing") return;
  if (!isSessionSizeAvailable(selectedSessionSize)) return;

  setState("preparing");
  setButtonBusy(triggerButton, true, normalText);
  syncClassicSetupControls();

  try {
    const requestedSessionSize = selectedSessionSize;
    const nextSessionNumber = sessionNumber + 1;
    const preparedDeck = await preloader.prepare(nextSessionNumber, {
      roundSize: requestedSessionSize
    });

    speedClock.stop();
    speedDeck?.cancel();
    speedDeck = null;
    speedRunState = null;
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
    syncClassicSetupControls();
  }
}

async function settleSpeedOutcome(outcome, type = null) {
  if (state !== "playing" || selectedGameMode !== GAME_MODE_IDS.SPEED_RUN || !speedRunState) return;
  const revision = presentationRevision;
  setState("answering"); // locks both buttons, swipe, and competing deadline events
  speedClock.stop();
  speedRunState = resolveSpeedRunOutcome(speedRunState, outcome);
  score = speedRunState.score;
  updateSpeedHUD(outcome === "timeout" ? 0 : "keep");

  const feedback = answerFeedback.play(outcome === "timeout" ? "timeout" : outcome === "correct");
  const dismissal = outcome === "timeout" ? swipe.dismiss() : swipe.throw(type);
  const [shown, dismissed] = await Promise.all([feedback, dismissal]);
  if (!shown || !dismissed || state !== "answering" || revision !== presentationRevision) return;
  if (speedRunState.finished) {
    finishSession();
    return;
  }
  setState("presenting");
  try {
    const nextImage = await speedDeck.next();
    if (!nextImage || revision !== presentationRevision || state !== "presenting") return;
    currentIndex += 1;
    sessionDeck = [nextImage];
    currentIndex = 0;
    await presentCurrentCard();
  } catch (error) {
    if (revision === presentationRevision && state === "presenting") {
      console.error(error);
      showFatalError(error instanceof Error ? error.message : String(error));
    }
  }
}

async function answer(type) {
  if (state !== "playing") return;

  const item = sessionDeck[currentIndex];
  if (!item) return;
  if (selectedGameMode === GAME_MODE_IDS.SPEED_RUN) {
    if (!speedClock.claimBeforeDeadline()) return;
    await settleSpeedOutcome(type === item.type ? "correct" : "incorrect", type);
    return;
  }

  setState("answering");

  const correct = type === item.type;
  if (correct) {
    score += 1;
    scoreDisplay.textContent = String(score);
  }

  const feedbackPromise = answerFeedback.play(correct);
  const throwPromise = swipe.throw(type);

  const [feedbackShown, thrown] = await Promise.all([feedbackPromise, throwPromise]);
  if (!feedbackShown || !thrown || state === "error") return;

  currentIndex += 1;

  if (currentIndex >= activeSessionSize) {
    finishSession();
    return;
  }

  await presentCurrentCard();
}

function finishSession() {
  presentationRevision += 1;
  speedClock.stop();
  speedDeck?.cancel();
  setState("result");
  clearCardOverlays();
  hideImageContent();
  finalScore.textContent = selectedGameMode === GAME_MODE_IDS.SPEED_RUN ? String(score) : `${score} / ${activeSessionSize}`;
  resetResultPresentation();
  syncSessionSizeControls();
  syncModePresentation();
  showOnly(endScreen);
  resultCelebration?.enter();
}

function initializeInteractions() {
  answerFeedback = new AnswerFeedbackController(answerFeedbackElement);
  sessionSizePickers = sessionSizeOptionGroups.map((root) => new SessionSizePicker(root));
  preGameTransition = new PreGameTransitionCoordinator({ windowRef: window });
  preGameTransition.showImmediately(modeSelectPanel, preGamePanels);
  resultCelebration = new ResultCelebrationController({
    cardSurfaces: resultFloatingCardSurfaces,
    fireworkBursts: resultFireworkBursts,
    fireworkExclusions: resultFireworkExclusions,
    halo: resultAmbientHalo,
    dividerStar: resultDividerStar,
    windowRef: window,
    canSchedule: () =>
      state === "result" &&
      resultSubstate === "celebration" &&
      document.body.dataset.publicView === "result"
  });
  swipe = new SwipeController(imageCard, {
    onDecision: (type) => answer(type),
    onProgress: updateSwipeHints
  });
  swipe.setEnabled(false);
}

function bootstrap() {
  initializeInteractions();
  themeController = initializeThemeController();
  setState("mode-select");
  showOnly(preGameScreen, { view: "mode-select" });
  syncModePresentation();
  syncClassicSetupControls();
  prefetchClassicManifestAfterFirstPaint();
}

sessionSizeButtons.forEach((button) => {
  button.addEventListener("click", () => chooseSessionSize(Number(button.dataset.sessionSize)));
});

speedModeButton.addEventListener("click", () => void openGameMode(speedModeButton.dataset.gameMode));
speedDifficultyButtons.forEach((button) => button.addEventListener("click", () => chooseSpeedDifficulty(button.dataset.speedDifficulty)));
document.addEventListener("visibilitychange", () => { if (!document.hidden) speedClock.check(); });
classicModeButton.addEventListener("click", () => void openGameMode(classicModeButton.dataset.gameMode));
modeSetupBackButton.addEventListener("click", () => void returnToModeSelect());
setupRetryButton.addEventListener("click", () => void ensureClassicManifest({ force: true }));
startButton.addEventListener("click", () => prepareAndStartSession(startButton, "Rozpocznij"));
playAgainButton.addEventListener("click", openResultReplaySetup);
resultHomeButton.addEventListener("click", returnResultToHome);
resultStartButton.addEventListener("click", () => prepareAndStartSession(resultStartButton, "Rozpocznij"));
retryButton.addEventListener("click", () => window.location.reload());
humanButton.addEventListener("click", () => answer("human"));
aiButton.addEventListener("click", () => answer("ai"));

bootstrap();
