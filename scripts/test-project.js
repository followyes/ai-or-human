import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build-site.js";
import { RoundSelector, recencyWeight } from "../js/round-selector.js";
import { SwipeController } from "../js/swipe-controller.js";
import { AnswerFeedbackController } from "../js/answer-feedback.js";
import {
  SessionSizePicker,
  getIndicatorTransform,
  normalizeGeometry
} from "../js/session-size-picker.js";
import {
  DEFAULT_SESSION_SIZE,
  MIN_SESSION_SIZE,
  SESSION_SIZE_OPTIONS,
  isSessionSizeAvailable,
  resolveSessionSize
} from "../js/session-config.js";
import { RoundPreloader, loadImageIntoElement } from "../js/image-preloader.js";

import {
  buildPublicStorageUrl,
  fetchSupabaseImages,
  loadContentManifest,
  resolveSupabasePublicConfig
} from "../js/content-source.js";
import {
  ADMIN_SESSION_STORAGE_KEY,
  AdminAuthError,
  authorizeAdminSession,
  clearAdminSession,
  ensureFreshAdminSession,
  loadAdminSession,
  saveAdminSession,
  shouldRefreshAdminSession,
  signInWithPassword,
  signOutAdmin,
  verifyAdminAuthority
} from "../js/admin-auth.js";
import {
  AdminContentError,
  assertImageHashAvailable,
  createStoragePath,
  createThumbnailStoragePath,
  copyStorageObject,
  deleteGameImage,
  findImageByHash,
  getAdminStorageUsage,
  listGameImages,
  registerPreparedImage,
  updateGameImageMoveMetadata
} from "../js/admin-content.js";
import {
  AVIF_ENCODER_MODULE_URL,
  INVENTORY_PREVIEW_MAX_HEIGHT,
  INVENTORY_PREVIEW_MAX_WIDTH,
  calculateInventoryPreviewGeometry,
  convertSourceFileToAvif,
  createInventoryPreviewAvif,
  encodeImageDataToAvif,
  formatBytes,
  inspectSourceFile,
  sha256Blob,
  validateSourceFile
} from "../js/avif-converter.js";
import {
  promoteQueueItem,
  runPipelinedUploadBatch,
  runSequentialUploadBatch,
  summarizeUploadBatch
} from "../js/upload-batch.js";
import { DeleteDrainCoordinator } from "../js/delete-queue.js";
import { deriveMovePaths, moveGameImageToClass, runSequentialMoveBatch } from "../js/content-class-move.js";
import { UploadPreparationWorkerClient } from "../js/upload-worker-client.js";
import { GAME_MODE_IDS, getGameModes, getGameModeDefinition, isGameModeSelectable } from "../js/game-modes.js";
import { PreGameTransitionCoordinator } from "../js/pre-game-transition.js";
import {
  ResultCelebrationController,
  FIREWORK_FAMILIES,
  FIREWORK_TONES,
  chooseFireworkCenter,
  chooseFireworkFamily,
  chooseFireworkParticleCount,
  createFireworkGeometry,
  createFireworkParticlePresentation,
  getFullTurnAngle,
  isFireworkCenterSafe
} from "../js/result-celebration.js";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyTheme,
  calculateThemeRevealRadius,
  getNextTheme,
  initializeThemeController,
  normalizeTheme,
  resolveStoredTheme,
  setThemeSwitchVisible
} from "../js/theme-controller.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function createSeededRng(seed = 123456789) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function makeImages(count, type = "ai") {
  return Array.from({ length: count }, (_, index) => ({
    id: `img-${index}`,
    src: `./images/${type === "ai" ? "AI" : "HUMAN"}/${index}.svg`,
    type
  }));
}




class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}

class FakeAnimation {
  constructor({ deferred = false } = {}) {
    this.cancelled = false;
    this.pauseCalls = 0;
    this.playCalls = 0;
    this.playState = "running";
    this.resolveFinished = null;
    this.rejectFinished = null;
    this.finished = new Promise((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });

    if (!deferred) queueMicrotask(() => {
      this.playState = "finished";
      this.resolveFinished();
    });
  }

  cancel() {
    this.cancelled = true;
    this.playState = "idle";
  }

  pause() {
    this.pauseCalls += 1;
    if (this.playState !== "finished" && this.playState !== "idle") this.playState = "paused";
  }

  play() {
    this.playCalls += 1;
    if (this.playState !== "finished" && this.playState !== "idle") this.playState = "running";
  }

  finish() {
    this.playState = "finished";
    this.resolveFinished();
  }
}

class FakeCard {
  constructor() {
    this.clientWidth = 400;
    this.style = { transform: "", opacity: "" };
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.capturedPointers = new Set();
    this.deferNextAnimation = false;
    this.lastAnimation = null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }

  animate(keyframes, options) {
    this.lastAnimationKeyframes = keyframes;
    this.lastAnimationOptions = options;
    const animation = new FakeAnimation({ deferred: this.deferNextAnimation });
    this.deferNextAnimation = false;
    this.lastAnimation = animation;
    return animation;
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testSwipeLifecycle() {
  const previousWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 900,
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout
  };

  try {
    const card = new FakeCard();
    const decisions = [];
    const controller = new SwipeController(card, {
      onDecision: (direction) => decisions.push(direction)
    });

    const thrown = await controller.throw("ai");
    assert.equal(thrown, true, "throw must complete");
    assert.equal(card.style.opacity, "0", "successful throw must leave old card hidden");
    assert.match(card.style.transform, /translate3d\([1-9]/, "successful throw must leave old card off-screen");
    assert.equal(controller.handoffPending, true, "throw must transfer ownership to card handoff");

    controller.prepareHidden();
    assert.equal(card.style.opacity, "0", "prepareHidden must keep card hidden");
    assert.equal(card.style.transform, "", "prepareHidden must reset geometry while hidden");

    const revealed = await controller.reveal();
    assert.equal(revealed, true, "reveal must complete");
    assert.equal(card.style.opacity, "", "reveal must restore normal card opacity");
    assert.equal(controller.handoffPending, false, "reveal must finish handoff");
    controller.setEnabled(true);

    // A short swipe starts an async return. New pointerdown must be ignored until that
    // return owns/finishes its lifecycle, preventing old cleanup from corrupting a new gesture.
    card.deferNextAnimation = true;
    card.dispatch("pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      isPrimary: true,
      pointerType: "touch"
    });
    assert.equal(card.capturedPointers.has(1), true, "touch pointer must be captured on pointerdown");
    card.dispatch("pointermove", {
      pointerId: 1,
      clientX: 140,
      clientY: 102,
      isPrimary: true,
      pointerType: "touch"
    });
    card.dispatch("pointerup", {
      pointerId: 1,
      clientX: 140,
      clientY: 102,
      isPrimary: true,
      pointerType: "touch"
    });

    assert.equal(controller.returning, true, "short swipe must own a return transition");
    card.dispatch("pointerdown", {
      pointerId: 2,
      clientX: 200,
      clientY: 200,
      isPrimary: true,
      pointerType: "touch"
    });
    assert.equal(controller.activePointerId, null, "pointerdown during return must be ignored");

    card.lastAnimation.finish();
    await flushTasks();
    assert.equal(controller.returning, false, "return transition must release its lock after finish");

    card.dispatch("pointerdown", {
      pointerId: 3,
      clientX: 210,
      clientY: 210,
      isPrimary: true,
      pointerType: "touch"
    });
    assert.equal(controller.activePointerId, 3, "new swipe must work after return finishes");

    card.dispatch("pointercancel", {
      pointerId: 3,
      clientX: 210,
      clientY: 210,
      isPrimary: true,
      pointerType: "touch"
    });
    await flushTasks();
    assert.equal(controller.activePointerId, null);

    card.dispatch("pointerdown", {
      pointerId: 4,
      clientX: 220,
      clientY: 220,
      isPrimary: true,
      pointerType: "touch"
    });
    assert.equal(controller.activePointerId, 4, "swipe must recover after pointercancel");
    assert.equal(card.capturedPointers.has(4), true);

    controller.destroy();

    // V1.6.4: the hint commitment signal must be normalized to the actual decision threshold,
    // without changing the decision threshold itself.
    const progressCard = new FakeCard();
    const progressSamples = [];
    const progressController = new SwipeController(progressCard, {
      onDecision: () => {},
      onProgress: (progress, metadata) => progressSamples.push({ progress, ...metadata })
    });
    progressCard.dispatch("pointerdown", {
      pointerId: 11, clientX: 100, clientY: 100, isPrimary: true, pointerType: "touch"
    });
    progressCard.dispatch("pointermove", {
      pointerId: 11, clientX: 140, clientY: 101, isPrimary: true, pointerType: "touch", cancelable: true, preventDefault() {}
    });
    assert.ok(Math.abs(progressSamples.at(-1).decisionProgress - 0.5) < 0.001,
      "half of the real decision distance must report 0.5 decisionProgress");
    progressCard.dispatch("pointermove", {
      pointerId: 11, clientX: 180, clientY: 101, isPrimary: true, pointerType: "touch", cancelable: true, preventDefault() {}
    });
    assert.equal(progressSamples.at(-1).decisionProgress, 1,
      "the real decision threshold must report fully committed hint progress");
    assert.equal(progressSamples.at(-1).threshold, 80,
      "V1.6.4 hint normalization must preserve the existing 20%-of-card decision threshold");
    progressController.destroy();

    // Reduced-motion keeps the exact same hidden-handoff contract, only with shorter timings.
    globalThis.window.matchMedia = () => ({ matches: true });
    const reducedCard = new FakeCard();
    const reducedController = new SwipeController(reducedCard, { onDecision: () => {} });
    assert.equal(await reducedController.throw("human"), true);
    assert.equal(reducedCard.lastAnimationOptions.duration, 220);
    assert.equal(reducedCard.style.opacity, "0");
    reducedController.prepareHidden();
    assert.equal(await reducedController.reveal(), true);
    assert.equal(reducedCard.lastAnimationOptions.duration, 1);
    assert.equal(reducedCard.style.opacity, "");
    reducedController.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
}

async function testImageReadinessContract() {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout,
    clearTimeout
  };

  class FakeImageElement {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.listeners = new Map();
      this.decodeCalls = 0;
      this._src = "";
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    set src(value) {
      this._src = value;
      this.complete = true;
      this.naturalWidth = 100;
      queueMicrotask(() => {
        for (const listener of this.listeners.get("load") || []) listener();
      });
    }

    get src() {
      return this._src;
    }

    async decode() {
      this.decodeCalls += 1;
    }
  }

  try {
    const image = new FakeImageElement();
    const result = await loadImageIntoElement(image, "./images/AI/example.png", { timeoutMs: 500 });
    assert.equal(result, image);
    assert.equal(image.decodeCalls, 1, "visible image readiness must include decode()");
  } finally {
    globalThis.window = previousWindow;
  }
}



class FakeFeedbackElement {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = new Map();
    this.childAnimations = [];

    const animatedChild = (name, extra = {}) => ({
      ...extra,
      animate: (keyframes, options) => {
        const animation = new FakeAnimation();
        animation.keyframes = keyframes;
        animation.options = options;
        this.childAnimations.push({ name, animation });
        return animation;
      }
    });

    this.children = {
      icon: animatedChild("icon", { textContent: "" }),
      label: { textContent: "" },
      ring: animatedChild("ring"),
      burst: animatedChild("burst"),
      pill: animatedChild("pill")
    };
    this.lastAnimationOptions = null;
  }

  querySelector(selector) {
    if (selector === "[data-feedback-icon]") return this.children.icon;
    if (selector === "[data-feedback-label]") return this.children.label;
    if (selector === "[data-feedback-ring]") return this.children.ring;
    if (selector === "[data-feedback-burst]") return this.children.burst;
    if (selector === "[data-feedback-pill]") return this.children.pill;
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  animate(keyframes, options) {
    this.lastAnimationOptions = options;
    return new FakeAnimation();
  }
}

async function testAnswerFeedbackLifecycle() {
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };

  try {
    const root = new FakeFeedbackElement();
    const feedback = new AnswerFeedbackController(root, { options: { duration: 20 } });

    const promise = feedback.play(false);
    assert.equal(root.children.icon.textContent, "×");
    assert.equal(root.children.label.textContent, "ŹLE");
    assert.equal(root.classList.contains("is-incorrect"), true);
    assert.equal(root.dataset.result, "incorrect");
    assert.equal(root.attributes.get("aria-hidden"), "false");
    assert.deepEqual(root.childAnimations.map(({ name }) => name).sort(), ["burst", "icon", "pill", "ring"],
      "full-motion feedback must animate the dedicated burst, ring, pill and icon channels");
    assert.equal(await promise, true);
    assert.equal(root.attributes.get("aria-hidden"), "true");
    assert.equal(root.children.label.textContent, "");

    globalThis.window.matchMedia = () => ({ matches: true });
    const reducedRoot = new FakeFeedbackElement();
    const reduced = new AnswerFeedbackController(reducedRoot, {
      options: { duration: 430, reducedDuration: 1 }
    });
    assert.equal(await reduced.play(true), true);
    assert.equal(reducedRoot.lastAnimationOptions.duration, 1);
  } finally {
    globalThis.window = previousWindow;
  }
}

async function copyRuntimeFixture(targetRoot) {
  for (const entry of ["index.html", "css", "js", "admin", "assets"]) {
    await fs.cp(path.join(projectRoot, entry), path.join(targetRoot, entry), { recursive: true });
  }
}

function testSlidingPillGeometry() {
  const geometry = normalizeGeometry({ left: 115, top: 5, width: 102, height: 42 });
  assert.deepEqual(geometry, { left: 115, top: 5, width: 102, height: 42 });
  assert.equal(getIndicatorTransform(geometry), "translate3d(115px, 5px, 0)");
}

async function testSlidingPillLifecycle() {
  const previousWindow = globalThis.window;
  const previousResizeObserver = globalThis.ResizeObserver;

  class FakeNode {
    constructor() {
      this.classList = new FakeClassList();
      this.style = {};
      this.disabled = false;
    }
  }

  class FakeButton extends FakeNode {
    constructor(value, left) {
      super();
      this.dataset = { sessionSize: String(value) };
      this.offsetLeft = left;
      this.offsetTop = 5;
      this.offsetWidth = 102;
      this.offsetHeight = 42;
    }
  }

  class FakeRoot extends FakeNode {
    constructor() {
      super();
      this.buttons = [new FakeButton(10, 5), new FakeButton(20, 115), new FakeButton(50, 225)];
      this.indicator = new FakeNode();
      this.clientWidth = 332;
      this.clientHeight = 52;
    }

    querySelectorAll(selector) {
      return selector === "[data-session-size]" ? this.buttons : [];
    }

    querySelector(selector) {
      if (selector === "[data-session-indicator]") return this.indicator;
      return null;
    }

    getClientRects() {
      return [this.getBoundingClientRect()];
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }
  }

  let reduced = false;
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  let disconnectCount = 0;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() { disconnectCount += 1; }
  };

  try {
    const root = new FakeRoot();
    const picker = new SessionSizePicker(root, {
      options: { slideDuration: 360 }
    });

    assert.equal(picker.sync(20), true);
    assert.equal(root.classList.contains("is-enhanced"), true);
    assert.equal(root.buttons[1].classList.contains("is-selected"), true);
    assert.equal(root.indicator.style.transform, "translate3d(115px, 5px, 0)");
    assert.equal(root.indicator.style.width, "102px");
    assert.equal(root.indicator.style.height, "42px");
    assert.equal(root.indicator.style.transitionDuration, "0ms",
      "initial placement must snap without an entrance animation");

    assert.equal(picker.sync(50, { animate: true }), true);
    assert.equal(root.buttons[2].classList.contains("is-selected"), true);
    assert.equal(root.indicator.style.transform, "translate3d(225px, 5px, 0)");
    assert.equal(root.indicator.style.transitionDuration, "360ms",
      "user selection must use the configured slide duration");

    picker.sync(10, { animate: true });
    picker.sync(20, { animate: true });
    assert.equal(root.indicator.style.transform, "translate3d(115px, 5px, 0)",
      "rapid retarget must leave the latest target geometry on the indicator");
    assert.equal(root.buttons[1].classList.contains("is-selected"), true,
      "rapid retarget must leave the latest target selected");

    reduced = true;
    picker.sync(10, { animate: true });
    assert.equal(root.indicator.style.transitionDuration, "0ms",
      "reduced motion must snap instead of sliding");
    assert.equal(root.indicator.style.transform, "translate3d(5px, 5px, 0)");
    assert.equal(root.buttons[0].classList.contains("is-selected"), true);

    picker.destroy();
    assert.equal(disconnectCount, 1, "destroy must disconnect ResizeObserver");
  } finally {
    globalThis.window = previousWindow;
    globalThis.ResizeObserver = previousResizeObserver;
  }
}

function testSessionConfig() {
  assert.deepEqual(SESSION_SIZE_OPTIONS, [10, 20, 50]);
  assert.equal(MIN_SESSION_SIZE, 10);
  assert.equal(DEFAULT_SESSION_SIZE, 20);
  assert.equal(resolveSessionSize(9), null);
  assert.equal(resolveSessionSize(10), 10);
  assert.equal(resolveSessionSize(19), 10);
  assert.equal(resolveSessionSize(20), 20);
  assert.equal(resolveSessionSize(49), 20);
  assert.equal(resolveSessionSize(50), 20);
  assert.equal(resolveSessionSize(60, 50), 50);
  assert.equal(isSessionSizeAvailable(10, 10), true);
  assert.equal(isSessionSizeAvailable(20, 19), false);
  assert.equal(isSessionSizeAvailable(50, 60), true);
  assert.equal(isSessionSizeAvailable(30, 60), false);
}

async function testDynamicRoundPreloader() {
  const previousWindow = globalThis.window;
  const previousImage = globalThis.Image;

  class FakePreloadImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    set src(value) {
      this._src = value;
      this.complete = true;
      this.naturalWidth = 100;
      queueMicrotask(() => {
        for (const listener of this.listeners.get("load") || []) listener();
      });
    }

    async decode() {}
  }

  globalThis.window = { setTimeout, clearTimeout };
  globalThis.Image = FakePreloadImage;

  try {
    const selector = new RoundSelector(makeImages(60, "ai"), { rng: createSeededRng(99) });
    const preloader = new RoundPreloader(selector, { concurrency: 4, timeoutMs: 500 });

    for (const [roundNumber, roundSize] of [[1, 10], [2, 20], [3, 50]]) {
      const deck = await preloader.prepare(roundNumber, { roundSize });
      assert.equal(deck.length, roundSize);
      assert.equal(new Set(deck.map((item) => item.id)).size, roundSize);
    }
  } finally {
    globalThis.window = previousWindow;
    globalThis.Image = previousImage;
  }
}

async function testRoundSelector() {
  const mixed = [
    ...makeImages(30, "ai"),
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `human-${index}`,
      src: `./images/HUMAN/${index}.svg`,
      type: "human"
    }))
  ];

  const selector = new RoundSelector(mixed, { rng: createSeededRng(42) });
  const round = selector.select(20, { roundNumber: 1 });
  assert.equal(round.length, 20, "round must contain exactly 20 images");
  assert.equal(new Set(round.map((item) => item.id)).size, 20, "round IDs must be unique");

  const ten = selector.select(10, { roundNumber: 1 });
  assert.equal(ten.length, 10, "10-image session must contain exactly 10 images");
  assert.equal(new Set(ten.map((item) => item.id)).size, 10);

  const fifty = selector.select(50, { roundNumber: 1 });
  assert.equal(fifty.length, 50, "50-image session must contain exactly 50 images");
  assert.equal(new Set(fifty.map((item) => item.id)).size, 50);

  const allAiSelector = new RoundSelector(makeImages(25, "ai"), { rng: createSeededRng(11) });
  const allAiRound = allAiSelector.select(20, { roundNumber: 1 });
  assert.equal(allAiRound.length, 20, "selection must not require a 10/10 class split");
  assert.ok(allAiRound.every((item) => item.type === "ai"), "class ratio must not be forced");

  assert.equal(recencyWeight(null), 1);
  assert.equal(recencyWeight(1), 0.15);
  assert.equal(recencyWeight(2), 0.35);
  assert.equal(recencyWeight(3), 0.60);
  assert.equal(recencyWeight(4), 1);

  const repeatSelector = new RoundSelector(makeImages(20, "ai"), { rng: createSeededRng(5) });
  const first = repeatSelector.select(20, { roundNumber: 1 });
  first.forEach((item) => repeatSelector.recordExposure(item.id, 1));
  const second = repeatSelector.select(20, { roundNumber: 2 });
  assert.equal(second.length, 20, "previous-round images must remain eligible");
  assert.equal(new Set(second.map((item) => item.id)).size, 20);

  const weightedImages = makeImages(40, "ai");
  const weightedSelector = new RoundSelector(weightedImages, { rng: createSeededRng(42) });
  for (let i = 0; i < 20; i += 1) weightedSelector.recordExposure(`img-${i}`, 1);
  const weightedRound = weightedSelector.select(20, { roundNumber: 2 });
  const immediateRepeats = weightedRound.filter((item) => Number(item.id.slice(4)) < 20).length;
  assert.ok(immediateRepeats < 10, "previous-round images should be statistically deprioritized");

  const refreshedSelector = new RoundSelector(weightedImages, { rng: createSeededRng(42) });
  assert.equal(refreshedSelector.getWeight("img-0", 1), 1, "new page session must start with neutral weights");

  const excluded = new Set(["img-0", "img-1", "img-2"]);
  const exclusionRound = allAiSelector.select(20, { roundNumber: 1, excludeIds: excluded });
  assert.ok(exclusionRound.every((item) => !excluded.has(item.id)), "excluded IDs must not be selected");
}


function makeJsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function makeSupabaseRow(index, type = index % 2 === 0 ? "ai" : "human") {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    content_class: type,
    storage_bucket: "game-images",
    storage_path: `${type}/folder ${Math.floor(index / 100)}/obraz #${index}.avif`,
    created_at: `2026-09-28T00:${String(index % 60).padStart(2, "0")}:00Z`
  };
}

async function testExternalContentSource() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co/",
    publishableKey: "sb_publishable_test_public_key"
  };

  const resolved = resolveSupabasePublicConfig(config);
  assert.equal(resolved.configured, true);
  assert.equal(resolved.projectUrl, "https://abcdefghijklmnopqrst.supabase.co");

  assert.equal(resolveSupabasePublicConfig({ projectUrl: "", publishableKey: "" }).configured, false);
  assert.throws(
    () => resolveSupabasePublicConfig({
      projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_secret_NEVER_IN_BROWSER"
    }),
    (error) => error?.code === "SUPABASE_SECRET_KEY_FORBIDDEN"
  );
  assert.throws(
    () => resolveSupabasePublicConfig({ projectUrl: "http://bad.example", publishableKey: "sb_publishable_test" }),
    (error) => error?.code === "SUPABASE_URL_INVALID"
  );
  assert.throws(
    () => resolveSupabasePublicConfig({ projectUrl: "https://example.com/not-project-root", publishableKey: "sb_publishable_test" }),
    (error) => error?.code === "SUPABASE_URL_INVALID"
  );

  const encodedUrl = buildPublicStorageUrl(
    resolved.projectUrl,
    "game-images",
    "human/Zażółć gęślą #1.avif"
  );
  assert.equal(
    encodedUrl,
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/game-images/human/Za%C5%BC%C3%B3%C5%82%C4%87%20g%C4%99%C5%9Bl%C4%85%20%231.avif"
  );

  // Simulate an API max-row setting LOWER than our requested 1000 rows.
  // The client must keep paging until an empty page, not stop on a short page.
  const allRows = Array.from({ length: 1205 }, (_, index) => makeSupabaseRow(index));
  const apiPageCap = 400;
  const requestedOffsets = [];
  const headersSeen = [];

  const pagedFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/game_images");
    assert.equal(url.searchParams.has("is_active"), false, "active-row filtering must stay in RLS so anon need not SELECT is_active");
    assert.equal(url.searchParams.get("order"), "created_at.asc,id.asc");
    assert.equal(url.searchParams.get("select"), "id,content_class,storage_bucket,storage_path,created_at");
    assert.equal(url.searchParams.get("limit"), "1000");
    const offset = Number(url.searchParams.get("offset"));
    requestedOffsets.push(offset);
    headersSeen.push(options.headers);
    return makeJsonResponse(allRows.slice(offset, offset + apiPageCap));
  };

  const externalImages = await fetchSupabaseImages({ config, fetchImpl: pagedFetch });
  assert.equal(externalImages.length, 1205, "external catalog must have no 1000-row client ceiling");
  assert.deepEqual(requestedOffsets, [0, 400, 800, 1200, 1205]);
  assert.ok(headersSeen.every((headers) => headers.apikey === config.publishableKey));
  assert.ok(headersSeen.every((headers) => !("Authorization" in headers)),
    "publishable key must use apikey header, not Authorization bearer");
  assert.equal(externalImages[0].type, "ai");
  assert.ok(externalImages[1].src.includes("/human/"));
  assert.ok(externalImages[1].src.endsWith("obraz%20%231.avif"));

  let requestCount = 0;
  const manifest = await loadContentManifest({
    config,
    minimumImageCount: 10,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/game_images");
      requestCount += 1;
      const offset = Number(url.searchParams.get("offset"));
      return makeJsonResponse(offset === 0 ? allRows.slice(0, 12) : []);
    }
  });
  assert.equal(manifest.source, "supabase");
  assert.equal(manifest.manifest.images.length, 12);
  assert.equal(requestCount, 2);
  assert.equal(Object.hasOwn(manifest, "fallbackReason"), false,
    "permanent Supabase source must not expose repository fallback state");

  let smallPoolRequests = 0;
  await assert.rejects(
    () => loadContentManifest({
      config,
      minimumImageCount: 10,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/rest/v1/game_images");
        smallPoolRequests += 1;
        const offset = Number(url.searchParams.get("offset"));
        return makeJsonResponse(offset === 0 ? allRows.slice(0, 9) : []);
      }
    }),
    (error) => error?.code === "SUPABASE_POOL_TOO_SMALL"
  );
  assert.equal(smallPoolRequests, 2, "small pool must fail at Supabase, not request a repository fallback");

  let unconfiguredFetchCalled = false;
  await assert.rejects(
    () => loadContentManifest({
      config: { projectUrl: "", publishableKey: "" },
      fetchImpl: async () => {
        unconfiguredFetchCalled = true;
        return makeJsonResponse([]);
      }
    }),
    (error) => error?.code === "SUPABASE_NOT_CONFIGURED"
  );
  assert.equal(unconfiguredFetchCalled, false);

  await assert.rejects(
    () => fetchSupabaseImages({
      config,
      fetchImpl: async () => makeJsonResponse({ message: "denied" }, { status: 401 })
    }),
    (error) => error?.code === "SUPABASE_HTTP_ERROR"
  );

  await assert.rejects(
    () => fetchSupabaseImages({
      config,
      fetchImpl: async () => makeJsonResponse([
        { ...makeSupabaseRow(0), content_class: "human", storage_path: "ai/bad.avif" }
      ])
    }),
    (error) => error?.code === "SUPABASE_ROW_INVALID"
  );

  const duplicateRows = [makeSupabaseRow(0), makeSupabaseRow(0)];
  await assert.rejects(
    () => fetchSupabaseImages({
      config,
      fetchImpl: async (input) => {
        const offset = Number(new URL(String(input)).searchParams.get("offset"));
        return makeJsonResponse(offset === 0 ? duplicateRows : []);
      }
    }),
    (error) => error?.code === "SUPABASE_DUPLICATE_ID"
  );
}


class MemorySessionStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

async function testAdminAuthContract() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };

  const authUser = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@example.com"
  };

  const sessionPayload = {
    access_token: "access-token-1",
    refresh_token: "refresh-token-1",
    expires_in: 3600,
    user: authUser
  };

  const requests = [];
  const signInFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });

    assert.equal(url.pathname, "/auth/v1/token");
    assert.equal(url.searchParams.get("grant_type"), "password");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.apikey, config.publishableKey);
    assert.equal("Authorization" in options.headers, false);
    assert.deepEqual(JSON.parse(options.body), {
      email: "admin@example.com",
      password: "correct-password"
    });

    return makeJsonResponse(sessionPayload);
  };

  const signedIn = await signInWithPassword({
    email: " admin@example.com ",
    password: "correct-password",
    config,
    fetchImpl: signInFetch
  });

  assert.equal(signedIn.user.id, authUser.id);
  assert.equal(signedIn.user.email, authUser.email);
  assert.equal(requests.length, 1);

  const storage = new MemorySessionStorage();
  saveAdminSession(signedIn, storage);
  assert.ok(storage.getItem(ADMIN_SESSION_STORAGE_KEY));
  assert.ok(!storage.getItem(ADMIN_SESSION_STORAGE_KEY).includes("correct-password"),
    "admin password must never be persisted");
  assert.equal(loadAdminSession(storage).user.id, authUser.id);
  clearAdminSession(storage);
  assert.equal(loadAdminSession(storage), null);

  const authFlowRequests = [];
  const authorizedFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    authFlowRequests.push({ url, options });

    if (url.pathname === "/auth/v1/user") {
      assert.equal(options.headers.apikey, config.publishableKey);
      assert.equal(options.headers.Authorization, "Bearer access-token-1");
      return makeJsonResponse(authUser);
    }

    if (url.pathname === "/rest/v1/rpc/is_current_user_admin") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer access-token-1");
      assert.equal(options.headers.apikey, config.publishableKey);
      assert.equal(options.body, "{}");
      return makeJsonResponse(true);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const authorized = await authorizeAdminSession({
    session: signedIn,
    config,
    fetchImpl: authorizedFetch
  });
  assert.equal(authorized.user.email, "admin@example.com");
  assert.deepEqual(
    authFlowRequests.map(({ url }) => url.pathname),
    ["/auth/v1/user", "/rest/v1/rpc/is_current_user_admin"]
  );

  await assert.rejects(
    () => verifyAdminAuthority({
      session: signedIn,
      config,
      fetchImpl: async () => makeJsonResponse(false)
    }),
    (error) => error instanceof AdminAuthError && error.code === "ADMIN_FORBIDDEN"
  );

  // Expired access token must refresh, revalidate the user and only then check
  // private.admin_users through the RPC.
  const refreshSequence = [];
  const refreshingFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    refreshSequence.push(url.pathname + (url.search ? url.search : ""));

    if (url.pathname === "/auth/v1/user" && options.headers.Authorization === "Bearer expired-token") {
      return makeJsonResponse({ error_code: "bad_jwt" }, { status: 401 });
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      assert.deepEqual(JSON.parse(options.body), { refresh_token: "refresh-token-old" });
      return makeJsonResponse({
        access_token: "refreshed-token",
        refresh_token: "refresh-token-new",
        expires_in: 3600,
        user: authUser
      });
    }

    if (url.pathname === "/auth/v1/user" && options.headers.Authorization === "Bearer refreshed-token") {
      return makeJsonResponse(authUser);
    }

    if (url.pathname === "/rest/v1/rpc/is_current_user_admin") {
      assert.equal(options.headers.Authorization, "Bearer refreshed-token");
      return makeJsonResponse(true);
    }

    throw new Error(`Unexpected refresh request: ${url}`);
  };

  const refreshed = await authorizeAdminSession({
    session: {
      access_token: "expired-token",
      refresh_token: "refresh-token-old",
      expires_at: 1,
      user: authUser
    },
    config,
    fetchImpl: refreshingFetch
  });
  assert.equal(refreshed.access_token, "refreshed-token");
  assert.equal(refreshed.refresh_token, "refresh-token-new");
  assert.deepEqual(refreshSequence, [
    "/auth/v1/token?grant_type=refresh_token",
    "/auth/v1/user",
    "/rest/v1/rpc/is_current_user_admin"
  ]);


assert.equal(
  shouldRefreshAdminSession({ expires_at: 1000 }, { nowMs: 900_000, marginSeconds: 180 }),
  true,
  "session inside refresh margin must refresh proactively"
);
assert.equal(
  shouldRefreshAdminSession({ expires_at: 2000 }, { nowMs: 900_000, marginSeconds: 180 }),
  false,
  "healthy session must not refresh unnecessarily"
);

const forbiddenAuthSequence = [];
const auth403Refreshed = await authorizeAdminSession({
  session: {
    access_token: "stale-403-token",
    refresh_token: "refresh-403-old",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: authUser
  },
  config,
  fetchImpl: async (input, options = {}) => {
    const url = new URL(String(input));
    forbiddenAuthSequence.push(url.pathname + (url.search ? url.search : ""));
    if (url.pathname === "/auth/v1/user" && options.headers.Authorization === "Bearer stale-403-token") {
      return makeJsonResponse({ error_code: "bad_jwt" }, { status: 403 });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      assert.deepEqual(JSON.parse(options.body), { refresh_token: "refresh-403-old" });
      return makeJsonResponse({
        access_token: "fresh-403-token",
        refresh_token: "refresh-403-new",
        expires_in: 3600,
        user: authUser
      });
    }
    if (url.pathname === "/auth/v1/user" && options.headers.Authorization === "Bearer fresh-403-token") {
      return makeJsonResponse(authUser);
    }
    if (url.pathname === "/rest/v1/rpc/is_current_user_admin") {
      assert.equal(options.headers.Authorization, "Bearer fresh-403-token");
      return makeJsonResponse(true);
    }
    throw new Error(`Unexpected 403 refresh request: ${url}`);
  }
});
assert.equal(auth403Refreshed.access_token, "fresh-403-token");
assert.deepEqual(forbiddenAuthSequence, [
  "/auth/v1/user",
  "/auth/v1/token?grant_type=refresh_token",
  "/auth/v1/user",
  "/rest/v1/rpc/is_current_user_admin"
]);

const batchRefreshCalls = [];
const batchFresh = await ensureFreshAdminSession({
  session: {
    access_token: "batch-old-token",
    refresh_token: "batch-refresh-old",
    expires_at: 1000,
    user: authUser
  },
  config,
  nowMs: 900_000,
  marginSeconds: 180,
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    batchRefreshCalls.push(url.pathname + (url.search ? url.search : ""));
    if (url.pathname === "/auth/v1/token") {
      return makeJsonResponse({
        access_token: "batch-new-token",
        refresh_token: "batch-refresh-new",
        expires_in: 3600,
        user: authUser
      });
    }
    if (url.pathname === "/auth/v1/user") return makeJsonResponse(authUser);
    if (url.pathname === "/rest/v1/rpc/is_current_user_admin") return makeJsonResponse(true);
    throw new Error(`Unexpected batch refresh request: ${url}`);
  }
});
assert.equal(batchFresh.access_token, "batch-new-token");
assert.deepEqual(batchRefreshCalls, [
  "/auth/v1/token?grant_type=refresh_token",
  "/auth/v1/user",
  "/rest/v1/rpc/is_current_user_admin"
]);

let forbiddenRefreshCalls = 0;
await assert.rejects(
  () => authorizeAdminSession({
    session: {
      ...signedIn,
      expires_at: Math.floor(Date.now() / 1000) + 3600
    },
    config,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") return makeJsonResponse(authUser);
      if (url.pathname === "/rest/v1/rpc/is_current_user_admin") return makeJsonResponse(false);
      if (url.pathname === "/auth/v1/token") {
        forbiddenRefreshCalls += 1;
        throw new Error("ADMIN_FORBIDDEN must not trigger refresh");
      }
      throw new Error(`Unexpected admin-forbidden request: ${url}`);
    }
  }),
  (error) => error instanceof AdminAuthError && error.code === "ADMIN_FORBIDDEN"
);
assert.equal(forbiddenRefreshCalls, 0);

  const logoutRequests = [];
  await signOutAdmin({
    session: signedIn,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      logoutRequests.push({ url, options });
      return {
        ok: true,
        status: 204,
        async json() { throw new Error("204 has no JSON"); }
      };
    }
  });
  assert.equal(logoutRequests[0].url.pathname, "/auth/v1/logout");
  assert.equal(logoutRequests[0].url.searchParams.get("scope"), "local");
  assert.equal(logoutRequests[0].options.headers.Authorization, "Bearer access-token-1");
}


async function testAvifConversionContracts() {
  const source = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
  Object.defineProperty(source, "name", { value: "fixture.png" });

  const validated = validateSourceFile(source);
  assert.equal(validated.filename, "fixture.png");
  assert.equal(validated.mimeType, "image/png");

  const hash = await sha256Blob(source);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await sha256Blob(source));

  const inspection = await inspectSourceFile(source);
  assert.equal(inspection.sha256, hash);
  assert.equal(inspection.filename, "fixture.png");

  const encoded = await encodeImageDataToAvif(
    { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 },
    { encoderLoader: async () => async () => new Uint8Array([9, 8, 7, 6]) }
  );
  assert.equal(encoded.type, "image/avif");
  assert.equal(encoded.size, 4);

  const exactAvifBytes = new Uint8Array([11, 22, 33, 44, 55, 66]);
  const avifSource = new Blob([exactAvifBytes], { type: "image/avif" });
  Object.defineProperty(avifSource, "name", { value: "fixture.avif" });

  let encoderLoadCount = 0;
  let decoderCloseCount = 0;
  const avifPrepared = await convertSourceFileToAvif(avifSource, {
    decoder: async () => ({
      width: 320,
      height: 180,
      close() { decoderCloseCount += 1; }
    }),
    encoderLoader: async () => {
      encoderLoadCount += 1;
      throw new Error("AVIF passthrough must never load the encoder");
    }
  });

  assert.equal(avifPrepared.output.passthrough, true);
  assert.equal(avifPrepared.output.mimeType, "image/avif");
  assert.equal(avifPrepared.output.size, exactAvifBytes.byteLength);
  assert.equal(avifPrepared.output.sha256, avifPrepared.source.sha256);
  assert.equal(encoderLoadCount, 0, "existing AVIF must bypass the encoder");
  assert.equal(decoderCloseCount, 1, "AVIF validation decoder must be released");
  assert.deepEqual(
    new Uint8Array(await avifPrepared.output.blob.arrayBuffer()),
    exactAvifBytes,
    "AVIF passthrough must remain byte-identical"
  );

  const previousDocument = globalThis.document;
  try {
    globalThis.document = {
      createElement(tagName) {
        assert.equal(tagName, "canvas");
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() {
                return {
                  data: new Uint8ClampedArray([0, 0, 0, 255]),
                  width: 1,
                  height: 1
                };
              }
            };
          }
        };
      }
    };

    const pngSource = new Blob([new Uint8Array([1, 3, 5, 7])], { type: "image/png" });
    Object.defineProperty(pngSource, "name", { value: "fixture.png" });
    let pngEncoderLoadCount = 0;
    const pngPrepared = await convertSourceFileToAvif(pngSource, {
      decoder: async () => ({ width: 1, height: 1, close() {} }),
      verifyOutput: false,
      encoderLoader: async () => {
        pngEncoderLoadCount += 1;
        return async () => new Uint8Array([8, 6, 4, 2]);
      }
    });

    assert.equal(pngEncoderLoadCount, 1, "non-AVIF sources must still use the encoder");
    assert.equal(pngPrepared.output.passthrough, false);
    assert.notEqual(pngPrepared.output.sha256, pngPrepared.source.sha256);
  } finally {
    globalThis.document = previousDocument;
  }

  const landscapeGeometry = calculateInventoryPreviewGeometry(1600, 900);
  assert.equal(landscapeGeometry.sourceX, 200);
  assert.equal(landscapeGeometry.sourceY, 0);
  assert.equal(landscapeGeometry.cropWidth, 1200);
  assert.equal(landscapeGeometry.cropHeight, 900);
  assert.equal(landscapeGeometry.outputWidth, INVENTORY_PREVIEW_MAX_WIDTH);
  assert.equal(landscapeGeometry.outputHeight, INVENTORY_PREVIEW_MAX_HEIGHT);

  const portraitGeometry = calculateInventoryPreviewGeometry(900, 1600);
  assert.equal(portraitGeometry.sourceX, 0);
  assert.equal(portraitGeometry.sourceY, 462.5);
  assert.equal(portraitGeometry.cropWidth, 900);
  assert.equal(portraitGeometry.cropHeight, 675);
  assert.equal(portraitGeometry.outputWidth, 640);
  assert.equal(portraitGeometry.outputHeight, 480);

  const smallGeometry = calculateInventoryPreviewGeometry(320, 240);
  assert.equal(smallGeometry.outputWidth, 320, "small assets must not be upscaled");
  assert.equal(smallGeometry.outputHeight, 240, "small assets must not be upscaled");

  let previewDrawArgs = null;
  let previewDecoderClosed = 0;
  try {
    globalThis.document = {
      createElement(tagName) {
        assert.equal(tagName, "canvas");
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage(...args) { previewDrawArgs = args; },
              getImageData(x, y, width, height) {
                assert.deepEqual([x, y, width, height], [0, 0, 640, 480]);
                return {
                  data: new Uint8ClampedArray([0, 0, 0, 255]),
                  width,
                  height
                };
              }
            };
          }
        };
      }
    };

    const productionAvif = new Blob([new Uint8Array([7, 7, 7])], { type: "image/avif" });
    const preview = await createInventoryPreviewAvif(productionAvif, {
      verifyOutput: false,
      decoder: async () => ({
        width: 1600,
        height: 900,
        close() { previewDecoderClosed += 1; }
      }),
      encoderLoader: async () => async (imageData) => {
        assert.equal(imageData.width, 640);
        assert.equal(imageData.height, 480);
        return new Uint8Array([5, 4, 3, 2, 1]);
      }
    });

    assert.equal(preview.width, 640);
    assert.equal(preview.height, 480);
    assert.equal(preview.blob.type, "image/avif");
    assert.equal(previewDecoderClosed, 1, "preview decoder must be released");
    assert.ok(previewDrawArgs, "preview must draw the center-cropped source");
    assert.deepEqual(previewDrawArgs.slice(1), [200, 0, 1200, 900, 0, 0, 640, 480]);
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 ** 3), "1.00 GB");
  assert.ok(AVIF_ENCODER_MODULE_URL.includes("@jsquash/avif@2.1.1"));

  const bad = new Blob([new Uint8Array([1])], { type: "text/plain" });
  Object.defineProperty(bad, "name", { value: "not-image.txt" });
  assert.throws(
    () => validateSourceFile(bad),
    (error) => error.code === "SOURCE_TYPE_UNSUPPORTED"
  );
}

async function testAdminStorageUsageContract() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };
  const session = { access_token: "admin-access-token" };

  let requestCount = 0;
  const usage = await getAdminStorageUsage({
    session,
    config,
    fetchImpl: async (input, options = {}) => {
      requestCount += 1;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/get_admin_storage_usage");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.equal(options.headers.apikey, config.publishableKey);
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.equal(options.body, "{}");
      return makeJsonResponse({
        used_bytes: 268435456,
        quota_bytes: 1073741824,
        remaining_bytes: 805306368,
        usage_percent: 25
      });
    }
  });

  assert.equal(requestCount, 1);
  assert.deepEqual(usage, {
    usedBytes: 268435456,
    quotaBytes: 1073741824,
    remainingBytes: 805306368,
    usagePercent: 25
  });

  await assert.rejects(
    () => getAdminStorageUsage({
      session,
      config,
      fetchImpl: async () => makeJsonResponse({
        used_bytes: "broken",
        quota_bytes: 1073741824,
        remaining_bytes: 0,
        usage_percent: 0
      })
    }),
    (error) => error instanceof AdminContentError && error.code === "STORAGE_USAGE_RESPONSE_INVALID"
  );

  await assert.rejects(
    () => getAdminStorageUsage({
      session: null,
      config,
      fetchImpl: async () => {
        throw new Error("must not fetch");
      }
    }),
    (error) => error instanceof AdminContentError && error.code === "CONTENT_SESSION_MISSING"
  );
}

async function testAdminContentUploadContracts() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };

  const session = { access_token: "admin-access-token" };

  const prepared = {
    source: {
      filename: "photo.jpg",
      size: 1200,
      sha256: "a".repeat(64)
    },
    output: {
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/avif" }),
      size: 3,
      sha256: "b".repeat(64),
      width: 1200,
      height: 800
    }
  };
  const inventoryPreview = {
    blob: new Blob([new Uint8Array([9, 8])], { type: "image/avif" }),
    size: 2,
    width: 640,
    height: 480
  };

  const originalPath = "ai/11111111-1111-4111-8111-111111111111.avif";
  const thumbnailPath = "ai/_previews/v1/11111111-1111-4111-8111-111111111111.avif";

  assert.equal(
    createStoragePath("ai", { uuid: "11111111-1111-4111-8111-111111111111" }),
    originalPath
  );
  assert.equal(createThumbnailStoragePath(originalPath), thumbnailPath);
  assert.equal(
    createThumbnailStoragePath("human/nested/asset.avif"),
    "human/_previews/v1/nested/asset.avif"
  );
  assert.throws(
    () => createThumbnailStoragePath("ai/_previews/v1/already.avif"),
    (error) => error.code === "THUMBNAIL_PATH_SOURCE_INVALID"
  );

  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });

    if (url.pathname === "/rest/v1/game_images" && options.method !== "POST") {
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.equal(options.headers.apikey, config.publishableKey);
      return makeJsonResponse([]);
    }

    if (url.pathname === `/storage/v1/object/game-images/${originalPath}`) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "image/avif");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.equal(options.headers["x-upsert"], undefined, "normal original upload must never upsert");
      assert.equal(options.body.type, "image/avif");
      return makeJsonResponse({ Key: "original-ok" });
    }

    if (url.pathname === `/storage/v1/object/game-images/${thumbnailPath}`) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-upsert"], undefined, "normal derived upload must never upsert");
      assert.equal(options.body.type, "image/avif");
      return makeJsonResponse({ Key: "preview-ok" });
    }

    if (url.pathname === "/rest/v1/game_images" && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.content_class, "ai");
      assert.equal(body.storage_bucket, "game-images");
      assert.equal(body.storage_path, originalPath);
      assert.equal(body.thumbnail_path, thumbnailPath);
      assert.equal(body.original_filename, "photo.jpg");
      assert.equal(body.source_sha256, "a".repeat(64));
      assert.equal(body.avif_sha256, "b".repeat(64));
      assert.equal(Object.hasOwn(body, "is_active"), false,
        "browser must not own publication state on INSERT");
      assert.equal(body.file_size_bytes, 3);
      return makeJsonResponse([{ id: "row-1", ...body, is_active: true }]);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await registerPreparedImage({
    session,
    contentClass: "ai",
    prepared,
    inventoryPreview,
    sourceHashPreflightDone: true,
    config,
    fetchImpl,
    storagePathFactory: () => originalPath
  });

  assert.equal(result.row.id, "row-1");
  assert.equal(result.row.is_active, true, "permanent production upload should return an active row");
  assert.equal(result.thumbnailPath, thumbnailPath);
  assert.equal(requests.length, 4, "preflight + original + derived asset + metadata are required");
  const hashRequests = requests.filter(({ url, options }) =>
    url.pathname === "/rest/v1/game_images" && options.method !== "POST"
  );
  assert.equal(hashRequests.length, 1);
  assert.equal(hashRequests[0].url.searchParams.get("avif_sha256"), `eq.${"b".repeat(64)}`);

  const previewFailureDeletes = [];
  await assert.rejects(
    () => registerPreparedImage({
      session,
      contentClass: "human",
      prepared: {
        ...prepared,
        source: { ...prepared.source, sha256: "c".repeat(64) },
        output: { ...prepared.output, sha256: "d".repeat(64) }
      },
      inventoryPreview,
      sourceHashPreflightDone: true,
      config,
      storagePathFactory: () => "human/22222222-2222-4222-8222-222222222222.avif",
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/game_images" && options.method !== "POST") return makeJsonResponse([]);
        if (url.pathname === "/storage/v1/object/game-images/human/22222222-2222-4222-8222-222222222222.avif") {
          return makeJsonResponse({ Key: "original-ok" });
        }
        if (url.pathname === "/storage/v1/object/game-images/human/_previews/v1/22222222-2222-4222-8222-222222222222.avif") {
          return makeJsonResponse({ code: "preview_upload_failed", message: "simulated" }, { status: 500 });
        }
        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          previewFailureDeletes.push(JSON.parse(options.body).prefixes[0]);
          return makeJsonResponse([{ name: "removed" }]);
        }
        throw new Error(`Unexpected preview-failure request: ${url}`);
      }
    }),
    (error) => error.code === "preview_upload_failed"
  );
  assert.deepEqual(
    previewFailureDeletes,
    ["human/22222222-2222-4222-8222-222222222222.avif"],
    "failed derived upload must clean the already-written production original"
  );

  const cleanupPaths = [];
  await assert.rejects(
    () => registerPreparedImage({
      session,
      contentClass: "human",
      prepared: {
        ...prepared,
        source: { ...prepared.source, sha256: "e".repeat(64) },
        output: { ...prepared.output, sha256: "f".repeat(64) }
      },
      inventoryPreview,
      sourceHashPreflightDone: true,
      config,
      storagePathFactory: () => "human/33333333-3333-4333-8333-333333333333.avif",
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/game_images" && options.method !== "POST") return makeJsonResponse([]);
        if (url.pathname.startsWith("/storage/v1/object/game-images/human/") && options.method === "POST") {
          return makeJsonResponse({ Key: "ok" });
        }
        if (url.pathname === "/rest/v1/game_images" && options.method === "POST") {
          return makeJsonResponse({ code: "23505", message: "duplicate key" }, { status: 409 });
        }
        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          cleanupPaths.push(JSON.parse(options.body).prefixes[0]);
          return makeJsonResponse([{ name: "removed" }]);
        }
        throw new Error(`Unexpected metadata-failure request: ${url}`);
      }
    }),
    (error) => error.code === "23505"
  );

  assert.deepEqual(cleanupPaths, [
    "human/_previews/v1/33333333-3333-4333-8333-333333333333.avif",
    "human/33333333-3333-4333-8333-333333333333.avif"
  ], "metadata failure must attempt cleanup of both owned Storage objects");

  const cleanupAttempted = [];
  await assert.rejects(
    () => registerPreparedImage({
      session,
      contentClass: "ai",
      prepared: {
        ...prepared,
        source: { ...prepared.source, sha256: "1".repeat(64) },
        output: { ...prepared.output, sha256: "2".repeat(64) }
      },
      inventoryPreview,
      sourceHashPreflightDone: true,
      config,
      storagePathFactory: () => "ai/44444444-4444-4444-8444-444444444444.avif",
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/game_images" && options.method !== "POST") return makeJsonResponse([]);
        if (url.pathname.startsWith("/storage/v1/object/game-images/ai/") && options.method === "POST") return makeJsonResponse({ Key: "ok" });
        if (url.pathname === "/rest/v1/game_images" && options.method === "POST") {
          return makeJsonResponse({ code: "metadata_failed", message: "simulated" }, { status: 500 });
        }
        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          const storagePath = JSON.parse(options.body).prefixes[0];
          cleanupAttempted.push(storagePath);
          if (storagePath.includes("/_previews/")) {
            return makeJsonResponse({ code: "cleanup_failed", message: "simulated" }, { status: 500 });
          }
          return makeJsonResponse([{ name: storagePath }]);
        }
        throw new Error(`Unexpected cleanup-failure request: ${url}`);
      }
    }),
    (error) => error.code === "UPLOAD_FAILED_CLEANUP_FAILED" && error.details.cleanupFailures.length === 1
  );
  assert.equal(cleanupAttempted.length, 2, "cleanup must attempt the original even when derived cleanup fails first");
}


async function testAdminInventoryPaginationAndDelete() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };
  const session = { access_token: "admin-access-token" };

  const inventorySource = Array.from({ length: 1205 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    content_class: index % 2 ? "human" : "ai",
    storage_bucket: "game-images",
    storage_path: `${index % 2 ? "human" : "ai"}/${index}.avif`,
    thumbnail_path: index === 0 ? "ai/_previews/v1/0.avif" : null,
    original_filename: `source-${index}.jpg`,
    source_sha256: "a".repeat(64),
    avif_sha256: "b".repeat(64),
    width: 100,
    height: 100,
    file_size_bytes: 1000,
    is_active: false,
    created_at: "2026-09-29T12:00:00Z",
    updated_at: "2026-09-29T12:00:00Z"
  }));

  const offsets = [];
  const inventory = await listGameImages({
    session,
    config,
    pageSize: 500,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/game_images");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.ok(url.searchParams.get("select").includes("thumbnail_path"),
        "authenticated inventory must select derived preview metadata");

      const offset = Number(url.searchParams.get("offset") || 0);
      offsets.push(offset);

      // Simulate a server response cap of 400 rows.
      return makeJsonResponse(inventorySource.slice(offset, offset + 400));
    }
  });

  assert.equal(inventory.length, 1205);
  assert.deepEqual(offsets, [0, 400, 800, 1200, 1205]);
  assert.equal(
    inventory[0].public_url,
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/game-images/ai/0.avif"
  );
  assert.equal(
    inventory[0].thumbnail_public_url,
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/game-images/ai/_previews/v1/0.avif"
  );
  assert.equal(inventory[1].thumbnail_public_url, null);

  await assert.rejects(
    () => assertImageHashAvailable({
      session,
      field: "source_sha256",
      hash: "c".repeat(64),
      requestedClass: "human",
      config,
      fetchImpl: async () => makeJsonResponse([{
        id: "11111111-1111-4111-8111-111111111111",
        content_class: "ai",
        original_filename: "existing.jpg",
        source_sha256: "c".repeat(64),
        avif_sha256: "d".repeat(64),
        storage_path: "ai/existing.avif",
        is_active: false
      }])
    }),
    (error) =>
      error.code === "SOURCE_DUPLICATE" &&
      error.message.includes("przypisany do AI") &&
      error.message.includes("dodać go jako HUMAN")
  );

  const inactiveImage = {
    id: "22222222-2222-4222-8222-222222222222",
    content_class: "human",
    storage_path: "human/asset.avif",
    thumbnail_path: null,
    original_filename: "asset.jpg",
    is_active: false
  };
  const inactiveRequests = [];

  await deleteGameImage({
    session,
    image: inactiveImage,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      inactiveRequests.push({ url, options });

      if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
        assert.deepEqual(JSON.parse(options.body), { prefixes: ["human/asset.avif"] });
        return makeJsonResponse([{ name: "human/asset.avif" }]);
      }

      if (url.pathname === "/rest/v1/game_images" && options.method === "DELETE") {
        assert.equal(url.searchParams.get("id"), "eq.22222222-2222-4222-8222-222222222222");
        return makeJsonResponse([inactiveImage]);
      }

      throw new Error(`Unexpected inactive delete request: ${url}`);
    }
  });

  assert.deepEqual(
    inactiveRequests.map(({ url, options }) => [url.pathname, options.method]),
    [
      ["/storage/v1/object/game-images", "DELETE"],
      ["/rest/v1/game_images", "DELETE"]
    ]
  );

  const previewImage = {
    id: "33333333-3333-4333-8333-333333333333",
    content_class: "ai",
    storage_path: "ai/active.avif",
    thumbnail_path: "ai/_previews/v1/active.avif",
    original_filename: "active.jpg",
    is_active: true
  };
  const previewDeleteSequence = [];

  await deleteGameImage({
    session,
    image: previewImage,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));

      if (url.pathname === "/rest/v1/game_images" && options.method === "PATCH") {
        const body = JSON.parse(options.body);
        previewDeleteSequence.push(["activity", body.is_active]);
        return makeJsonResponse([{ ...previewImage, is_active: body.is_active }]);
      }

      if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
        const storagePath = JSON.parse(options.body).prefixes[0];
        previewDeleteSequence.push(["storage", storagePath]);
        return makeJsonResponse([{ name: storagePath }]);
      }

      if (url.pathname === "/rest/v1/game_images" && options.method === "DELETE") {
        previewDeleteSequence.push(["metadata", previewImage.id]);
        return makeJsonResponse([previewImage]);
      }

      throw new Error(`Unexpected preview delete request: ${url}`);
    }
  });

  assert.deepEqual(previewDeleteSequence, [
    ["activity", false],
    ["storage", "ai/_previews/v1/active.avif"],
    ["storage", "ai/active.avif"],
    ["metadata", previewImage.id]
  ], "delete must remove derived asset before the production original");

  const failureSequence = [];
  await assert.rejects(
    () => deleteGameImage({
      session,
      image: previewImage,
      config,
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));

        if (url.pathname === "/rest/v1/game_images" && options.method === "PATCH") {
          const body = JSON.parse(options.body);
          failureSequence.push(["activity", body.is_active]);
          return makeJsonResponse([{ ...previewImage, is_active: body.is_active }]);
        }

        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          const storagePath = JSON.parse(options.body).prefixes[0];
          failureSequence.push(["storage", storagePath]);
          if (storagePath === previewImage.storage_path) {
            return makeJsonResponse({ code: "storage_failure", message: "simulated" }, { status: 500 });
          }
          return makeJsonResponse([{ name: storagePath }]);
        }

        throw new Error(`Unexpected active delete failure request: ${url}`);
      }
    }),
    (error) => error.code === "storage_failure"
  );

  assert.deepEqual(failureSequence, [
    ["activity", false],
    ["storage", "ai/_previews/v1/active.avif"],
    ["storage", "ai/active.avif"],
    ["activity", true]
  ], "production delete failure must restore active publication state after the preview was removed");


}




async function testContentClassMoveLifecycle() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };
  const session = { access_token: "admin-access-token" };
  const image = Object.freeze({
    id: "44444444-4444-4444-8444-444444444444",
    content_class: "ai",
    storage_bucket: "game-images",
    storage_path: "ai/44444444-4444-4444-8444-444444444444.avif",
    thumbnail_path: "ai/_previews/v1/44444444-4444-4444-8444-444444444444.avif",
    original_filename: "source.jpg",
    source_sha256: "a".repeat(64),
    avif_sha256: "b".repeat(64),
    width: 4032,
    height: 3024,
    file_size_bytes: 1234567,
    is_active: true,
    created_at: "2026-10-01T12:00:00Z"
  });

  const paths = deriveMovePaths(image, "human");
  assert.deepEqual(paths, {
    sourceClass: "ai",
    targetClass: "human",
    sourceStoragePath: image.storage_path,
    targetStoragePath: "human/44444444-4444-4444-8444-444444444444.avif",
    sourceThumbnailPath: image.thumbnail_path,
    targetThumbnailPath: "human/_previews/v1/44444444-4444-4444-8444-444444444444.avif",
    noop: false
  });
  assert.equal(deriveMovePaths(image, "ai").noop, true, "same-class move must be a no-op");
  assert.throws(
    () => deriveMovePaths({ ...image, storage_path: "human/wrong.avif" }, "human"),
    (error) => error.code === "MOVE_SOURCE_PATH_CLASS_MISMATCH"
  );

  const copyRequests = [];
  await copyStorageObject({
    session,
    sourcePath: image.storage_path,
    destinationPath: paths.targetStoragePath,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      copyRequests.push({ url, options });
      assert.equal(url.pathname, "/storage/v1/object/copy");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.deepEqual(JSON.parse(options.body), {
        bucketId: "game-images",
        sourceKey: image.storage_path,
        destinationKey: paths.targetStoragePath,
        copyMetadata: true
      });
      return makeJsonResponse({ Key: paths.targetStoragePath });
    }
  });
  assert.equal(copyRequests.length, 1);

  const metadataRequests = [];
  const committedRow = await updateGameImageMoveMetadata({
    session,
    image,
    targetClass: "human",
    targetStoragePath: paths.targetStoragePath,
    targetThumbnailPath: paths.targetThumbnailPath,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      metadataRequests.push({ url, options });
      assert.equal(url.pathname, "/rest/v1/game_images");
      assert.equal(options.method, "PATCH");
      assert.equal(url.searchParams.get("id"), `eq.${image.id}`);
      assert.equal(url.searchParams.get("content_class"), "eq.ai");
      assert.equal(url.searchParams.get("storage_path"), `eq.${image.storage_path}`);
      assert.equal(url.searchParams.get("thumbnail_path"), `eq.${image.thumbnail_path}`);
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        content_class: "human",
        storage_path: paths.targetStoragePath,
        thumbnail_path: paths.targetThumbnailPath
      }, "move metadata commit must change only class + canonical paths");
      return makeJsonResponse([{ ...image, ...body }]);
    }
  });
  assert.equal(committedRow.content_class, "human");
  assert.equal(metadataRequests.length, 1);

  const successSequence = [];
  const successResult = await moveGameImageToClass({
    session,
    image,
    targetClass: "human",
    copyObject: async ({ sourcePath, destinationPath }) => {
      successSequence.push(["copy", sourcePath, destinationPath]);
    },
    commitMetadata: async ({ targetClass, targetStoragePath, targetThumbnailPath }) => {
      successSequence.push(["commit", targetClass, targetStoragePath, targetThumbnailPath]);
      return { ...image, content_class: targetClass, storage_path: targetStoragePath, thumbnail_path: targetThumbnailPath };
    },
    removeObject: async ({ storagePath }) => {
      successSequence.push(["remove", storagePath]);
    }
  });
  assert.equal(successResult.kind, "moved");
  assert.equal(successResult.cleanupWarnings.length, 0);
  assert.deepEqual(successSequence, [
    ["copy", image.storage_path, paths.targetStoragePath],
    ["copy", image.thumbnail_path, paths.targetThumbnailPath],
    ["commit", "human", paths.targetStoragePath, paths.targetThumbnailPath],
    ["remove", image.thumbnail_path],
    ["remove", image.storage_path]
  ], "move must copy both assets, commit metadata once, then clean old assets");

  let sameClassCalls = 0;
  const noopResult = await moveGameImageToClass({
    session,
    image,
    targetClass: "ai",
    copyObject: async () => { sameClassCalls += 1; },
    commitMetadata: async () => { sameClassCalls += 1; },
    removeObject: async () => { sameClassCalls += 1; }
  });
  assert.equal(noopResult.kind, "noop");
  assert.equal(sameClassCalls, 0, "same-class request must not touch Storage or metadata");

  let commitCalledAfterOriginalFailure = false;
  await assert.rejects(
    () => moveGameImageToClass({
      session,
      image,
      targetClass: "human",
      copyObject: async () => {
        throw new AdminContentError("TARGET_EXISTS", "simulated", { status: 409 });
      },
      commitMetadata: async () => { commitCalledAfterOriginalFailure = true; },
      removeObject: async () => {}
    }),
    (error) => error.code === "TARGET_EXISTS"
  );
  assert.equal(commitCalledAfterOriginalFailure, false, "destination collision must fail closed before metadata commit");

  const previewFailureCleanup = [];
  let previewCopyCount = 0;
  await assert.rejects(
    () => moveGameImageToClass({
      session,
      image,
      targetClass: "human",
      copyObject: async () => {
        previewCopyCount += 1;
        if (previewCopyCount === 2) throw new AdminContentError("PREVIEW_COPY_FAILED", "simulated");
      },
      commitMetadata: async () => {
        throw new Error("commit must not run");
      },
      removeObject: async ({ storagePath }) => previewFailureCleanup.push(storagePath)
    }),
    (error) => error.code === "PREVIEW_COPY_FAILED"
  );
  assert.deepEqual(previewFailureCleanup, [paths.targetStoragePath],
    "preview copy failure must roll back the already-created target original");

  const commitFailureCleanup = [];
  await assert.rejects(
    () => moveGameImageToClass({
      session,
      image,
      targetClass: "human",
      copyObject: async () => {},
      commitMetadata: async () => {
        throw new AdminContentError("MOVE_METADATA_STALE", "simulated");
      },
      removeObject: async ({ storagePath }) => commitFailureCleanup.push(storagePath)
    }),
    (error) => error.code === "MOVE_METADATA_STALE"
  );
  assert.deepEqual(commitFailureCleanup, [paths.targetThumbnailPath, paths.targetStoragePath],
    "failed optimistic metadata switch must roll back both target copies");

  let precommitCleanupCalls = 0;
  await assert.rejects(
    () => moveGameImageToClass({
      session,
      image,
      targetClass: "human",
      copyObject: async () => {},
      commitMetadata: async () => {
        throw new AdminContentError("MOVE_METADATA_STALE", "simulated stale metadata");
      },
      removeObject: async () => {
        precommitCleanupCalls += 1;
        if (precommitCleanupCalls === 1) {
          throw new AdminContentError("CONTENT_HTTP_ERROR", "session expired during rollback", { status: 401 });
        }
      }
    }),
    (error) => error.code === "MOVE_PRECOMMIT_FAILED_CLEANUP_FAILED" && error.status === 401,
    "auth/session loss during pre-commit rollback must remain fatal to the remaining batch"
  );

  const cleanupWarningResult = await moveGameImageToClass({
    session,
    image,
    targetClass: "human",
    copyObject: async () => {},
    commitMetadata: async ({ targetClass, targetStoragePath, targetThumbnailPath }) => ({
      ...image,
      content_class: targetClass,
      storage_path: targetStoragePath,
      thumbnail_path: targetThumbnailPath
    }),
    removeObject: async ({ storagePath }) => {
      if (storagePath === image.thumbnail_path) throw new AdminContentError("CLEANUP_FAILED", "simulated");
    }
  });
  assert.equal(cleanupWarningResult.kind, "moved");
  assert.equal(cleanupWarningResult.cleanupWarnings.length, 1,
    "cleanup failure after canonical commit must be a warning, not a rollback");

  const batchItems = [
    image,
    { ...image, id: "55555555-5555-4555-8555-555555555555", storage_path: "ai/55555555-5555-4555-8555-555555555555.avif", thumbnail_path: "ai/_previews/v1/55555555-5555-4555-8555-555555555555.avif" },
    { ...image, id: "66666666-6666-4666-8666-666666666666", content_class: "human", storage_path: "human/66666666-6666-4666-8666-666666666666.avif", thumbnail_path: "human/_previews/v1/66666666-6666-4666-8666-666666666666.avif" }
  ];
  let activeMoves = 0;
  let maxActiveMoves = 0;
  const batchAttempts = [];
  const batchResult = await runSequentialMoveBatch(batchItems, "human", {
    moveItem: async (item) => {
      batchAttempts.push(item.id);
      activeMoves += 1;
      maxActiveMoves = Math.max(maxActiveMoves, activeMoves);
      await Promise.resolve();
      activeMoves -= 1;
      if (item.id.startsWith("55555555")) throw new AdminContentError("MOVE_FAILED", "simulated");
      return { kind: "moved", cleanupWarnings: [] };
    },
    shouldAbort: () => false
  });
  assert.equal(maxActiveMoves, 1, "bulk move must remain strictly sequential per image");
  assert.equal(batchResult.attemptedCount, 2);
  assert.equal(batchResult.movedCount, 1);
  assert.equal(batchResult.failedCount, 1);
  assert.equal(batchResult.skippedCount, 1, "rows already in target class must be skipped without work");
  assert.deepEqual(batchAttempts, [batchItems[0].id, batchItems[1].id]);

  let fatalAttempts = 0;
  const fatalResult = await runSequentialMoveBatch(batchItems, "human", {
    moveItem: async () => {
      fatalAttempts += 1;
      throw new AdminContentError("CONTENT_SESSION_MISSING", "expired", { status: 401 });
    },
    shouldAbort: (error) => error instanceof AdminContentError && error.status === 401
  });
  assert.equal(fatalResult.aborted, true);
  assert.equal(fatalAttempts, 1, "fatal auth/session loss must abort the remaining move batch");
}


async function testDeleteDrainCoordinatorLifecycle() {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const waitFor = async (predicate, message) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(message);
  };

  {
    const deleteGate = deferred();
    const processed = [];
    let activeDeletes = 0;
    let maxActiveDeletes = 0;

    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        activeDeletes += 1;
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes);
        processed.push(item.id);
        if (item.id === "A") await deleteGate.promise;
        activeDeletes -= 1;
      },
      reconcile: async () => {},
      isFatalError: () => false
    });

    assert.equal(coordinator.enqueue({ id: "A" }), true);
    await waitFor(() => processed.includes("A"), "A should enter the destructive primitive");
    assert.equal(coordinator.enqueue({ id: "B" }), true,
      "B must be accepted while A is still deleting");
    deleteGate.resolve();
    await coordinator.whenIdle();

    assert.deepEqual(processed, ["A", "B"],
      "a delete accepted while another delete is pending must always be drained");
    assert.equal(maxActiveDeletes, 1,
      "hardened delete primitives must remain physically serial");
    assert.deepEqual(coordinator.snapshot(), {
      phase: "idle",
      pendingCount: 0,
      ownedCount: 0,
      workerActive: false
    }, "completed delete lifecycle must end truly quiescent");
  }

  {
    const inventoryGate = deferred();
    const storageGate = deferred();
    const processed = [];
    const stages = [];
    let reconciliationCount = 0;

    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
      },
      reconcile: async () => {
        reconciliationCount += 1;
        if (reconciliationCount !== 1) return;
        stages.push("inventory");
        await inventoryGate.promise;
        stages.push("storage");
        await storageGate.promise;
      },
      isFatalError: () => false
    });

    coordinator.enqueue({ id: "A" });
    await waitFor(() => stages.includes("inventory"),
      "coordinator should enter authoritative inventory reconciliation");
    assert.equal(coordinator.enqueue({ id: "B" }), true,
      "delete must remain enqueueable during inventory reconciliation");

    inventoryGate.resolve();
    await waitFor(() => stages.includes("storage"),
      "coordinator should continue into Storage reconciliation");
    assert.equal(coordinator.enqueue({ id: "C" }), true,
      "delete must remain enqueueable during Storage reconciliation");

    storageGate.resolve();
    await coordinator.whenIdle();

    assert.deepEqual(processed, ["A", "B", "C"],
      "items accepted during either reconciliation phase must be drained without a second user kick");
    assert.equal(reconciliationCount, 2,
      "new work arriving during reconciliation must trigger another authoritative reconciliation cycle");
    assert.equal(coordinator.snapshot().pendingCount, 0);
    assert.equal(coordinator.snapshot().ownedCount, 0);
  }

  {
    const gate = deferred();
    const processed = [];
    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
        await gate.promise;
      },
      reconcile: async () => {},
      isFatalError: () => false
    });

    assert.equal(coordinator.enqueue({ id: "same" }), true);
    assert.equal(coordinator.enqueue({ id: "same" }), false,
      "the same image ID must never be owned by the delete lifecycle twice");
    gate.resolve();
    await coordinator.whenIdle();
    assert.deepEqual(processed, ["same"]);
  }

  {
    const processed = [];
    const failed = [];
    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
        if (item.id === "B") throw new Error("ordinary failure");
      },
      reconcile: async () => {},
      isFatalError: () => false,
      onItemFailure: (item) => failed.push(item.id)
    });

    for (const id of ["A", "B", "C"]) coordinator.enqueue({ id });
    await coordinator.whenIdle();
    assert.deepEqual(processed, ["A", "B", "C"],
      "ordinary delete failure must not abort later queued images");
    assert.deepEqual(failed, ["B"]);
    assert.equal(coordinator.snapshot().ownedCount, 0,
      "failed item ownership must be released");
  }

  {
    const processed = [];
    const fatalDrops = [];
    const fatalError = Object.assign(new Error("session lost"), { code: "AUTH_FATAL" });
    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
        if (item.id === "A") throw fatalError;
      },
      reconcile: async () => {},
      isFatalError: (error) => error?.code === "AUTH_FATAL",
      onFatal: (_error, { pendingItems }) => {
        fatalDrops.push(...pendingItems.map((item) => item.id));
      }
    });

    coordinator.enqueue({ id: "A" });
    coordinator.enqueue({ id: "B" });
    coordinator.enqueue({ id: "C" });
    await coordinator.whenIdle();

    assert.deepEqual(processed, ["A"],
      "fatal session failure must abort before later destructive primitives start");
    assert.deepEqual(fatalDrops, ["B", "C"],
      "fatal abort must explicitly release all pending queue ownership");
    assert.equal(coordinator.snapshot().pendingCount, 0);
    assert.equal(coordinator.snapshot().ownedCount, 0);
  }

  {
    const reconcileGate = deferred();
    const processed = [];
    let reconciliationCount = 0;
    const coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
        await Promise.resolve();
      },
      reconcile: async () => {
        reconciliationCount += 1;
        if (reconciliationCount === 1) await reconcileGate.promise;
      },
      isFatalError: () => false
    });

    for (let index = 0; index < 5; index += 1) coordinator.enqueue({ id: `burst-${index}` });
    await waitFor(() => coordinator.snapshot().phase === "reconciling",
      "burst should reach reconciliation after draining its first wave");
    for (let index = 5; index < 10; index += 1) coordinator.enqueue({ id: `burst-${index}` });
    reconcileGate.resolve();
    await coordinator.whenIdle();

    assert.equal(processed.length, 10, "rapid burst must process every accepted ID");
    assert.equal(new Set(processed).size, 10, "rapid burst must process every ID exactly once");
    assert.equal(coordinator.snapshot().workerActive, false);
    assert.equal(coordinator.snapshot().pendingCount, 0);
    assert.equal(coordinator.snapshot().ownedCount, 0);
  }

  {
    const processed = [];
    let injectedLateItem = false;
    let coordinator;
    coordinator = new DeleteDrainCoordinator({
      processItem: async (item) => {
        processed.push(item.id);
      },
      reconcile: async () => {},
      isFatalError: () => false,
      onWorkerIdle: () => {
        if (!injectedLateItem) {
          injectedLateItem = true;
          coordinator.enqueue({ id: "late" });
        }
      }
    });

    coordinator.enqueue({ id: "first" });
    await coordinator.whenIdle();
    assert.deepEqual(processed, ["first", "late"],
      "a very late accepted item must automatically acquire a new worker without another user click");
    assert.equal(coordinator.snapshot().pendingCount, 0);
    assert.equal(coordinator.snapshot().ownedCount, 0);
  }
}


async function testUploadPreparationWorkerClientLifecycle() {
  class FakeWorker {
    constructor() {
      this.listeners = new Map();
      this.messages = [];
      this.terminated = false;
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }

    postMessage(message) {
      if (this.terminated) throw new Error("worker terminated");
      this.messages.push(message);
    }

    emit(type, data = null) {
      for (const callback of this.listeners.get(type) || []) {
        callback(type === "message" ? { data } : { error: data });
      }
    }

    terminate() {
      this.terminated = true;
    }
  }

  const workers = [];
  const client = new UploadPreparationWorkerClient({
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });

  const first = client.inspect({ name: "a.jpg" });
  const second = client.inspect({ name: "b.jpg" });
  assert.equal(workers.length, 1, "one client authority must reuse exactly one live worker");

  const firstMessage = workers[0].messages[0];
  const secondMessage = workers[0].messages[1];
  assert.notEqual(firstMessage.requestId, secondMessage.requestId,
    "each worker request must own a unique job id");

  workers[0].emit("message", {
    requestId: secondMessage.requestId,
    ok: true,
    value: { filename: "b.jpg", mimeType: "image/jpeg", size: 2, sha256: "b".repeat(64) }
  });
  workers[0].emit("message", {
    requestId: firstMessage.requestId,
    ok: true,
    value: { filename: "a.jpg", mimeType: "image/jpeg", size: 1, sha256: "a".repeat(64) }
  });

  assert.equal((await first).filename, "a.jpg",
    "out-of-order worker replies must resolve the correct request");
  assert.equal((await second).filename, "b.jpg",
    "job ids must prevent cross-wired image results");

  const sourceFile = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  const sourceInspection = {
    filename: "source.jpg",
    mimeType: "image/jpeg",
    size: sourceFile.size,
    sha256: "c".repeat(64)
  };
  const preparedPromise = client.prepare(sourceFile, sourceInspection);
  const prepareMessage = workers[0].messages.at(-1);
  const outputBuffer = new Uint8Array([4, 5, 6]).buffer;
  const previewBuffer = new Uint8Array([7, 8]).buffer;
  workers[0].emit("message", {
    requestId: prepareMessage.requestId,
    ok: true,
    value: {
      source: sourceInspection,
      output: {
        buffer: outputBuffer,
        mimeType: "image/avif",
        size: outputBuffer.byteLength,
        sha256: "d".repeat(64),
        width: 100,
        height: 80,
        passthrough: false
      },
      preview: {
        buffer: previewBuffer,
        mimeType: "image/avif",
        size: previewBuffer.byteLength,
        width: 64,
        height: 48
      }
    }
  });
  const prepared = await preparedPromise;
  assert.equal(prepared.prepared.output.blob.type, "image/avif");
  assert.equal(prepared.prepared.output.blob.size, 3);
  assert.equal(prepared.inventoryPreview.blob.size, 2);

  const crashPromise = client.inspect({ name: "crash.jpg" });
  workers[0].emit("error", new Error("simulated worker crash"));
  await assert.rejects(crashPromise,
    (error) => error?.code === "UPLOAD_WORKER_CRASHED",
    "worker crash must fail the current entry explicitly");

  const recoveryPromise = client.inspect({ name: "recovery.jpg" });
  assert.equal(workers.length, 2,
    "a request after worker failure must create a fresh preparation worker");
  const recoveryMessage = workers[1].messages[0];
  workers[1].emit("message", {
    requestId: recoveryMessage.requestId,
    ok: true,
    value: { filename: "recovery.jpg", mimeType: "image/jpeg", size: 1, sha256: "e".repeat(64) }
  });
  assert.equal((await recoveryPromise).filename, "recovery.jpg");

  client.terminate();
  assert.equal(workers[1].terminated, true,
    "batch closeout must be able to release the worker/WASM heap explicitly");
}

async function testSequentialUploadBatchContinuity() {
  const seen = [];
  const success = [];
  const failures = [];

  const result = await runSequentialUploadBatch([1, 2, 3, 4], {
    processEntry: async (entry) => {
      seen.push(entry);
      if (entry === 2) throw new Error("simulated file failure");
      return entry * 10;
    },
    onSuccess: ({ entry, result: value }) => success.push([entry, value]),
    onFailure: ({ entry, error }) => failures.push([entry, error.message]),
    shouldAbort: () => false
  });

  assert.deepEqual(seen, [1, 2, 3, 4], "one file failure must not stop the batch");
  assert.deepEqual(success, [[1, 10], [3, 30], [4, 40]]);
  assert.deepEqual(failures, [[2, "simulated file failure"]]);
  assert.equal(result.aborted, false);
  assert.equal(result.processed, 4);
  assert.equal(result.remaining, 0);

  assert.deepEqual(
    summarizeUploadBatch(4, { completed: 3, duplicates: 0, failed: 1 }),
    { total: 4, completed: 3, duplicates: 0, failed: 1, waiting: 0 }
  );
  assert.deepEqual(
    summarizeUploadBatch(150, { completed: 1, duplicates: 2, failed: 1 }),
    { total: 150, completed: 1, duplicates: 2, failed: 1, waiting: 146 }
  );

  const queueOrder = ["ok-1", "failed", "pending"];
  const fakeContainer = {
    scrollTop: 120,
    prepend(item) {
      const current = queueOrder.indexOf(item);
      if (current >= 0) queueOrder.splice(current, 1);
      queueOrder.unshift(item);
    }
  };
  promoteQueueItem(fakeContainer, "failed");
  assert.deepEqual(queueOrder, ["failed", "ok-1", "pending"],
    "failed queue row must be promoted to index 0");
  assert.equal(fakeContainer.scrollTop, 0);

  const abortedSeen = [];
  const abortError = new Error("session expired");
  const aborted = await runSequentialUploadBatch([1, 2, 3], {
    processEntry: async (entry) => {
      abortedSeen.push(entry);
      if (entry === 2) throw abortError;
      return entry;
    },
    shouldAbort: (error) => error === abortError
  });

  assert.deepEqual(abortedSeen, [1, 2]);
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.remaining, 1);

  const pipelineEvents = [];
  let releaseCommitOne;
  const commitOneGate = new Promise((resolve) => { releaseCommitOne = resolve; });
  let preparedTwo = false;
  let activePreparations = 0;
  let maxActivePreparations = 0;

  const pipelinedPromise = runPipelinedUploadBatch([1, 2], {
    prepareEntry: async (entry) => {
      activePreparations += 1;
      maxActivePreparations = Math.max(maxActivePreparations, activePreparations);
      pipelineEvents.push(`prepare:${entry}:start`);
      await Promise.resolve();
      pipelineEvents.push(`prepare:${entry}:done`);
      if (entry === 2) preparedTwo = true;
      activePreparations -= 1;
      return entry * 10;
    },
    commitEntry: async ({ entry, prepared }) => {
      pipelineEvents.push(`commit:${entry}:start:${prepared}`);
      if (entry === 1) await commitOneGate;
      pipelineEvents.push(`commit:${entry}:done`);
      return prepared + 1;
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(preparedTwo, true,
    "next image preparation must overlap the previous network commit");
  releaseCommitOne();
  const pipelined = await pipelinedPromise;
  assert.equal(pipelined.aborted, false);
  assert.equal(pipelined.processed, 2);
  assert.equal(maxActivePreparations, 1,
    "bounded pipeline must never run two heavy preparation jobs at once");
  assert.ok(
    pipelineEvents.indexOf("prepare:2:done") < pipelineEvents.indexOf("commit:1:done"),
    "prepare N+1 must finish without waiting for commit N"
  );
}


function testGameModeRegistryContract() {
  const modes = getGameModes();
  assert.equal(modes.length, 1, "V1.6.2 must expose only the approved current mode");
  assert.equal(modes[0].id, GAME_MODE_IDS.CLASSIC);
  assert.equal(modes[0].enabled, true);
  assert.equal(getGameModeDefinition("classic")?.label, "Klasyczny");
  assert.equal(getGameModeDefinition("future-mode"), null);
  assert.equal(isGameModeSelectable("classic"), true);
  assert.equal(isGameModeSelectable("future-mode"), false,
    "an unknown/future mode must never fall through to classic gameplay");
}

async function testPreGameTransitionLifecycle() {
  class FakeTransitionScreen {
    constructor({ hidden = false, defer = false } = {}) {
      this.classList = new FakeClassList();
      if (hidden) this.classList.add("is-hidden");
      this.attributes = new Map();
      this.inert = hidden;
      this.defer = defer;
      this.animations = [];
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    animate(_frames, options) {
      const animation = new FakeAnimation({ deferred: this.defer });
      animation.options = options;
      this.animations.push(animation);
      return animation;
    }
  }

  const focusTarget = {
    calls: 0,
    focus() { this.calls += 1; }
  };
  const from = new FakeTransitionScreen({ defer: true });
  const to = new FakeTransitionScreen({ hidden: true, defer: true });
  const coordinator = new PreGameTransitionCoordinator({
    windowRef: { matchMedia: () => ({ matches: false }) },
    durationMs: 360,
    reducedDurationMs: 90
  });

  const first = coordinator.transition(from, to, { focusTarget });
  assert.equal(coordinator.busy, true);
  assert.equal(to.classList.contains("is-hidden"), false,
    "incoming pre-game screen must become renderable before its entrance animation");
  assert.equal(from.inert, true);
  assert.equal(to.inert, true,
    "both screens must be interaction-locked while the transition is active");
  assert.equal(await coordinator.transition(from, to), false,
    "rapid repeated mode taps must not start a second transition");

  [...from.animations, ...to.animations].forEach((animation) => animation.finish());
  assert.equal(await first, true);
  assert.equal(coordinator.busy, false);
  assert.equal(from.classList.contains("is-hidden"), true);
  assert.equal(from.attributes.get("aria-hidden"), "true");
  assert.equal(to.classList.contains("is-hidden"), false);
  assert.equal(to.attributes.get("aria-hidden"), "false");
  assert.equal(to.inert, false);
  assert.equal(focusTarget.calls, 1);

  const reducedFrom = new FakeTransitionScreen();
  const reducedTo = new FakeTransitionScreen({ hidden: true });
  const reduced = new PreGameTransitionCoordinator({
    windowRef: { matchMedia: () => ({ matches: true }) },
    durationMs: 360,
    reducedDurationMs: 90
  });
  assert.equal(await reduced.transition(reducedFrom, reducedTo), true);
  assert.equal(reducedFrom.animations[0].options.duration, 90,
    "reduced-motion pre-game navigation must use the shortened transition profile");
}

async function testSupabaseOnlyBuild() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-or-human-build-supabase-only-"));
  await copyRuntimeFixture(tempRoot);

  // Even if stale source images are still present in a working tree, the final
  // Pages artifact must not scan, copy or publish them.
  await fs.mkdir(path.join(tempRoot, "images", "AI"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "images", "AI", "stale-source.svg"), "<svg/>", "utf8");

  // Stale previous build output must be removed atomically.
  await fs.mkdir(path.join(tempRoot, "dist", "data"), { recursive: true });
  await fs.mkdir(path.join(tempRoot, "dist", "images"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "dist", "data", "images.json"), "{}", "utf8");
  await fs.writeFile(path.join(tempRoot, "dist", "images", "stale.avif"), "stale", "utf8");

  const result = await buildSite({ projectRoot: tempRoot });
  assert.equal(result.contentSource, "supabase");
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "index.html")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "admin", "index.html")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "admin", "admin.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "content-source.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "theme-controller.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "game-modes.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "pre-game-transition.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "assets", "game", "card-back-dark.webp")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "assets", "game", "card-back-light.webp")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "admin-content.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "upload-worker-client.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "upload-preparation-worker.js")));

  await assert.rejects(() => fs.stat(path.join(tempRoot, "dist", "data", "images.json")),
    (error) => error?.code === "ENOENT");
  await assert.rejects(() => fs.stat(path.join(tempRoot, "dist", "images")),
    (error) => error?.code === "ENOENT");

  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testPublicThemeController() {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("sepia"), null);
  assert.equal(getNextTheme("light"), "dark");
  assert.equal(getNextTheme("dark"), "light");
  assert.equal(getNextTheme("invalid"), "dark");
  assert.equal(resolveStoredTheme({ getItem: () => "dark" }), "dark");
  assert.equal(resolveStoredTheme({ getItem: () => "invalid" }), DEFAULT_THEME);
  assert.equal(resolveStoredTheme({ getItem: () => { throw new Error("blocked"); } }), DEFAULT_THEME);

  const radius = calculateThemeRevealRadius(10, 20, 100, 200);
  assert.ok(radius >= Math.hypot(90, 180), "theme reveal must cover the farthest viewport corner");

  const persisted = new Map();
  const root = {
    dataset: {},
    classList: new FakeClassList(),
    offsetWidth: 100,
    style: {
      colorScheme: "",
      values: new Map(),
      setProperty(name, value) { this.values.set(name, value); }
    }
  };
  const meta = {
    content: "",
    setAttribute(name, value) { if (name === "content") this.content = value; }
  };
  const attributes = new Map();
  let clickHandler = null;
  const button = {
    title: "",
    hidden: false,
    disabled: false,
    blurCalls: 0,
    blur() { this.blurCalls += 1; },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    getBoundingClientRect() { return { left: 80, top: 10, width: 40, height: 30 }; }
  };
  const storage = {
    getItem(key) { return persisted.get(key) ?? null; },
    setItem(key, value) { persisted.set(key, value); }
  };
  let transitionCalls = 0;
  const documentRef = {
    documentElement: root,
    querySelector(selector) {
      if (selector === "#theme-switch") return button;
      if (selector === 'meta[name="theme-color"]') return meta;
      return null;
    },
    startViewTransition(callback) {
      transitionCalls += 1;
      callback();
      return { finished: Promise.resolve() };
    }
  };
  const windowRef = {
    innerWidth: 320,
    innerHeight: 640,
    matchMedia: () => ({ matches: false }),
    setTimeout(callback) { callback(); }
  };

  root.dataset.theme = "light";
  const controller = initializeThemeController({ documentRef, windowRef, storage });
  assert.equal(controller.theme, "light");
  assert.equal(attributes.get("aria-checked"), "false");
  assert.equal(typeof clickHandler, "function");

  clickHandler();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.theme, "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(meta.content, "#0c1116");
  assert.equal(attributes.get("aria-checked"), "true");
  assert.equal(persisted.get(THEME_STORAGE_KEY), "dark");
  assert.equal(transitionCalls, 1);
  assert.ok(root.style.values.has("--theme-origin-x"));
  assert.ok(root.style.values.has("--theme-reveal-radius"));

  controller.setVisible(false);
  assert.equal(button.hidden, true);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get("aria-hidden"), "true");
  controller.setVisible(true);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(attributes.get("aria-hidden"), "false");
  setThemeSwitchVisible(button, false);
  assert.equal(button.blurCalls > 0, true);

  const directRoot = { dataset: {}, style: {} };
  applyTheme("light", { root: directRoot, meta: null, switchButton: null, storage, persist: false });
  assert.equal(directRoot.dataset.theme, "light");
}


async function testResultCelebrationLifecycle() {
  class FakeMotionMedia {
    constructor(matches = false) {
      this.matches = matches;
      this.listeners = new Set();
    }

    addEventListener(type, listener) {
      if (type === "change") this.listeners.add(listener);
    }

    removeEventListener(type, listener) {
      if (type === "change") this.listeners.delete(listener);
    }

    dispatch(matches) {
      this.matches = matches;
      for (const listener of this.listeners) listener({ matches });
    }
  }

  class FakeTimerWindow {
    constructor() {
      this.nextId = 1;
      this.timers = new Map();
    }

    setTimeout(callback, delay) {
      const id = this.nextId++;
      this.timers.set(id, { callback, delay });
      return id;
    }

    clearTimeout(id) {
      this.timers.delete(id);
    }

    run(id) {
      const timer = this.timers.get(id);
      if (!timer) return false;
      this.timers.delete(id);
      timer.callback();
      return true;
    }
  }

  class FakeCelebrationNode {
    constructor(rect = null) {
      this.dataset = {};
      this.animations = [];
      this.styleValues = new Map();
      this.hidden = false;
      this.rect = rect;
      this.style = {
        setProperty: (name, value) => this.styleValues.set(name, value)
      };
    }

    getBoundingClientRect() {
      if (this.rect) return this.rect;
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    animate(keyframes, options) {
      const animation = new FakeAnimation({ deferred: true });
      animation.keyframes = keyframes;
      animation.options = options;
      this.animations.push(animation);
      return animation;
    }
  }

  const fullTurnRandom = (() => {
    const values = [0.2];
    return () => values.shift() ?? 0.2;
  })();
  assert.equal(getFullTurnAngle(fullTurnRandom, 2), -720,
    "result card completion geometry must always be an integer full turn");

  const windowRef = new FakeTimerWindow();
  const motionMedia = new FakeMotionMedia(false);
  const cards = Array.from({ length: 5 }, () => new FakeCelebrationNode());
  let eligible = true;
  const controller = new ResultCelebrationController({
    cardSurfaces: cards,
    fireworkBursts: [],
    canSchedule: () => eligible,
    windowRef,
    motionMedia,
    random: createSeededRng(20261007),
    options: {
      firstTurnDelayMinMs: 10,
      firstTurnDelayMaxMs: 50,
      idleTurnDelayMinMs: 60,
      idleTurnDelayMaxMs: 90
    }
  });

  assert.equal(controller.enter(), true);
  assert.equal(windowRef.timers.size, 5,
    "all five result cards must own an independent first-start schedule");

  const initialTimerIds = [...windowRef.timers.keys()];
  for (const id of initialTimerIds) windowRef.run(id);
  assert.equal(cards.every((card) => card.animations.length === 1), true,
    "all five cards must be eligible to rotate independently");

  for (const card of cards) {
    const endTransform = card.animations[0].keyframes.at(-1).transform;
    const angle = Number(endTransform.match(/rotateY\((-?\d+)deg\)/)?.[1]);
    assert.equal(Number.isFinite(angle), true);
    assert.equal(Math.abs(angle) % 360, 0,
      "finite result turns must finish at a visually equivalent full-turn orientation");
  }

  eligible = false;
  controller.leave();
  assert.equal(windowRef.timers.size, 0,
    "leaving result celebration must clear only not-yet-started schedules");
  assert.equal(cards.every((card) => card.animations.every((animation) => !animation.cancelled)), true,
    "leaving result celebration must not cancel active turns");

  for (const card of cards) card.animations[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(windowRef.timers.size, 0,
    "completed turns must not reschedule after the celebration window has closed");

  const reducedWindow = new FakeTimerWindow();
  const reducedMedia = new FakeMotionMedia(true);
  const reducedCards = Array.from({ length: 5 }, () => new FakeCelebrationNode());
  const reducedController = new ResultCelebrationController({
    cardSurfaces: reducedCards,
    fireworkBursts: [],
    canSchedule: () => true,
    windowRef: reducedWindow,
    motionMedia: reducedMedia,
    random: createSeededRng(9)
  });
  assert.equal(reducedController.enter(), false);
  assert.equal(reducedWindow.timers.size, 0,
    "prefers-reduced-motion must suppress random result rotation scheduling");
  reducedMedia.dispatch(false);
  assert.equal(reducedWindow.timers.size, 5,
    "disabling reduced motion while celebration is active may arm all five independent schedules");
  reducedMedia.dispatch(true);
  assert.equal(reducedWindow.timers.size, 0,
    "enabling reduced motion must stop future starts without hard-resetting active motion");
  reducedController.destroy();

  const particleCountRng = createSeededRng(777);
  const sampledParticleCounts = new Set(
    Array.from({ length: 320 }, () => chooseFireworkParticleCount(particleCountRng))
  );
  assert.deepEqual([...sampledParticleCounts].sort((a, b) => a - b), [7, 8, 9, 10, 11, 12],
    "spectacle firework bursts must support the complete bounded 7-12 particle range");

  const familyRng = createSeededRng(778);
  const sampledFamilies = new Set(
    Array.from({ length: 320 }, () => chooseFireworkFamily(familyRng))
  );
  assert.deepEqual([...sampledFamilies].sort(), [...FIREWORK_FAMILIES].sort(),
    "firework events must vary only across the approved warm/cool/mixed families");

  const presentationRng = createSeededRng(779);
  for (const family of FIREWORK_FAMILIES) {
    for (let index = 0; index < 120; index += 1) {
      const presentation = createFireworkParticlePresentation(presentationRng, {
        index: index % 12,
        count: 12,
        family,
        maxDistance: 120,
        minDistance: 48
      });
      assert.ok(FIREWORK_TONES.includes(presentation.tone),
        "firework particles must use only approved semantic tone keys");
      if (family === "warm") assert.ok(["gold", "cream"].includes(presentation.tone));
      if (family === "cool") assert.ok(["blue", "ice"].includes(presentation.tone));
      assert.ok(presentation.distance >= 48 && presentation.distance <= 120,
        "spectacle particle travel must stay inside the enlarged bounded firework radius");
      assert.ok(presentation.size >= 6 && presentation.size <= 18,
        "spectacle particle size must stay inside the enlarged bounded range");
    }
  }

  const geometry = createFireworkGeometry({
    width: 390,
    height: 844,
    exclusionRects: [
      { left: 126, top: 140, right: 264, bottom: 190, width: 138, height: 50 },
      { left: 118, top: 278, right: 272, bottom: 390, width: 154, height: 112 },
      { left: 20, top: 544, right: 370, bottom: 720, width: 350, height: 176 },
      { left: 306, top: 16, right: 374, bottom: 54, width: 68, height: 38 }
    ]
  });
  const centerRng = createSeededRng(780);
  for (let index = 0; index < 120; index += 1) {
    const center = chooseFireworkCenter(centerRng, geometry, 32);
    if (!center) continue;
    assert.equal(isFireworkCenterSafe({
      ...center,
      width: geometry.width,
      height: geometry.height,
      edgePadding: geometry.edgePadding,
      exclusions: geometry.exclusions
    }), true, "chosen firework center must respect viewport edges and expanded UI exclusions");
  }

  const decorationWindow = new FakeTimerWindow();
  decorationWindow.innerWidth = 390;
  decorationWindow.innerHeight = 844;
  const fireworkBursts = Array.from({ length: 5 }, () => ({
    element: new FakeCelebrationNode(),
    core: new FakeCelebrationNode(),
    particles: Array.from({ length: 12 }, () => new FakeCelebrationNode())
  }));
  const exclusions = [
    new FakeCelebrationNode({ left: 126, top: 140, right: 264, bottom: 190, width: 138, height: 50 }),
    new FakeCelebrationNode({ left: 118, top: 278, right: 272, bottom: 390, width: 154, height: 112 }),
    new FakeCelebrationNode({ left: 20, top: 544, right: 370, bottom: 720, width: 350, height: 176 }),
    new FakeCelebrationNode({ left: 306, top: 16, right: 374, bottom: 54, width: 68, height: 38 })
  ];
  const halo = new FakeCelebrationNode();
  const dividerStar = new FakeCelebrationNode();
  let decorationEligible = true;
  const decorationController = new ResultCelebrationController({
    cardSurfaces: [],
    fireworkBursts,
    fireworkExclusions: exclusions,
    halo,
    dividerStar,
    canSchedule: () => decorationEligible,
    windowRef: decorationWindow,
    motionMedia: new FakeMotionMedia(false),
    random: createSeededRng(17),
    options: {
      firstAmbientFireworkDelayMinMs: 5000,
      firstAmbientFireworkDelayMaxMs: 5000,
      ambientFireworkDelayMinMs: 5000,
      ambientFireworkDelayMaxMs: 5000
    }
  });
  assert.equal(decorationController.enter(), true);
  assert.equal(decorationController.fireworkSlots.length, 5,
    "spectacle celebration must own exactly five reusable firework burst slots");
  assert.equal(decorationController.fireworkSlots.every((slot) => slot.particles.length === 12), true,
    "each spectacle firework slot must expose exactly twelve bounded particle nodes");
  assert.equal(dividerStar.animations.length, 1,
    "result entry must preserve the existing divider-star flare channel");
  assert.equal(decorationController.fireworkEventTimers.size >= 8, true,
    "spectacle entry plus first ambient scheduling must stage dense future firework events without dynamic DOM creation");

  const entryTimerIds = [...decorationController.fireworkEventTimers].slice(0, 7);
  for (const timerId of entryTimerIds) decorationWindow.run(timerId);
  assert.ok(decorationController.activeFireworkSlots.size >= 1 && decorationController.activeFireworkSlots.size <= 5,
    "staged spectacle entry may use up to the five bounded burst slots but never exceed the pool");

  const activeBursts = fireworkBursts.filter((slot) => slot.element.dataset.fireworkActive === "true");
  assert.ok(activeBursts.length >= 1, "entry sequence must start at least one visible mini-firework burst");
  for (const slot of activeBursts) {
    const particleAnimations = slot.particles.flatMap((particle) => particle.animations);
    assert.ok(particleAnimations.length >= 10 && particleAnimations.length <= 12,
      "spectacle entry firework must use a strong bounded 10-12 particle count");
    assert.equal(particleAnimations.every((animation) =>
      animation.options.duration >= 1300 && animation.options.duration <= 2100
    ), true, "spectacle entry particles must stay inside the intentionally longer visible duration range");
    assert.ok(FIREWORK_FAMILIES.includes(slot.element.dataset.fireworkFamily),
      "each burst must own one coherent semantic color family");
    assert.ok(slot.element.styleValues.has("--firework-x") && slot.element.styleValues.has("--firework-y"),
      "each burst must receive one measured safe viewport center");
  }

  const firstActiveSlot = activeBursts[0];
  decorationController.leave();
  assert.equal(decorationWindow.timers.size, 0,
    "leaving primary celebration must clear all future firework/card/halo/star event timers");
  assert.equal(firstActiveSlot.particles.flatMap((particle) => particle.animations)
    .every((animation) => !animation.cancelled), true,
    "an already-started firework must not be cancelled when the player leaves celebration");

  const finishingAnimations = [
    ...firstActiveSlot.particles.flatMap((particle) => particle.animations),
    ...firstActiveSlot.core.animations
  ];
  for (const animation of finishingAnimations) animation.finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(decorationWindow.timers.size, 0,
    "a completed firework after leave must never re-arm persistent celebration scheduling");

  decorationController.destroy();

  controller.destroy();
}

async function testSourceContracts() {
  const html = await fs.readFile(path.join(projectRoot, "index.html"), "utf8");
  const css = await fs.readFile(path.join(projectRoot, "css", "style.css"), "utf8");
  const game = await fs.readFile(path.join(projectRoot, "js", "game.js"), "utf8");
  const themeControllerSource = await fs.readFile(path.join(projectRoot, "js", "theme-controller.js"), "utf8");
  const gameModesSource = await fs.readFile(path.join(projectRoot, "js", "game-modes.js"), "utf8");
  const preGameTransitionSource = await fs.readFile(path.join(projectRoot, "js", "pre-game-transition.js"), "utf8");
  const resultCelebrationSource = await fs.readFile(path.join(projectRoot, "js", "result-celebration.js"), "utf8");
  const swipe = await fs.readFile(path.join(projectRoot, "js", "swipe-controller.js"), "utf8");
  const feedbackSource = await fs.readFile(path.join(projectRoot, "js", "answer-feedback.js"), "utf8");
  const sessionConfig = await fs.readFile(path.join(projectRoot, "js", "session-config.js"), "utf8");
  const sessionPicker = await fs.readFile(path.join(projectRoot, "js", "session-size-picker.js"), "utf8");
  const contentSource = await fs.readFile(path.join(projectRoot, "js", "content-source.js"), "utf8");
  const supabaseConfig = await fs.readFile(path.join(projectRoot, "js", "supabase-config.js"), "utf8");
  
const workflow = await fs.readFile(path.join(projectRoot, ".github", "workflows", "pages.yml"), "utf8");
  const adminHtml = await fs.readFile(path.join(projectRoot, "admin", "index.html"), "utf8");
  const adminCss = await fs.readFile(path.join(projectRoot, "admin", "admin.css"), "utf8");
  const adminJs = await fs.readFile(path.join(projectRoot, "admin", "admin.js"), "utf8");
  const adminAuth = await fs.readFile(path.join(projectRoot, "js", "admin-auth.js"), "utf8");
  const adminContent = await fs.readFile(path.join(projectRoot, "js", "admin-content.js"), "utf8");
  const avifConverter = await fs.readFile(path.join(projectRoot, "js", "avif-converter.js"), "utf8");
  const uploadBatchSource = await fs.readFile(path.join(projectRoot, "js", "upload-batch.js"), "utf8");
  const uploadWorkerClientSource = await fs.readFile(path.join(projectRoot, "js", "upload-worker-client.js"), "utf8");
  const uploadPreparationWorkerSource = await fs.readFile(path.join(projectRoot, "js", "upload-preparation-worker.js"), "utf8");
  const deleteQueueSource = await fs.readFile(path.join(projectRoot, "js", "delete-queue.js"), "utf8");
  const contentClassMoveSource = await fs.readFile(path.join(projectRoot, "js", "content-class-move.js"), "utf8");
  const buildSiteSource = await fs.readFile(path.join(projectRoot, "scripts", "build-site.js"), "utf8");

  assert.ok(!html.includes("final-percent"));
  assert.ok(!html.includes("reset-history"));
  assert.ok(html.includes("data-feedback-icon"));
  assert.ok(html.includes("data-feedback-label"));
  assert.ok(html.includes('rel="icon"'));
  assert.ok(html.includes('id="pre-game-screen"') && html.includes('id="mode-select-panel"') && html.includes('id="mode-setup-panel"'),
    "V1.6.2 must keep selection and classic setup as two states inside one pre-game shell");
  assert.ok(!html.includes('id="mode-select-screen"') && !html.includes('id="mode-setup-screen"'),
    "V1.6.2 must not model select/setup as separate public screens");
  assert.ok(html.includes('id="classic-mode-button"') && html.includes('data-game-mode="classic"'),
    "the current classic mode must be a semantic selectable mode tile");
  assert.equal((html.match(/data-game-mode=/g) || []).length, 1,
    "V1.6.2 must not expose or tease a second game mode before V1.7");
  assert.ok(!html.includes("Pojedynek") && !html.includes("Wkrótce"),
    "public V1.6.1 copy must not spoil an unimplemented future mode");
  assert.ok(html.includes('id="theme-switch"') && html.includes('role="switch"'),
    "public UI must expose one accessible light/dark theme switch across the non-gameplay public flow");
  assert.ok(html.includes('ai-or-human.theme'),
    "head bootstrap must restore the saved theme before the public UI is painted");
  assert.ok(css.includes(':root[data-theme="dark"]') && css.includes('--primary-bg:'),
    "public presentation must define complete tokenized light/dark palettes");
  assert.ok(css.includes('::view-transition-new(root)') && css.includes('@keyframes theme-reveal'),
    "theme change must use progressive circular View Transition reveal when supported");
  assert.ok(css.includes('.theme-fallback-transition'),
    "theme change must keep a non-View-Transition fallback");
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'),
    "theme motion must respect reduced-motion preference");
  assert.ok(game.includes('themeController = initializeThemeController();'),
    "public game bootstrap must use the one canonical theme controller without result-specific options");
  assert.ok(themeControllerSource.includes('THEME_STORAGE_KEY') && themeControllerSource.includes('startViewTransition'),
    "theme controller must own durable preference and progressive transition orchestration");
  assert.ok(themeControllerSource.includes('setThemeSwitchVisible') && game.includes('themeController?.setVisible'),
    "theme switch visibility must be controlled contextually without creating another theme authority");
  assert.ok(gameModesSource.includes('GAME_MODE_IDS') && gameModesSource.includes('CLASSIC'),
    "mode selection must have an explicit registry/authority independent from session size");
  assert.ok(game.includes('selectedGameMode') && game.includes('selectedSessionSize'),
    "game mode and round-size selection must remain independent runtime state");
  assert.ok(game.includes('prefetchClassicManifestAfterFirstPaint') && game.includes('ensureClassicManifest'),
    "classic manifest loading must be decoupled from immediate landing render");
  assert.ok(!/async function bootstrap\(\)[\s\S]*?await\s+loadManifest\(/m.test(game),
    "mode-selection bootstrap must not await the classic manifest before first render");
  assert.ok(preGameTransitionSource.includes('class PreGameTransitionCoordinator') &&
    preGameTransitionSource.includes('inert') && preGameTransitionSource.includes('.animate'),
    "pre-game navigation must have one animation/accessibility coordinator rather than timeout-driven hiding");
  assert.ok(game.includes('const preGameScreen = document.querySelector("#pre-game-screen")') &&
    game.includes('const preGamePanels = [modeSelectPanel, modeSetupPanel]'),
    "V1.6.2 must keep one public pre-game screen with internal select/setup panels");
  assert.ok(game.includes('transition(modeSelectPanel, modeSetupPanel') && game.includes('direction: "forward"') &&
    game.includes('transition(modeSetupPanel, modeSelectPanel') && game.includes('direction: "back"'),
    "select/setup navigation must morph internal panels with explicit forward/back direction");
  assert.ok(/\.pre-game-stage\s*\{[\s\S]*?min-height:\s*clamp\(410px, 62svh, 500px\)/m.test(css),
    "pre-game shell must reserve stable geometry so select/setup morph does not vertically jump");
  assert.ok(/body\[data-public-view="mode-select"\] \.game-atmosphere,[\s\S]*?body\[data-public-view="mode-setup"\] \.game-atmosphere,[\s\S]*?body\[data-public-view="result"\] \.game-atmosphere/m.test(css),
    "the one floating-card atmosphere must remain present through pre-game and the V1.6.3 result celebration");
  assert.ok(/body\[data-public-view="gameplay"\] \.theme-switch[\s\S]*?display:\s*none/m.test(css),
    "theme switch must disappear only on the actual gameplay view");
  assert.ok(game.includes('themeSwitchVisible = view !== "gameplay"') &&
    game.includes('view: "mode-setup", themeSwitchVisible: true'),
    "mode setup must keep the theme switch visible; only gameplay hides it");
  const sharedAtmosphereCss = css.match(/body\[data-public-view="mode-select"\] \.game-atmosphere,[\s\S]*?body\[data-public-view="result"\] \.game-atmosphere\s*\{([^}]*)\}/m)?.[1] || "";
  assert.ok(/opacity:\s*1/.test(sharedAtmosphereCss) && !/opacity:\s*\.72/.test(sharedAtmosphereCss),
    "mode select/setup/result must keep the same full-opacity shared atmosphere");
  assert.ok(!/body\[data-public-view="mode-setup"\] \.cosmic-orbit--(?:outer|inner)/m.test(css),
    "mode setup must not fade the shared orbital decoration relative to mode selection");
  assert.ok(!html.includes('class="setup-lede"') && !html.includes("Wybierz liczbę obrazów"),
    "classic setup must not repeat the obvious LICZBA OBRAZÓW instruction with a second sentence");
  assert.ok(/\.screen-pre-game\s*\{[\s\S]*?user-select:\s*none[\s\S]*?-webkit-user-select:\s*none/m.test(css),
    "static pre-game copy must not be accidentally text-selected on touch devices");
  assert.ok(/\.pre-game-display-title\[tabindex="-1"\]:focus\s*\{[\s\S]*?outline:\s*none/m.test(css),
    "programmatic focus handoff to the setup heading must not render a browser-default blue focus box");
  assert.equal((html.match(/class="cosmic-divider"/g) || []).length, 3,
    "V1.6.3 must reuse the same cosmic divider language in mode selection, mode setup and result");
  assert.equal((html.match(/class="pre-game-display-title"/g) || []).length, 2,
    "selection and setup titles must share one pre-game display-title authority");
  assert.ok(/\.pre-game-display-title\s*\{[\s\S]*?font-family:\s*Georgia, "Times New Roman", serif/m.test(css),
    "pre-game titles must share the accepted V1.6 serif display typography");
  const setupBackCss = css.match(/\.setup-back-button\s*\{([\s\S]*?)\}/m)?.[1] || "";
  assert.ok(!/top:\s*-/.test(setupBackCss) && setupBackCss.includes("position: relative"),
    "setup back navigation must stay in the safe content flow and must not use negative top positioning");
  assert.ok(setupBackCss.includes("var(--landing-panel)") && setupBackCss.includes("var(--landing-panel-border)"),
    "setup back navigation must use the same landing visual tokens as the game-selection screen");
  const setupOptionsCss = css.match(/\.mode-setup-panel \.session-size-options\s*\{([\s\S]*?)\}/m)?.[1] || "";
  assert.ok(setupOptionsCss.includes("var(--landing-panel)") && setupOptionsCss.includes("var(--landing-panel-border)"),
    "classic setup segmented control must use V1.6 pre-game landing tokens instead of the legacy generic skin");
  const setupPrimaryCss = css.match(/\.mode-setup-panel \.primary-button\s*\{([\s\S]*?)\}/m)?.[1] || "";
  assert.ok(setupPrimaryCss.includes("var(--pregame-cta-bg)") && setupPrimaryCss.includes("var(--pregame-cta-border)"),
    "classic setup CTA must use the dedicated pre-game CTA authority rather than the legacy generic primary skin");
  assert.ok(/@media \(max-height: 740px\) and \(orientation: portrait\)[\s\S]*?\.setup-back-button/m.test(css),
    "short mobile portrait layouts must keep an explicit compact setup profile so back/CTA remain reachable");
  assert.ok(css.includes('--floating-card-image: url("../assets/game/card-back-dark.webp")') &&
    /:root\[data-theme="dark"\][\s\S]*?--floating-card-image:\s*url\("\.\.\/assets\/game\/card-back-light\.webp"\)/m.test(css),
    "theme/art mapping must be inverse: light UI -> dark back, dark UI -> light back");
  assert.equal((html.match(/class="floating-card floating-card--/g) || []).length, 5,
    "mode-selection atmosphere must use five reusable decorative card instances");
  assert.ok(html.includes('id="game-atmosphere" aria-hidden="true"') &&
    /\.game-atmosphere\s*\{[\s\S]*?pointer-events:\s*none/m.test(css),
    "floating cards must be accessibility-hidden and pointer-inert");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.floating-card,[\s\S]*?\.cosmic-orbit,[\s\S]*?animation:\s*none\s*!important/m.test(css) &&
    resultCelebrationSource.includes('prefers-reduced-motion: reduce'),
    "reduced motion must stop continuous atmosphere motion and suppress new random celebration schedules");
  assert.ok(html.includes('rel="preload" as="image" type="image/webp" href="./assets/game/card-back-dark.webp"') &&
    html.includes('rel="preload" as="image" type="image/webp" href="./assets/game/card-back-light.webp"'),
    "both inverse-theme card backs must be preloaded before the first theme toggle");
  assert.ok(html.includes('data-session-size="10"'));
  assert.ok(html.includes('data-session-size="20"'));
  assert.ok(html.includes('data-session-size="50"'));
  assert.equal((html.match(/data-session-indicator aria-hidden/g) || []).length, 2,
    "both pickers must have one moving pill indicator");

  assert.ok(html.includes('class="game-stat game-stat-progress"') && html.includes('class="game-stat game-stat-score score-box"'),
    "V1.6.4 gameplay HUD must use the compact V1.6 stat surface authority without changing progress/score IDs");
  assert.ok(html.includes('class="choice-button choice-button-human"') && html.includes('class="choice-button choice-button-ai"'),
    "V1.6.4 gameplay actions must expose equal warm HUMAN and cool AI visual identities");
  assert.ok(html.includes('class="swipe-help" aria-label="Sterowanie gestem"') &&
    html.includes('swipe-help__item-human') && html.includes('swipe-help__item-ai'),
    "mobile swipe help must be a compact V1.6 semantic legend rather than legacy plain copy");
  assert.ok(html.includes('data-feedback-burst') && html.includes('data-feedback-pill'),
    "V1.6.4 feedback must expose dedicated burst and pill animation targets");
  assert.ok(/\.question-block h2\s*\{[\s\S]*?font-family:\s*Georgia/m.test(css) &&
    /\.game-stat\s*\{[\s\S]*?var\(--landing-panel\)/m.test(css),
    "gameplay question/HUD must reuse accepted V1.6 typography and landing surface tokens");
  assert.ok(/\.choice-button-human\s*\{[\s\S]*?var\(--accent-gold\)/m.test(css) &&
    /\.choice-button-ai\s*\{[\s\S]*?var\(--accent-blue\)/m.test(css),
    "HUMAN and AI controls must use distinct warm/cool V1.6 accent families with equal structure");
  assert.ok(/\.choice-button:focus-visible\s*\{/m.test(css),
    "gameplay answer controls must expose an explicit keyboard focus-visible treatment");
  assert.ok(/@media \(max-height: 740px\) and \(orientation: portrait\)[\s\S]*?body\[data-public-view="gameplay"\] \.app-shell[\s\S]*?\.screen-game \.card-stage/m.test(css),
    "V1.6.4 must include a dedicated short-portrait gameplay profile with height-aware card geometry");
  assert.ok(swipe.includes('decisionProgress') && swipe.includes('Math.abs(this.deltaX) / threshold'),
    "swipe controller must expose hint commitment normalized to the actual decision threshold");
  assert.ok(game.includes('decisionProgress = null') && game.includes('--swipe-commit'),
    "gameplay hint presentation must consume decisionProgress without changing swipe decision semantics");
  assert.ok(feedbackSource.includes('data-feedback-burst') && feedbackSource.includes('data-feedback-pill') &&
    feedbackSource.includes('ringFrames') && feedbackSource.includes('pillFrames'),
    "feedback controller must own stronger correct/incorrect burst/ring/pill motion channels");

  assert.ok(html.includes('id="end-screen"') && html.includes('data-result-state="celebration"'),
    "V1.6.3 result must enter in the celebration substate");
  assert.ok(html.includes('href="./css/style.css?v=1.6.4"') &&
    html.includes('src="./js/game.js?v=1.6.4"') &&
    game.includes('./result-celebration.js?v=1.6.4'),
    "V1.6.4 must version the public CSS/JS entry graph so phone caches cannot mix gameplay presentation authorities");
  assert.ok(html.includes('id="result-replay-setup" aria-hidden="true" inert hidden'),
    "replay setup must have a native hidden first-paint fail-safe in addition to CSS/ARIA state");
  assert.ok(html.includes('id="play-again-button"') && html.includes('id="result-home-button"'),
    "result celebration must expose separate replay and homepage actions");
  assert.ok(html.includes('id="result-replay-setup" aria-hidden="true" inert'),
    "10/20/50 replay configuration must be hidden/inert until replay intent is explicit");
  assert.ok(html.includes('id="result-start-button"') && html.includes('>Rozpocznij</button>'),
    "revealed replay configuration must keep Rozpocznij as the actual round-start action");
  assert.ok(game.includes('resultActions.hidden = replaySetupVisible') &&
    game.includes('resultReplaySetup.hidden = !replaySetupVisible'),
    "result substate authority must synchronize native hidden as a mixed-cache presentation fail-safe");
  assert.ok(game.includes('playAgainButton.addEventListener("click", openResultReplaySetup)') &&
    !game.includes('prepareAndStartSession(playAgainButton'),
    "first Zagraj ponownie action must reveal replay setup and must not prepare a session directly");
  assert.ok(game.includes('resultStartButton.addEventListener("click", () => prepareAndStartSession(resultStartButton, "Rozpocznij"))'),
    "result replay Rozpocznij must remain the prepare/start authority");
  assert.ok(game.includes('function returnResultToHome()') &&
    game.includes('preGameTransition?.showImmediately(modeSelectPanel, preGamePanels)') &&
    game.includes('selectedGameMode = null') &&
    game.includes('showOnly(preGameScreen, { view: "mode-select", themeSwitchVisible: true })'),
    "result home action must return to canonical mode-select without inventing a parallel landing state");
  const resultHomeFunction = game.match(/function returnResultToHome\(\) \{([\s\S]*?)\n\}/m)?.[1] || "";
  assert.ok(!resultHomeFunction.includes('window.location.reload'),
    "result -> homepage must not reload/refetch the application");
  assert.ok(/\.result-action-stage\s*\{[\s\S]*?display:\s*grid/m.test(css) &&
    /\.result-action-panel\s*\{[\s\S]*?grid-area:\s*1 \/ 1/m.test(css),
    "celebration/replay controls must share one stable action-stage geometry instead of vertically appending setup");
  assert.ok(/body\[data-public-view="result"\] \.cosmic-orbit--outer[\s\S]*?result-orbit-outer/m.test(css) &&
    /result-score-stage::before[\s\S]*?result-score-halo/m.test(css) &&
    /body\[data-public-view="result"\] \.result-title[\s\S]*?result-title-settle/m.test(css),
    "result celebration must preserve the accepted orbit authority and finite title/score/halo entrance emphasis");
  const resultCardSurfaceRule = css.match(/body\[data-public-view="result"\] \.floating-card__surface\s*\{([\s\S]*?)\}/m)?.[1] || "";
  assert.ok(resultCardSurfaceRule && !resultCardSurfaceRule.includes("animation:"),
    "result cards must not use one synchronized infinite CSS turn loop");
  assert.ok(resultCelebrationSource.includes('class ResultCelebrationController') &&
    resultCelebrationSource.includes('scheduleAllCards') &&
    resultCelebrationSource.includes('activeCardAnimations') &&
    resultCelebrationSource.includes('animationFinished(animation)') &&
    resultCelebrationSource.includes('this.clearPendingSchedules()'),
    "V1.6.3 test.9 must preserve finite independent card schedules in one focused celebration controller");
  assert.ok(game.includes('state === "result"') && game.includes('resultSubstate === "celebration"') &&
    game.includes('document.body.dataset.publicView === "result"'),
    "new result motion starts must be gated by the internal celebration substate, not public-view=result alone");
  assert.ok(game.includes('resultCelebration?.leave();') && game.includes('resultCelebration?.enter();'),
    "game lifecycle must explicitly arm/disarm celebration scheduling");
  assert.ok(resultCelebrationSource.includes('if (!this.isSchedulingAllowed()) return;') &&
    !resultCelebrationSource.includes('.cancel()'),
    "leaving result must stop future schedules without cancelling already-started finite effects");
  assert.ok(resultCelebrationSource.includes('* 360') && !resultCelebrationSource.includes('requestAnimationFrame'),
    "card turns must finish on full-turn-equivalent geometry without introducing a RAF animation loop");
  const flatCardSurfaceRule = css.match(/\.floating-card__surface\s*\{([\s\S]*?)\}/m)?.[1] || "";
  assert.ok(flatCardSurfaceRule.includes("background-image: var(--floating-card-image)") &&
    !flatCardSurfaceRule.includes("transform-style: preserve-3d"),
    "homepage/setup card authority must stay flat with one direct theme-dependent background image");
  assert.ok(/body\[data-public-view="result"\] \.floating-card__surface\s*\{[\s\S]*?background-image:\s*none;[\s\S]*?transform-style:\s*preserve-3d/m.test(css),
    "only result view may promote the shared card surface into a preserve-3d turn container");
  assert.ok(/body\[data-public-view="result"\] \.floating-card__surface::before,[\s\S]*?body\[data-public-view="result"\] \.floating-card__surface::after[\s\S]*?backface-visibility:\s*hidden/m.test(css) &&
    /body\[data-public-view="result"\] \.floating-card__surface::after[\s\S]*?rotateY\(180deg\)/m.test(css),
    "result-only full card turns must keep two faces of the existing card-back artwork");
  assert.ok(!/(^|\n)\.floating-card__surface::before,/m.test(css) &&
    !/body\[data-public-view="mode-(?:select|setup)"\] \.floating-card__surface[\s\S]{0,160}?preserve-3d/m.test(css),
    "result 3D face authority must not leak back into homepage or mode setup");

  assert.ok(html.includes('class="result-fireworks" data-result-firework-layer aria-hidden="true"') &&
    /\.result-fireworks\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?pointer-events:\s*none/m.test(css),
    "test.10 spectacle fireworks must keep one pointer-inert viewport-wide decorative layer");
  assert.equal((html.match(/data-result-firework>/g) || []).length, 5,
    "test.10 must use exactly five reusable spectacle firework burst slots");
  assert.equal((html.match(/data-firework-particle/g) || []).length, 60,
    "five spectacle firework slots must expose a bounded total of 60 reusable particle nodes");
  assert.equal((html.match(/data-firework-core/g) || []).length, 5,
    "each reusable spectacle burst slot must own one bounded core-flash node");
  assert.ok(!html.includes('data-result-sparkle') && !css.includes('.result-sparkle') &&
    !resultCelebrationSource.includes('SPARKLE_SAFE_ZONES') &&
    !resultCelebrationSource.includes('chooseSparkleClusterCount'),
    "test.8 single-sparkle authority must be removed rather than layered beside fireworks");
  assert.ok(css.includes('[data-firework-tone="gold"]') &&
    css.includes('[data-firework-tone="blue"]') &&
    css.includes('[data-firework-tone="cream"]') &&
    css.includes('[data-firework-tone="ice"]') &&
    css.includes('[data-firework-family="warm"]') &&
    css.includes('[data-firework-family="cool"]') &&
    css.includes('[data-firework-family="mixed"]'),
    "firework colors must stay inside the restrained semantic family/tone palette owned by CSS");
  assert.ok(resultCelebrationSource.includes('FIREWORK_FAMILIES') &&
    resultCelebrationSource.includes('chooseFireworkParticleCount') &&
    resultCelebrationSource.includes('chooseFireworkCenter') &&
    resultCelebrationSource.includes('activeFireworkSlots') &&
    resultCelebrationSource.includes('fireworkEventTimers') &&
    resultCelebrationSource.includes('playEntryFireworks') &&
    resultCelebrationSource.includes('scheduleAmbientFirework') &&
    resultCelebrationSource.includes('startFireworkBurst'),
    "test.10 must preserve one bounded spectacle firework-event authority with safe geometry and explicit slot ownership");
  assert.ok(resultCelebrationSource.includes('fireworkParticleDurationMinMs: 1050') &&
    resultCelebrationSource.includes('fireworkParticleDurationMaxMs: 1800') &&
    resultCelebrationSource.includes('entryFireworkParticleDurationMinMs: 1300') &&
    resultCelebrationSource.includes('entryFireworkParticleDurationMaxMs: 2100') &&
    resultCelebrationSource.includes('ambientFireworkDelayMinMs: 500') &&
    resultCelebrationSource.includes('ambientFireworkDelayMaxMs: 1350') &&
    resultCelebrationSource.includes('followUpFireworkChance: 0.62') &&
    resultCelebrationSource.includes('secondFollowUpFireworkChance: 0.30'),
    "spectacle fireworks must use the intentionally denser and longer audited intensity bounds");
  assert.ok(resultCelebrationSource.includes('createFireworkGeometry') &&
    resultCelebrationSource.includes('getBoundingClientRect') &&
    resultCelebrationSource.includes('fireworkCandidateAttempts: 32') &&
    !resultCelebrationSource.includes('requestAnimationFrame'),
    "safe firework geometry must be measured on lifecycle/viewport changes only, with bounded center retries and no per-frame layout loop");
  assert.ok(!/#(?:[0-9a-fA-F]{3,8})|rgba?\(|hsla?\(/.test(resultCelebrationSource),
    "firework JavaScript must not own raw visual color values");
  assert.ok(/firstTurnDelayMinMs:\s*1700/.test(resultCelebrationSource) &&
    /firstTurnDelayMaxMs:\s*3500/.test(resultCelebrationSource),
    "test.8 first-card hierarchy delay must remain unchanged while fireworks are introduced");
  assert.ok(html.includes('data-result-halo') && css.includes('.result-ambient-halo') &&
    resultCelebrationSource.includes('scheduleAmbientHalo') &&
    resultCelebrationSource.includes('scheduleAmbientStar'),
    "existing persistent halo/divider-star channels must remain operational beside fireworks");
  assert.ok(/result-title-settle 1200ms/m.test(css) &&
    /result-score-halo 2000ms/m.test(css) &&
    /result-score-settle 1350ms/m.test(css),
    "test.5 victory impact must stay visible long enough to register on a real phone");
  assert.ok(!resultCelebrationSource.includes('suspendForThemeTransition') &&
    !resultCelebrationSource.includes('resumeAfterThemeTransition') &&
    !resultCelebrationSource.includes('pausedAnimations') &&
    !resultCelebrationSource.includes('hasActiveAnimations'),
    "result celebration must not own a parallel theme-transition synchronization authority");
  assert.ok(!themeControllerSource.includes('beforeChange') &&
    !themeControllerSource.includes('afterChange') &&
    !themeControllerSource.includes('shouldUseViewTransition') &&
    !themeControllerSource.includes('transitionMode') &&
    game.includes('themeController = initializeThemeController();'),
    "homepage theme controller must be the one canonical LIGHT/DARK transition authority for every public view");
  assert.ok(!game.includes('suspendPublicMotionForTheme') &&
    !game.includes('resumePublicMotionAfterTheme') &&
    !game.includes('shouldUseRootThemeViewTransition') &&
    !css.includes('theme-motion-hold'),
    "legacy result-only theme bridge and CSS motion hold must be removed rather than overridden");
  assert.ok(themeControllerSource.includes('documentRef.startViewTransition') &&
    /:root\.theme-view-transition::view-transition-new\(root\)[\s\S]*?theme-reveal 560ms/m.test(css),
    "the accepted homepage circular root reveal must remain the universal supported theme transition");
  assert.ok(/\.floating-card\s*\{[\s\S]*?animation-play-state:\s*paused/m.test(css) &&
    /body\[data-public-view="mode-select"\] \.floating-card,[\s\S]*?body\[data-public-view="result"\] \.floating-card[\s\S]*?animation-play-state:\s*running/m.test(css),
    "decorative card motion must be view-scoped so invisible gameplay does not keep the homepage animation running");
  assert.ok(!html.includes('<canvas') && !resultCelebrationSource.includes('WebGL') && !resultCelebrationSource.includes('requestAnimationFrame'),
    "V1.6.3 celebration must stay finite compositor-friendly transform/opacity motion without canvas/WebGL/RAF loops");
  assert.ok(/@media \(max-height: 740px\) and \(orientation: portrait\)[\s\S]*?\.result-action-stage/m.test(css),
    "short portrait phones must have an explicit compact result/replay profile");
  assert.ok(!html.includes("data-session-liquid"), "obsolete morph SVG markup must be removed");
  assert.ok(!html.includes("data-session-liquid-path"), "obsolete morph path markup must be removed");
  assert.ok(!html.includes(">Sesja<"), "mode name must stay hidden until multiple modes exist");
  assert.ok(css.includes(".session-size-indicator"));
  assert.ok(!css.includes(".session-size-liquid"), "obsolete morph SVG CSS must be removed");
  assert.ok(!css.includes(".session-size-liquid__path"), "obsolete morph path CSS must be removed");
  assert.ok(css.includes("transition-property: transform, width, height"),
    "indicator must use a simple CSS slide transition");
  assert.ok(css.includes(".session-size-button.is-selected"));
  assert.ok(!css.includes(".session-size-button.is-liquid-covered"),
    "morph-era transient label coverage must be removed");

assert.ok(game.includes('loadContentManifest'));
assert.ok(!game.includes('fetch("./data/images.json"'), "game.js must not own the content transport anymore");
assert.ok(!game.includes('repozytoryjnego fallbacku'), "public game must not retain repository fallback messaging");
assert.ok(contentSource.includes('/rest/v1/game_images'));
assert.ok(contentSource.includes('cache: "no-store"'));
assert.ok(contentSource.includes('apikey: resolved.publishableKey'));
assert.ok(!contentSource.includes('Authorization:'));
assert.ok(contentSource.includes('while (true)'));
assert.ok(contentSource.includes('offset += rows.length'));
assert.ok(contentSource.includes('/storage/v1/object/public/'));
assert.ok(contentSource.includes('source: "supabase"'));
assert.ok(!contentSource.includes('thumbnail_path'),
  "public gameplay catalog must remain isolated from Admin-only derived assets");
assert.ok(!contentSource.includes('source: "repository"'), "repository content source must be removed");
assert.ok(!contentSource.includes('./data/images.json'), "repository manifest transport must be removed");
assert.ok(!contentSource.includes('fallbackReason'), "runtime fallback state must be removed");
assert.ok(supabaseConfig.includes('projectUrl: "https://kopmcnabslumyweebjgf.supabase.co"'));
assert.ok(supabaseConfig.includes('publishableKey: "sb_publishable_'));
assert.ok(!/publishableKey:\s*["']sb_secret_/i.test(supabaseConfig), "browser config must never contain a Supabase secret key");
assert.ok(!supabaseConfig.includes('sb_secret_') || supabaseConfig.includes('NEVER place an sb_secret_'));
  assert.ok(game.includes("SessionSizePicker"));
  assert.ok(game.includes("syncClassicSetupControls({ animate: true })"));
  assert.ok(game.includes("picker.refresh()"));
  assert.ok(sessionPicker.includes("ResizeObserver"));
  assert.ok(sessionPicker.includes("prefers-reduced-motion"));
  assert.ok(sessionPicker.includes("data-session-indicator"));
  assert.ok(sessionPicker.includes("translate3d("));
  assert.ok(sessionPicker.includes("slideDuration"));
  assert.ok(!sessionPicker.includes("buildReferencePoseSet"), "rejected hand-authored morph poses must be removed");
  assert.ok(!sessionPicker.includes("hardStretch"), "morph hard-stretch stage must be removed");
  assert.ok(!sessionPicker.includes("massTransfer"), "morph mass-transfer stage must be removed");
  assert.ok(!sessionPicker.includes("buildHoverBeanPoints"), "morph hover pre-pull must be removed");
  assert.ok(!sessionPicker.includes("elasticOut"), "morph elastic settle must be removed");
  assert.ok(!sessionPicker.includes("path.setAttribute('d'"), "picker must no longer morph SVG paths");
  assert.ok(!sessionPicker.includes("visualValue"), "morph-era semantic/visual split must be removed");
  assert.ok(!sessionPicker.includes("setLiquidCoverage"), "morph-era label coverage must be removed");
  assert.ok(css.includes('font-family: "Segoe UI", sans-serif'));
  assert.ok(css.includes("touch-action: none"));
  assert.ok(!css.includes("transition: opacity 120ms ease"), "image fade must not race the card handoff");
  assert.ok(css.includes("overflow-x: clip") || css.includes("overflow-x: hidden"));
  assert.ok(!game.includes("localStorage"));
  assert.ok(!game.includes("history.js"));
  assert.ok(sessionConfig.includes("SESSION_SIZE_OPTIONS"));
  assert.ok(sessionConfig.includes("[10, 20, 50]"));
  assert.ok(game.includes("activeSessionSize"));
  assert.ok(game.includes("roundSize: requestedSessionSize"));
  assert.ok(!game.includes("FEEDBACK_HOLD_MS"), "swipe must not pause before throw");
  assert.ok(game.includes("AnswerFeedbackController"));
  assert.ok(game.includes("Promise.all([feedbackPromise, throwPromise])"));
  assert.ok(!html.includes("feedback-badge"));
  assert.ok(html.indexOf('id="answer-feedback"') > html.indexOf("</article>"), "feedback must be outside moving card");
  assert.ok(css.includes("--correct:"));
  assert.ok(css.includes("--incorrect:"));

  const feedbackDurationMatch = feedbackSource.match(/\bduration:\s*(\d+)/);
  const feedbackReducedMatch = feedbackSource.match(/\breducedDuration:\s*(\d+)/);
  const throwDurationMatch = swipe.match(/\bthrowDuration:\s*(\d+)/);
  const returnDurationMatch = swipe.match(/\breturnDuration:\s*(\d+)/);
  const revealDurationMatch = swipe.match(/\brevealDuration:\s*(\d+)/);

  assert.ok(feedbackDurationMatch && feedbackReducedMatch, "feedback timing contract must be present");
  assert.ok(throwDurationMatch && returnDurationMatch && revealDurationMatch, "card timing contract must be present");

  const feedbackDuration = Number(feedbackDurationMatch[1]);
  const feedbackReducedDuration = Number(feedbackReducedMatch[1]);
  const throwDuration = Number(throwDurationMatch[1]);
  const returnDuration = Number(returnDurationMatch[1]);
  const revealDuration = Number(revealDurationMatch[1]);

  assert.ok(feedbackDuration > 0, "feedback duration must be positive");
  assert.ok(throwDuration > 0, "throw duration must be positive");
  assert.ok(returnDuration > 0, "return duration must be positive");
  assert.ok(revealDuration > 0, "reveal duration must be positive");
  assert.ok(feedbackReducedDuration > 0, "reduced-motion feedback duration must be positive");
  assert.ok(feedbackDuration > throwDuration, "feedback should outlive the outgoing card");
  assert.ok(game.includes("swipe.prepareHidden()"));
  assert.ok(game.includes("await swipe.reveal()"));
  assert.ok(game.includes("selector.recordExposure(item.id, sessionNumber)"));
  assert.ok(
    game.indexOf("await swipe.reveal()") < game.indexOf("selector.recordExposure(item.id, sessionNumber)"),
    "exposure must be recorded only after reveal"
  );
  assert.ok(
    game.indexOf("selector.recordExposure(item.id, sessionNumber)") < game.indexOf('setState("playing")', game.indexOf("selector.recordExposure(item.id, sessionNumber)")),
    "input must unlock only after reveal/exposure"
  );
  assert.ok(!contentSource.includes("./data/images.json"));
  assert.ok(!contentSource.includes("REPOSITORY_MANIFEST_HTTP_ERROR"));
  assert.ok(contentSource.includes("SUPABASE_POOL_TOO_SMALL"));
  assert.ok(!game.includes("Nie udało się wczytać katalogu obrazów ("));
  assert.ok(swipe.includes("pointerdown"));
  assert.ok(swipe.includes("this.capturePointer(event.pointerId)"));
  assert.ok(swipe.includes("pointermove"));
  assert.ok(swipe.includes("lostpointercapture"));
  assert.ok(!swipe.includes("touchstart"));
  assert.ok(!swipe.includes("touchmove"));
  assert.ok(swipe.includes("handoffPending"));
  assert.ok(swipe.includes("prepareHidden()"));
  assert.ok(swipe.includes("async reveal()"));

assert.ok(!html.toLowerCase().includes("/admin"), "public page must not link to /admin");
assert.ok(!html.includes("Panel administratora"), "public page must not expose admin UI");
assert.ok(/#game-image\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*center center;/m.test(css),
  "public game images must proportionally cover the card without letterboxing");
assert.ok(!/#game-image\s*\{[\s\S]*?object-fit:\s*contain;/m.test(css),
  "public game image card must not use contain letterboxing");
assert.ok(adminHtml.includes('name="email"'));
assert.ok(adminHtml.includes('name="password"'));
assert.ok(adminHtml.includes('autocomplete="current-password"'));
assert.ok(adminHtml.includes('name="robots" content="noindex, nofollow, noarchive"'));
assert.ok(!adminHtml.toLowerCase().includes("rejestr"), "admin UI must not expose sign-up");
assert.ok(!adminHtml.toLowerCase().includes("sign up"), "admin UI must not expose sign-up");
assert.ok(adminHtml.includes("./admin.js"));
assert.ok(adminCss.includes('font-family: "Segoe UI", sans-serif'));
assert.ok(adminJs.includes("authorizeAdminSession"));
assert.ok(adminJs.includes("ensureFreshAdminSession"), "upload batches must refresh session between files when needed");
assert.ok(adminJs.includes("error instanceof AdminAuthError"), "auth refresh failure must be treated as fatal upload-session failure");
assert.ok(!adminJs.includes("migration"), "one-time migration UI/controller code must be removed");
assert.ok(!adminHtml.includes("Przejście na Supabase"), "migration panel must be removed");
assert.ok(!adminHtml.includes("Przywróć fallback repo"), "rollback control must be removed");
assert.ok(!adminHtml.includes("PRODUKCJA · AKTYWNE"), "active publication status must not be duplicated in V1.5.7A UI");
assert.ok(!adminHtml.includes("Dostęp administratora aktywny"), "authorized workspace must not waste space on redundant access banner");
assert.ok(!adminHtml.includes("AI OR HUMAN"), "admin chrome must not repeat the product eyebrow");
assert.ok(!adminHtml.includes(">CONTENT<"), "admin workspace must not retain redundant CONTENT eyebrow");
assert.ok(!adminHtml.includes('id="count-active"'), "separate active counter must be removed");
assert.ok(adminHtml.includes('id="count-total"'), "total count must live in the ALL filter");
assert.ok(adminHtml.includes('id="count-ai"'), "AI count must live in the AI filter");
assert.ok(adminHtml.includes('id="count-human"'), "HUMAN count must live in the HUMAN filter");
assert.ok(adminHtml.includes('id="storage-usage-value"'), "Admin Library must expose current Storage usage");
assert.ok(adminHtml.includes('id="storage-usage-percent"'), "Admin Library must expose Storage percentage");
assert.ok(adminHtml.includes('id="storage-meter"') && adminHtml.includes('role="progressbar"'),
  "Admin Library must expose an accessible Storage capacity bar");
assert.ok(adminHtml.includes('id="storage-remaining"'), "Admin Library must expose approximate remaining capacity");
assert.ok(adminHtml.includes('id="drop-zone"') && adminHtml.includes('aria-disabled="true"'),
  "Admin upload drop zone must start category-locked");
assert.ok(adminHtml.includes('<span class="drop-zone-title">Wybierz kategorię</span>') &&
  adminHtml.includes('drop-zone-copy is-hidden') && adminHtml.includes('drop-zone-formats is-hidden'),
  "locked drop zone must show only the short Wybierz kategorię prompt");
assert.ok(adminJs.includes('dropZoneTitle.textContent = categorySelected ? "Przeciągnij zdjęcia tutaj" : "Wybierz kategorię"'),
  "choosing AI/HUMAN must restore the normal upload prompt without changing drop-zone geometry");
assert.ok(/id="file-input"[\s\S]*?multiple[\s\S]*?disabled/m.test(adminHtml),
  "native file input must start disabled until AI/HUMAN is selected");
assert.ok(adminJs.includes('function uploadEntryReady()'),
  "all upload-entry paths must share one category/busy readiness authority");
assert.ok(adminJs.includes('Boolean(selectedContentClass()) && !uploadBusy && !deleteBusy && !moveBusy && !inventoryBusy'),
  "upload-entry readiness must require a category and an idle content workspace");
assert.ok(adminJs.includes('dropZone.classList.toggle("is-category-locked", !categorySelected)'),
  "drop zone visual lock must track category selection");
assert.ok(adminJs.includes('fileInput.disabled = contentInteractionBusy || !categorySelected'),
  "native file input must remain disabled while the category is missing");
assert.ok(adminJs.includes('input.addEventListener("change", syncBusyControls)'),
  "AI/HUMAN selection must immediately resynchronize upload-entry state");
assert.ok(/dropZone\.addEventListener\("click", \(\) => \{[\s\S]*?if \(uploadEntryReady\(\)\) fileInput\.click\(\);/m.test(adminJs),
  "desktop/mobile/keyboard activation must not open the picker before category selection");
assert.ok(/for \(const eventName of \["dragenter", "dragover"\]\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(uploadEntryReady\(\)\) dropZone\.classList\.add\("is-dragover"\)/m.test(adminJs),
  "drag-over must always block browser navigation but only activate visually when category-ready");
assert.ok(/dropZone\.addEventListener\("drop", \(event\) => \{[\s\S]*?if \(uploadEntryReady\(\)\) handleFiles\(event\.dataTransfer\?\.files\);/m.test(adminJs),
  "drop must not hand files to the uploader before category selection");
assert.ok(adminJs.includes('window.alert("Najpierw wybierz kategorię AI albo HUMAN.")'),
  "handleFiles must retain the late category invariant as defense in depth");
assert.ok(adminCss.includes('.drop-zone.is-category-locked') && adminCss.includes('cursor: not-allowed'),
  "category-locked drop zone must be visibly unavailable");
assert.ok(/\.inventory-status\s*\{[\s\S]*?height:\s*1\.25em;[\s\S]*?min-height:\s*1\.25em;[\s\S]*?white-space:\s*nowrap;[\s\S]*?text-overflow:\s*ellipsis;/m.test(adminCss),
  "Library status must reserve a fixed one-line slot so transient messages cannot shift the grid");
assert.ok(!adminCss.includes('.inventory-status:empty'),
  "empty Library status must not collapse its reserved layout slot");
assert.ok(!adminHtml.includes('id="inventory-refresh"') && !adminHtml.includes('>Odśwież</button>'),
  "manual Library refresh control must be removed from the Admin UI");
assert.ok(adminHtml.includes('id="inventory-move"') && adminHtml.includes('>Przenieś</button>') &&
  adminHtml.includes('id="inventory-delete-many"') && adminHtml.includes('>Usuń wiele</button>'),
  "Library idle state must expose separate move and bulk-delete entry actions");
assert.ok(adminHtml.includes('id="inventory-delete-actions"') &&
  adminHtml.includes('id="inventory-delete-select-all"') &&
  adminHtml.includes('id="inventory-delete-selected"'),
  "delete mode must own a physically separate destructive action group");
assert.ok(adminHtml.includes('id="inventory-move-actions"') &&
  adminHtml.includes('id="inventory-move-select-all"') &&
  adminHtml.includes('id="inventory-move-to-ai"') &&
  adminHtml.includes('id="inventory-move-to-human"'),
  "move mode must own a physically separate non-destructive action group");
assert.ok(!adminHtml.includes('id="inventory-select"'),
  "generic Zaznacz entry must be removed so operation intent is chosen before selection");
assert.ok(adminHtml.indexOf('class="content-panel workspace-panel"') < adminHtml.indexOf('class="inventory-panel workspace-panel"'),
  "desktop DOM order must keep upload before library");
assert.ok(adminHtml.includes('class="admin-workspace"'), "authorized admin must use a dedicated workspace container");
assert.ok(adminCss.includes('grid-template-columns: minmax(320px, 0.82fr) minmax(0, 1.58fr)'),
  "desktop workspace must be upload-left/library-right");
assert.ok(adminCss.includes('.inventory-grid {') && adminCss.includes('overflow-y: auto'),
  "desktop library must own an internal scroll region");
assert.ok(adminCss.includes('@media (max-width: 980px)'), "admin must define a stacked narrow-screen workspace");
assert.ok(adminCss.includes('.admin-card[data-view="authorized"]'), "authorized workspace needs its own full-screen shell sizing");
assert.ok(adminCss.includes('.admin-card[data-view="boot"]'), "boot state must not inherit authorized workspace sizing");
assert.ok(adminJs.includes('adminCard.dataset.view = viewName'), "view state must be exposed on the admin shell for stable layout contracts");

assert.ok(adminHtml.includes('data-boot-visible="false"'), "bootstrap UI must start visually concealed");
assert.ok(adminHtml.includes('aria-hidden="true" inert'), "inactive auth views must start inaccessible");
assert.ok(adminHtml.includes('id="login-title" tabindex="-1"'), "login heading must support programmatic focus");
assert.ok(adminHtml.includes('id="admin-title" tabindex="-1"'), "authorized heading must support programmatic focus");
assert.ok(adminJs.includes("BOOT_REVEAL_DELAY_MS = 320"), "session bootstrap must use a delayed reveal instead of immediate flash");
assert.ok(adminJs.includes("setBootVisible(false)"), "bootstrap presentation must support silent concealment");
assert.ok(adminJs.includes("window.setTimeout"), "slow session verification must still expose a bounded loading state");
assert.ok(adminJs.includes("node.inert = !active"), "inactive auth views must be removed from keyboard interaction");
assert.ok(!adminJs.includes("prefersReducedMotion"),
  "reduced-motion preference must not route Admin auth transitions into the no-morph path");
assert.ok(/if \(!morph\)\s*\{\s*adminCard\.classList\.add\("skip-shell-morph"\);/s.test(adminJs),
  "morph:false must remain the sole switch for skipping shell geometry transitions");
assert.ok(adminJs.includes("skip-shell-morph"), "fast bootstrap must be able to skip login-style shell morphing");
assert.ok(adminJs.includes('establishAuthorizedSession(signedInSession, { morph: true, focus: true })'),
  "successful manual login must enter the authorized workspace through the morph path");
assert.ok(adminJs.includes('showLogin("", { morph: false, focus: true })'),
  "initial no-session bootstrap must remain a no-morph setup path");
assert.ok(adminJs.includes("morph: bootWasRevealed"),
  "saved-session bootstrap must only morph after the delayed boot state was actually revealed");
assert.ok(adminCss.includes('width 520ms cubic-bezier(0.22, 1, 0.36, 1)'), "desktop shell expansion must keep the accepted normal timing");
assert.ok(adminCss.includes('.admin-view {') && adminCss.includes('visibility: hidden'),
  "desktop auth views must cross-fade without relying on display:none");
assert.ok(adminCss.includes('.admin-card.skip-shell-morph'), "bootstrap needs an explicit no-morph shell path");
assert.ok(adminCss.includes('@media (prefers-reduced-motion: reduce) and (min-width: 981px)'),
  "desktop reduced-motion must own a shortened shell/view profile without changing the stacked layout");
assert.ok(adminCss.includes('width 240ms cubic-bezier(0.22, 1, 0.36, 1)') &&
  adminCss.includes('height 240ms cubic-bezier(0.22, 1, 0.36, 1)'),
  "reduced-motion desktop must retain a visible positive shell morph");
assert.ok(adminCss.includes('opacity 150ms ease'),
  "reduced-motion desktop must retain a visible shortened auth-view fade");
assert.ok(!adminCss.includes('transition-duration: 0.01ms !important'),
  "Admin reduced-motion must not globally collapse all transitions to an imperceptible duration");
assert.ok(/@media \(max-width: 980px\)[\s\S]*?\.admin-view\s*\{[\s\S]*?transition:\s*none;/m.test(adminCss),
  "<=980px stacked layout must retain its existing transition:none contract");
assert.ok(!adminCss.includes('.login-view { width: 100%; }'),
  "desktop login view must not fight absolute left/right inset with width:100%");
assert.ok(!adminHtml.includes('id="inventory-optimize"'),
  "Phase B must remove the temporary one-time library optimization action");
assert.ok(!adminHtml.includes('>Optymalizuj bibliotekę</button>'),
  "Phase B must remove temporary optimization operator copy");
assert.ok(!/thumbnail|miniatur/i.test(adminHtml),
  "normal Admin HTML must not expose internal preview terminology");
assert.ok(adminJs.includes('getAdminStorageUsage'),
  "Admin workspace must request protected live Storage usage");
assert.ok(adminJs.includes('storageBytesAdded: prepared.output.size + inventoryPreview.blob.size'),
  "successful uploads must report exact original + derived Storage bytes");
assert.ok(adminJs.includes('applyStorageUsageDelta(result?.storageBytesAdded)'),
  "capacity bar must move file-by-file only after successful upload completion");
assert.ok(adminJs.includes('await refreshStorageUsage({ force: true })'),
  "upload/delete flows need authoritative Storage reconciliation");
assert.ok(adminJs.includes('let deleteBusy = false') && adminJs.includes('let moveBusy = false') && adminJs.includes('const contentMutationBusy = uploadBusy || deleteBusy || moveBusy'),
  "upload, delete and move must remain mutually exclusive at workspace level");
assert.ok(adminJs.includes('new DeleteDrainCoordinator({') && adminJs.includes('singleDeleteCoordinator.enqueue(image)'),
  "single-image deletes must be owned by the tested drain-until-quiescent coordinator");
assert.ok(deleteQueueSource.includes('await this.reconcile()') &&
  deleteQueueSource.includes('if (this.queue.length === 0) break;'),
  "delete coordinator must re-check pending work after every awaited reconciliation");
assert.ok(deleteQueueSource.includes('if (!runResult.fatal && this.queue.length > 0) this.#ensureWorker();'),
  "delete coordinator must retain a final restart invariant against stranded late enqueue");
assert.ok(adminJs.includes('async function reconcileSingleDeleteAuthority()') &&
  !adminJs.slice(
    adminJs.indexOf('async function reconcileSingleDeleteAuthority()'),
    adminJs.indexOf('async function processSingleDeleteItem(image)')
  ).includes('inventoryBusy') &&
  !adminJs.slice(
    adminJs.indexOf('async function reconcileSingleDeleteAuthority()'),
    adminJs.indexOf('async function processSingleDeleteItem(image)')
  ).includes('refreshInventory('),
  "single-delete background reconciliation must not reuse the foreground inventory interaction lock");
const singleDeleteHandlerSource = adminJs.slice(
  adminJs.indexOf('async function handleDelete(imageId)'),
  adminJs.indexOf('async function handleBulkDelete()')
);
assert.ok(!singleDeleteHandlerSource.includes('|| deleteBusy ||') && singleDeleteHandlerSource.includes('inventoryActionMode !== "idle"'),
  "active single-delete worker must not reject additional confirmed single-delete enqueue");
assert.ok(adminJs.includes('actionButton.disabled = deletingIds.has(row.id) || uploadBusy || moveBusy || inventoryBusy;'),
  "other single-delete controls must remain clickable while the delete worker itself is active, but move/upload/refresh must exclude them");
assert.ok(adminJs.includes('logoutButton.disabled = authBusy || contentInteractionBusy'),
  "logout must be blocked while destructive/inventory mutation work is active");
assert.ok(adminJs.includes('selectedImageIds.clear();') && adminJs.includes('for (const row of filteredInventoryRows()) selectedImageIds.add(row.id);'),
  "Zaznacz wszystkie must select all rows from the active filter");
assert.ok(adminJs.includes('if (nextFilter !== inventoryFilter) selectedImageIds.clear();'),
  "filter changes must clear hidden destructive selections");
assert.ok(adminJs.includes('async function handleBulkDelete()'),
  "Admin Library must own an explicit bulk-delete controller");
const bulkDeleteSource = adminJs.slice(
  adminJs.indexOf('async function handleBulkDelete()'),
  adminJs.indexOf('async function handleBulkMove', adminJs.indexOf('async function handleBulkDelete()'))
);
assert.equal((bulkDeleteSource.match(/window\.confirm\(/g) || []).length, 1,
  "bulk delete must ask for one batch confirmation only");
assert.ok(bulkDeleteSource.includes('for (let index = 0; index < selectedRows.length; index += 1)'),
  "bulk delete must process selected rows sequentially");
assert.ok(bulkDeleteSource.includes('await refreshCurrentSessionForMutation()'),
  "bulk delete must refresh session freshness before each destructive item");
assert.ok(bulkDeleteSource.includes('await deleteGameImage({'),
  "bulk delete must reuse the hardened single-image delete primitive");
assert.ok(/if \(isSessionMutationError\(error\)\) \{[\s\S]*?break;[\s\S]*?\}\s*failedIds\.add\(image\.id\);/m.test(bulkDeleteSource),
  "ordinary item failures must continue while only auth/session loss aborts the remaining batch");
assert.equal((bulkDeleteSource.match(/refreshInventory\(\{ quiet: true, refreshStorage: false \}\)/g) || []).length, 1,
  "bulk delete must perform exactly one final authoritative inventory refresh");
assert.equal((bulkDeleteSource.match(/refreshStorageUsage\(\{ force: true \}\)/g) || []).length, 1,
  "bulk delete must perform exactly one final authoritative Storage reconciliation");
assert.ok(!bulkDeleteSource.includes('handleDelete('),
  "bulk delete must not call the single-delete UI handler N times");
const bulkMoveSource = adminJs.slice(
  adminJs.indexOf('async function handleBulkMove(targetClass)'),
  adminJs.indexOf('function showLogin', adminJs.indexOf('async function handleBulkMove(targetClass)'))
);
assert.ok(adminJs.includes('let inventoryActionMode = "idle"') &&
  adminJs.includes('inventoryActionMode = mode'),
  "multi-action authority must use explicit idle/move/delete modes rather than one generic selection boolean");
assert.ok(bulkMoveSource.includes('runSequentialMoveBatch(selectedRows, targetClass') &&
  bulkMoveSource.includes('moveGameImageToClass({'),
  "bulk move must use the tested sequential copy/commit/cleanup authority");
assert.ok(!bulkMoveSource.includes('deleteGameImage(') && !bulkMoveSource.includes('uploadPreparationWorker'),
  "move must not reuse destructive delete or AVIF upload-worker paths");
assert.equal((bulkMoveSource.match(/refreshInventory\(\{ quiet: true, refreshStorage: false \}\)/g) || []).length, 1,
  "move batch must perform exactly one final authoritative inventory refresh");
assert.equal((bulkMoveSource.match(/refreshStorageUsage\(\{ force: true \}\)/g) || []).length, 1,
  "move batch must perform exactly one final authoritative Storage reconciliation");
assert.ok(contentClassMoveSource.includes('copyObject({') &&
  contentClassMoveSource.includes('commitMetadata({') &&
  contentClassMoveSource.indexOf('commitMetadata({') > contentClassMoveSource.indexOf('copyObject({'),
  "move lifecycle must copy target objects before switching canonical metadata");
assert.ok(contentClassMoveSource.includes('cleanupWarnings') &&
  contentClassMoveSource.includes('MOVE_PRECOMMIT_FAILED_CLEANUP_FAILED'),
  "move lifecycle must distinguish pre-commit rollback failure from safe post-commit cleanup warnings");
assert.ok(contentClassMoveSource.includes('cleanupSessionFailure') &&
  contentClassMoveSource.includes('cleanupError.status === 401') &&
  contentClassMoveSource.includes('cleanupError.status === 403'),
  "move rollback cleanup must preserve fatal auth/session status for the batch abort policy");
assert.ok(bulkMoveSource.includes('if (!currentSession) return;'),
  "move final reconciliation must stop cleanly if refreshInventory logs the admin out");
assert.ok(adminContent.includes('/storage/v1/object/copy') &&
  adminContent.includes('destinationKey') &&
  adminContent.includes('copyMetadata: true'),
  "Storage move preparation must use server-side copy rather than browser download/re-upload");
assert.ok(adminContent.includes('url.searchParams.set("content_class", `eq.${image.content_class}`)') &&
  adminContent.includes('url.searchParams.set("storage_path", `eq.${image.storage_path}`)') &&
  adminContent.includes('url.searchParams.set("thumbnail_path", sourceThumbnail ? `eq.${sourceThumbnail}` : "is.null")'),
  "canonical metadata switch must use optimistic source class/path matching");
assert.ok(adminCss.includes('.inventory-card.is-delete-mode.is-selected') &&
  adminCss.includes('.inventory-card.is-move-mode.is-selected') && adminCss.includes('.inventory-select-control'),
  "delete and move modes must expose distinct selected-card visual contracts");
assert.ok(/\.inventory-card\.is-delete-mode\.is-selected\s*\{[\s\S]*?border-color:\s*var\(--danger\)/m.test(adminCss),
  "delete selection must remain destructive red");
assert.ok(/\.inventory-card\.is-delete-mode\.is-selected::after\s*\{[\s\S]*?background:\s*rgba\(163, 51, 59, 0\.24\)/m.test(adminCss),
  "delete selection must retain the full-card red overlay");
assert.ok(/\.inventory-card\.is-move-mode\.is-selected\s*\{[\s\S]*?border-color:\s*var\(--move\)/m.test(adminCss) &&
  /\.inventory-card\.is-move-mode\.is-selected::after\s*\{[\s\S]*?background:\s*rgba\(217, 119, 6, 0\.24\)/m.test(adminCss),
  "move selection must be orange and visually distinct from delete mode");
assert.ok(adminJs.includes('function createDeleteMarkerIcon()') &&
  adminJs.includes('circle.classList.add("delete-marker-circle")') &&
  adminJs.includes('cross.classList.add("delete-marker-x")'),
  "delete controls must render a reusable SVG marker with a circle and cross");
assert.ok(adminJs.includes('inventoryActionMode === "move" ? createMoveMarkerIcon() : createDeleteMarkerIcon()'),
  "selected cards must render an orange move marker in move mode and the destructive marker in delete mode");
assert.ok(adminJs.includes('actionButton.append(createDeleteMarkerIcon());'),
  "single-image delete must show the same SVG destructive marker");
assert.ok(/\.delete-marker-circle\s*\{[\s\S]*?fill:\s*var\(--danger\)/m.test(adminCss) &&
  /\.delete-marker-x\s*\{[\s\S]*?stroke:\s*#ffffff/m.test(adminCss),
  "delete SVG must use a red filled circle with a white cross");
assert.ok(/\.inventory-delete,\s*\n\.inventory-select-control\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/m.test(adminCss),
  "delete/select hit areas must be visually transparent so the SVG is the only destructive circle");
assert.ok(/\.inventory-delete,\s*\n\.inventory-select-control\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/m.test(adminCss),
  "delete/select hit area must be 44x44px for reliable mouse/touch activation");
assert.ok(/\.delete-marker-icon,\s*\n\.move-marker-icon\s*\{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px;/m.test(adminCss),
  "visible delete and move SVG markers must be 34x34px");
assert.ok(/\.move-marker-circle\s*\{[\s\S]*?fill:\s*var\(--move\)/m.test(adminCss) &&
  /\.move-marker-arrow\s*\{[\s\S]*?stroke:\s*#ffffff/m.test(adminCss),
  "move marker must use an orange filled circle with a white transfer glyph");
assert.ok(/@media \(max-width:\s*680px\)[\s\S]*?\.inventory-delete,\s*\n\s*\.inventory-select-control\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?\.delete-marker-icon,\s*\n\s*\.move-marker-icon\s*\{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px;/m.test(adminCss),
  "mobile two-column cards must keep the same 44px target and 34px delete/move SVGs");
assert.ok(/\.inventory-card\.is-selected \.inventory-select-control::before\s*\{[\s\S]*?display:\s*none;/m.test(adminCss),
  "selected bulk cards must suppress the neutral selector ring behind the destructive SVG");
assert.ok(/@media \(max-width:\s*680px\)[\s\S]*?\.inventory-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/m.test(adminCss),
  "mobile Admin Library must render two inventory columns rather than one");
assert.ok(adminJs.includes('card.setAttribute("aria-selected", selected ? "true" : "false")') &&
  adminJs.includes('event.key === "Enter" || event.key === " "'),
  "selection mode must expose explicit selection state and keyboard card toggling");
assert.ok(!adminJs.includes('inventoryRefreshButton') && !adminJs.includes('#inventory-refresh'),
  "manual refresh listener/query must be removed, not merely hidden");
assert.ok(adminContent.includes('rpc/get_admin_storage_usage'),
  "Storage usage must come from the protected RPC");
assert.ok(adminCss.includes('.storage-meter-fill') && adminCss.includes('transition: width 260ms'),
  "Storage percentage bar must animate visible usage changes");
assert.ok(adminCss.includes('.storage-meter.is-warning') && adminCss.includes('.storage-meter.is-critical'),
  "Storage meter must expose warning/critical visual states");
assert.ok(/\.storage-meter-fill\s*\{[\s\S]*?background:\s*var\(--success\)/m.test(adminCss),
  "Storage meter default fill must be green");
assert.ok(adminJs.includes('if (percent >= 90) storageMeter.classList.add("is-critical")'),
  "Storage meter must become critical at 90 percent");
assert.ok(adminJs.includes('else if (percent >= 70) storageMeter.classList.add("is-warning")'),
  "Storage meter must become warning at 70 percent");
assert.ok(adminCss.includes('.inventory-toolbar'),
  "filters and Storage capacity meter must share a responsive Library toolbar");
assert.ok(adminJs.includes('image.src = row.thumbnail_public_url || row.public_url'),
  "Admin Library must prefer the small derived asset");
assert.ok(adminJs.includes('image.src = row.public_url'),
  "Admin Library must fall back to the production original if a derived asset fails");
assert.ok(!adminJs.includes('optimizeExistingInventory'),
  "Phase B must remove the one-time existing-library optimization controller");
assert.ok(!adminJs.includes('optimizationBusy'),
  "Phase B must remove temporary optimization busy state");
assert.ok(!adminJs.includes('registerInventoryThumbnail'),
  "Phase B must remove the one-time backfill persistence path");
assert.ok(!adminJs.includes('fetchPublicAvifBlob'),
  "Phase B must remove the one-time production-original download path");
assert.ok(adminJs.includes('const uploadPreparationWorker = new UploadPreparationWorkerClient()'),
  "Admin must own exactly one upload preparation Worker authority");
assert.ok(adminJs.includes('uploadPreparationWorker.inspect(file)') && adminJs.includes('uploadPreparationWorker.prepare(file, sourceInspection)'),
  "source hash and heavy image preparation must cross the Worker boundary");
assert.ok(!adminJs.includes('convertSourceFileToAvif') && !adminJs.includes('createInventoryPreviewAvif'),
  "Admin main thread must not directly execute full-resolution AVIF conversion or preview generation");
assert.ok(adminJs.includes('uploadPreparationWorker.terminate()'),
  "batch closeout must release the preparation Worker and its WASM/canvas memory");
assert.ok(uploadWorkerClientSource.includes('new Worker(new URL("./upload-preparation-worker.js", import.meta.url)') &&
  uploadWorkerClientSource.includes('type: "module"'),
  "upload preparation must use a same-origin module Worker");
assert.ok(uploadWorkerClientSource.includes('requestId') && uploadWorkerClientSource.includes('this.pending = new Map()'),
  "Worker client must correlate responses by explicit job id");
assert.ok(uploadPreparationWorkerSource.includes('new OffscreenCanvas') && uploadPreparationWorkerSource.includes('createImageBitmap'),
  "heavy image decode/canvas work must execute in the preparation Worker");
assert.ok(uploadPreparationWorkerSource.includes('encodeImageDataToAvif'),
  "AVIF WASM encoding authority must execute from the Worker module");
assert.ok(uploadPreparationWorkerSource.includes('encodePreviewFromDecoded(decoded, width, height)') &&
  uploadPreparationWorkerSource.includes('captureProductionPixels(decoded, width, height)'),
  "preview and production pixels must be derived from the same source decode");
assert.ok(
  uploadPreparationWorkerSource.indexOf('decoded.close?.();') >
    uploadPreparationWorkerSource.indexOf('captureProductionPixels(decoded, width, height)') &&
  uploadPreparationWorkerSource.indexOf('encodeProductionPixels(productionPixels, width, height)') >
    uploadPreparationWorkerSource.indexOf('decoded.close?.();'),
  "source bitmap must be released before full-resolution AVIF encode begins"
);
assert.ok(!uploadPreparationWorkerSource.includes('createInventoryPreviewAvif') &&
  !uploadPreparationWorkerSource.includes('document.createElement') &&
  !uploadPreparationWorkerSource.includes('new Image('),
  "Worker preparation must not re-decode production AVIF solely for preview or depend on DOM image APIs");
assert.ok(uploadPreparationWorkerSource.includes('releaseCanvas(canvas)') && uploadPreparationWorkerSource.includes('decoded.close?.()'),
  "Worker must explicitly release full-resolution canvas and bitmap ownership");
assert.ok(uploadPreparationWorkerSource.includes('prepared.transfer') && uploadPreparationWorkerSource.includes('self.postMessage('),
  "prepared buffers must cross the Worker boundary via a transfer list");
assert.ok(!adminJs.includes('stateBadge.textContent = row.is_active ? "AKTYWNY" : "NIEAKTYWNY"'),
  "per-card active publication badges must be removed");
assert.ok(!adminJs.includes('const publicationState ='), "upload success copy must not expose active publication state");
assert.ok(!adminJs.includes('obrazów w bibliotece.'), "redundant library total prose must be removed");
assert.ok(!adminCss.includes(".migration-"), "migration-only CSS must be removed");
assert.ok(adminJs.includes("sessionStorage") === false,
  "session storage handling belongs in admin-auth.js, not scattered through admin UI");
assert.ok(adminHtml.includes("AVIF bez rekompresji"), "admin must disclose AVIF passthrough");
assert.ok(adminCss.includes("max-height: 480px"), "upload queue must be internally bounded");
assert.ok(adminCss.includes("overflow-y: auto"), "upload queue must scroll internally");
assert.ok(adminCss.includes('.queue-item[data-state="pending"]'), "pending state must be styled");
assert.ok(adminCss.includes('background: rgba(161, 106, 16, 0.08)'), "pending/duplicate rows must be visibly yellow/amber");
assert.ok(adminCss.includes('background: rgba(19, 138, 75, 0.08)'), "completed rows must be visibly green");
assert.ok(adminCss.includes('background: rgba(163, 51, 59, 0.10)'), "error rows must be visibly red");
assert.ok(adminJs.includes("uploadQueue.replaceChildren()"), "a new batch must clear previous queue rows");
assert.ok(adminJs.includes("files.map((file) => ({"), "all batch rows must be created before processing");
assert.ok(adminJs.includes("createQueueItem(file)"), "batch rows must be materialized immediately");
assert.ok(adminJs.includes("entry.queueItem.promoteToTop()"), "failed rows must be promoted to the top");
assert.ok(adminJs.includes("runPipelinedUploadBatch"), "batch processing must use the bounded prepare/commit pipeline");
assert.ok(adminJs.includes("sourceHashPreflightDone: true"), "UI must not repeat the source-hash preflight");
assert.ok(!adminJs.includes("repairPreparedAvifPayload"), "one-time payload repair path must be removed");
assert.ok(avifConverter.includes('source.mimeType === "image/avif"'), "AVIF passthrough branch must exist");
assert.ok(avifConverter.includes("sha256: source.sha256"), "AVIF passthrough must preserve exact source hash");
assert.ok(avifConverter.includes("passthrough: true"), "AVIF passthrough must be explicit in prepared metadata");
assert.ok(uploadBatchSource.includes("runPipelinedUploadBatch") && uploadBatchSource.includes("startPrepare"),
  "upload batch helper must expose the bounded prepare/commit pipeline");
assert.ok(adminJs.includes("prepareFile(file, contentClass, queueItem)") && adminJs.includes("commitPreparedFile"),
  "Admin upload must split heavy preparation from network commit");
assert.ok(adminJs.includes("sessionRefreshPromise"),
  "mutation session refresh must be single-flight while prepare and commit overlap");
assert.ok(uploadBatchSource.includes("shouldAbort"), "batch runner must support explicit fatal abort only");
assert.ok(!adminContent.includes('upsert ='),
  "Phase B must remove backfill-only Storage upsert support");
assert.ok(!adminContent.includes('"x-upsert"'),
  "normal production uploads must never request Storage overwrite");
assert.ok(!adminContent.includes('updateGameImageThumbnailPath'),
  "Phase B must remove the one-time thumbnail metadata patch helper");
assert.ok(!adminContent.includes('fetchPublicAvifBlob'),
  "Phase B must remove the one-time public-original downloader");
assert.ok(!adminContent.includes('registerInventoryThumbnail'),
  "Phase B must remove the one-time backfill registration helper");
assert.ok(adminContent.includes('thumbnail_path'), "authenticated Admin metadata must own the derived asset path");
assert.ok(adminContent.includes('thumbnail_public_url'), "Admin inventory normalization must expose the derived public URL");
assert.ok(!adminContent.includes("REPAIR_"), "migration repair errors must be removed");
assert.ok(!adminContent.includes("get_content_migration_status"), "migration RPC client must be removed");
assert.ok(!adminContent.includes("cutover_external_content"), "cutover RPC client must be removed");
assert.ok(!adminContent.includes("rollback_external_content_cutover"), "rollback RPC client must be removed");
assert.ok(adminAuth.includes("/auth/v1/token"));
assert.ok(adminAuth.includes("grant_type"));
assert.ok(adminAuth.includes("/auth/v1/user"));
assert.ok(adminAuth.includes("/auth/v1/logout"));
assert.ok(adminAuth.includes('buildUrl(resolved.projectUrl, "/auth/v1/logout", { scope: "local" })'));
assert.ok(adminAuth.includes("/rest/v1/rpc/is_current_user_admin"));
assert.ok(adminAuth.includes("sessionStorage"));
assert.ok(!adminAuth.includes("/auth/v1/signup"), "admin client must never expose public sign-up");
assert.ok(!adminAuth.includes("localStorage"), "admin tokens must use tab-scoped sessionStorage");
assert.ok(buildSiteSource.includes('"admin"'), "build must publish /admin directory");
assert.ok(buildSiteSource.includes('"assets"'), "build must publish the V1.6 runtime asset directory");
assert.ok(!buildSiteSource.includes("images/AI"), "build must not scan repository AI content");
assert.ok(!buildSiteSource.includes("images.json"), "build must not generate repository manifest");
assert.ok(!buildSiteSource.includes("MINIMUM_IMAGE_COUNT"), "build must not depend on repository pool size");
  assert.ok(workflow.includes("npm run test"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("Verify generated Pages artifact"));
  assert.ok(workflow.includes("test ! -e dist/data/images.json"), "workflow must reject generated repository manifest");
  assert.ok(workflow.includes("test ! -d dist/images"), "workflow must reject shipped repository images");
  assert.ok(workflow.includes("Repository image fallback leaked into production artifact."));
  assert.ok(workflow.includes("cancel-in-progress: false"));
  assert.ok(workflow.includes("actions/checkout@v7"));
  assert.ok(workflow.includes("actions/setup-node@v7"));
  assert.ok(workflow.includes("actions/configure-pages@v6"));
  assert.ok(workflow.includes("actions/upload-pages-artifact@v3"));
  assert.ok(workflow.includes("actions/deploy-pages@v4"));
  assert.ok(workflow.includes("actions: read"));
}

testSlidingPillGeometry();
await testSlidingPillLifecycle();
testSessionConfig();
await testDynamicRoundPreloader();
await testRoundSelector();
await testExternalContentSource();
await testAdminAuthContract();
await testAvifConversionContracts();
await testAdminStorageUsageContract();
await testAdminContentUploadContracts();
await testAdminInventoryPaginationAndDelete();
await testContentClassMoveLifecycle();
await testDeleteDrainCoordinatorLifecycle();
await testUploadPreparationWorkerClientLifecycle();
await testSequentialUploadBatchContinuity();
testGameModeRegistryContract();
await testPreGameTransitionLifecycle();
await testSupabaseOnlyBuild();
await testSwipeLifecycle();
await testImageReadinessContract();
await testAnswerFeedbackLifecycle();
await testPublicThemeController();
await testResultCelebrationLifecycle();
await testSourceContracts();

console.log("TEST PASS");
console.log("Simple sliding Session-size pill: PASS");
console.log("Session configuration 10/20/50: PASS");
console.log("Dynamic preloader 10/20/50: PASS");
console.log("Session selection 10/20/50 unique: PASS");
console.log("Supabase-only content source + pagination + controlled failure: PASS");
console.log("Admin password Auth + session refresh + RLS authority probe: PASS");
console.log("V1.5.8 Admin Storage usage RPC client contract: PASS");
console.log("V1.5.9.1 Admin delete-marker consistency corrective: PASS");
console.log("V1.5.9.3.1 Admin delete-marker + mobile grid corrective: PASS");
console.log("V1.5.9.3.2 Stable Library status slot corrective: PASS");
console.log("V1.5.9.4 Delete drain-until-quiescent temporal lifecycle: PASS");
console.log("V1.5.9.5 Upload Worker protocol + recovery + main-thread isolation: PASS");
console.log("V1.5.9.6 Admin move copy/commit/cleanup lifecycle + separate modes: PASS");
console.log("V1.5.9.3 Admin mutation concurrency corrective: PASS");
console.log("V1.5.7B.1 AVIF production + derived preview contracts: PASS");
console.log("V1.5.7B.1 dual-object upload + rollback contracts: PASS");
console.log("V1.5.7B.1 inventory preview/delete lifecycle + Phase B cleanup: PASS");
console.log("V1.5.6 sequential batch continuity + abort contract: PASS");
console.log("No forced AI/HUMAN ratio: PASS");
console.log("Cross-round repeats allowed + recent images deprioritized: PASS");
console.log("Supabase-only static build + no repository artifact leakage: PASS");
console.log("Swipe throw/handoff/return lifecycle: PASS");
console.log("Visible image decode readiness: PASS");
console.log("Mobile pointer capture/cancel recovery: PASS");
console.log("Answer feedback semantic lifecycle: PASS");
console.log("V1.6.0 public light/dark theme lifecycle + persistence: PASS");
console.log("V1.6.2.1 pre-game visual coherence corrective: PASS");
console.log("V1.6.2.2 pre-game interaction/copy/theme corrective: PASS");
console.log("V1.6.3 TEST results celebration/replay flow contracts: PASS");
console.log("V1.6.3-test.11 unified theme transition cleanup: PASS");
console.log("V1.6.4 gameplay visual coherence + threshold hint + feedback effects: PASS");
console.log("UI/deploy source contracts: PASS");
