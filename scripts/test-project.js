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
  cutoverExternalContent,
  deleteGameImage,
  fetchRepositoryMigrationTarget,
  findImageByHash,
  getContentMigrationStatus,
  listGameImages,
  registerPreparedImage,
  repairPreparedAvifPayload,
  rollbackExternalContentCutover
} from "../js/admin-content.js";
import {
  AVIF_ENCODER_MODULE_URL,
  convertSourceFileToAvif,
  encodeImageDataToAvif,
  formatBytes,
  inspectSourceFile,
  sha256Blob,
  validateSourceFile
} from "../js/avif-converter.js";
import {
  promoteQueueItem,
  runSequentialUploadBatch,
  summarizeUploadBatch
} from "../js/upload-batch.js";

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

async function writeSvg(filePath, label) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="white"/><text x="2" y="20">${label}</text></svg>`;
  await fs.writeFile(filePath, svg, "utf8");
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
    this.resolveFinished = null;
    this.rejectFinished = null;
    this.finished = new Promise((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });

    if (!deferred) queueMicrotask(() => this.resolveFinished());
  }

  cancel() {
    this.cancelled = true;
  }

  finish() {
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
    this.children = {
      icon: { textContent: "" },
      label: { textContent: "" },
      ring: { animate: () => new FakeAnimation() }
    };
    this.lastAnimationOptions = null;
  }

  querySelector(selector) {
    if (selector === "[data-feedback-icon]") return this.children.icon;
    if (selector === "[data-feedback-label]") return this.children.label;
    if (selector === "[data-feedback-ring]") return this.children.ring;
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
  for (const entry of ["index.html", "css", "js", "admin"]) {
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

  let localFetchCount = 0;
  const supabasePreferredFetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/game_images")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return makeJsonResponse(offset === 0 ? allRows.slice(0, 12) : []);
    }
    localFetchCount += 1;
    return makeJsonResponse({ images: makeImages(20) });
  };

  const preferred = await loadContentManifest({ config, fetchImpl: supabasePreferredFetch, minimumImageCount: 10 });
  assert.equal(preferred.source, "supabase");
  assert.equal(preferred.manifest.images.length, 12);
  assert.equal(localFetchCount, 0, "repository manifest must not be fetched when Supabase is usable");

  const fallbackManifest = {
    schemaVersion: 1,
    imageCount: 20,
    images: makeImages(20)
  };
  const fallbackFetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/game_images")) return makeJsonResponse([]);
    assert.equal(url, "./data/images.json");
    return makeJsonResponse(fallbackManifest);
  };

  const fallback = await loadContentManifest({ config, fetchImpl: fallbackFetch, minimumImageCount: 10 });
  assert.equal(fallback.source, "repository");
  assert.equal(fallback.manifest.imageCount, 20);
  assert.equal(fallback.fallbackReason?.code, "SUPABASE_POOL_TOO_SMALL");

  const unconfigured = await loadContentManifest({
    config: { projectUrl: "", publishableKey: "" },
    fetchImpl: async (input) => {
      assert.equal(String(input), "./data/images.json");
      return makeJsonResponse(fallbackManifest);
    }
  });
  assert.equal(unconfigured.source, "repository");
  assert.equal(unconfigured.fallbackReason, null);

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

  assert.equal(formatBytes(1024), "1.0 KB");
  assert.ok(AVIF_ENCODER_MODULE_URL.includes("@jsquash/avif@2.1.1"));

  const bad = new Blob([new Uint8Array([1])], { type: "text/plain" });
  Object.defineProperty(bad, "name", { value: "not-image.txt" });
  assert.throws(
    () => validateSourceFile(bad),
    (error) => error.code === "SOURCE_TYPE_UNSUPPORTED"
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

  assert.equal(
    createStoragePath("ai", { uuid: "11111111-1111-4111-8111-111111111111" }),
    "ai/11111111-1111-4111-8111-111111111111.avif"
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

    if (url.pathname === "/storage/v1/object/game-images/ai/11111111-1111-4111-8111-111111111111.avif") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "image/avif");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.equal(options.body.type, "image/avif");
      return makeJsonResponse({ Key: "ok" });
    }

    if (url.pathname === "/rest/v1/game_images" && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.content_class, "ai");
      assert.equal(body.storage_bucket, "game-images");
      assert.equal(body.storage_path, "ai/11111111-1111-4111-8111-111111111111.avif");
      assert.equal(body.original_filename, "photo.jpg");
      assert.equal(body.source_sha256, "a".repeat(64));
      assert.equal(body.avif_sha256, "b".repeat(64));
      assert.equal(Object.hasOwn(body, "is_active"), false,
        "V1.5.6 browser must not own publication state on INSERT");
      assert.equal(body.file_size_bytes, 3);
      return makeJsonResponse([{ id: "row-1", ...body, is_active: false }]);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await registerPreparedImage({
    session,
    contentClass: "ai",
    prepared,
    sourceHashPreflightDone: true,
    config,
    fetchImpl,
    storagePathFactory: () => "ai/11111111-1111-4111-8111-111111111111.avif"
  });

  assert.equal(result.row.id, "row-1");
  assert.equal(requests.length, 3, "UI-preflight path must avoid the duplicate source-hash request");
  const hashRequests = requests.filter(({ url, options }) =>
    url.pathname === "/rest/v1/game_images" && options.method !== "POST"
  );
  assert.equal(hashRequests.length, 1);
  assert.equal(hashRequests[0].url.searchParams.get("avif_sha256"), `eq.${"b".repeat(64)}`);

  await assert.rejects(
    () => registerPreparedImage({
      session,
      contentClass: "human",
      prepared: {
        ...prepared,
        source: { ...prepared.source, sha256: "d".repeat(64) },
        output: { ...prepared.output, sha256: "e".repeat(64) }
      },
      config,
      storagePathFactory: () => "human/22222222-2222-4222-8222-222222222222.avif",
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));

        if (url.pathname === "/rest/v1/game_images" && options.method !== "POST") {
          return makeJsonResponse([]);
        }

        if (url.pathname.includes("/storage/v1/object/game-images/human/22222222-2222-4222-8222-222222222222.avif")) {
          return makeJsonResponse({ Key: "ok" });
        }

        if (url.pathname === "/rest/v1/game_images" && options.method === "POST") {
          return makeJsonResponse(
            { code: "23505", message: "duplicate key" },
            { status: 409 }
          );
        }

        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          assert.deepEqual(
            JSON.parse(options.body),
            { prefixes: ["human/22222222-2222-4222-8222-222222222222.avif"] }
          );
          return makeJsonResponse([{ name: "human/22222222-2222-4222-8222-222222222222.avif" }]);
        }

        throw new Error(`Unexpected cleanup request: ${url}`);
      }
    }),
    (error) => error.code === "23505"
  );

  const exactSha = "c".repeat(64);
  const repairBlob = new Blob([new Uint8Array([7, 7, 7, 7])], { type: "image/avif" });
  const repairPrepared = {
    source: {
      filename: "repo.avif",
      mimeType: "image/avif",
      size: repairBlob.size,
      sha256: exactSha
    },
    output: {
      blob: repairBlob,
      mimeType: "image/avif",
      size: repairBlob.size,
      sha256: exactSha,
      width: 640,
      height: 480,
      passthrough: true
    }
  };
  const existingImage = {
    id: "33333333-3333-4333-8333-333333333333",
    content_class: "ai",
    original_filename: "repo.avif",
    source_sha256: exactSha,
    avif_sha256: "d".repeat(64),
    storage_path: "ai/33333333-3333-4333-8333-333333333333.avif",
    is_active: false
  };
  const repairRequests = [];
  const repaired = await repairPreparedAvifPayload({
    session,
    existingImage,
    contentClass: "ai",
    prepared: repairPrepared,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      repairRequests.push({ url, options });

      if (url.pathname === "/rest/v1/game_images" && options.method !== "PATCH") {
        assert.equal(url.searchParams.get("avif_sha256"), `eq.${exactSha}`);
        return makeJsonResponse([]);
      }

      if (url.pathname === "/storage/v1/object/game-images/ai/33333333-3333-4333-8333-333333333333.avif") {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-upsert"], "true");
        assert.equal(options.body, repairBlob);
        return makeJsonResponse({ Key: "repaired" });
      }

      if (url.pathname === "/rest/v1/game_images" && options.method === "PATCH") {
        assert.equal(url.searchParams.get("id"), "eq.33333333-3333-4333-8333-333333333333");
        const body = JSON.parse(options.body);
        assert.deepEqual(body, {
          avif_sha256: exactSha,
          width: 640,
          height: 480,
          file_size_bytes: 4
        });
        return makeJsonResponse([{ ...existingImage, ...body }]);
      }

      throw new Error(`Unexpected repair request: ${url}`);
    }
  });

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.row.avif_sha256, exactSha);
  assert.equal(repairRequests.length, 3);

  await assert.rejects(
    () => repairPreparedAvifPayload({
      session,
      existingImage: { ...existingImage, is_active: true },
      contentClass: "ai",
      prepared: repairPrepared,
      config,
      fetchImpl: async () => {
        throw new Error("active repair must fail before any network request");
      }
    }),
    (error) => error.code === "REPAIR_ACTIVE_FORBIDDEN"
  );
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

  const activeImage = {
    id: "33333333-3333-4333-8333-333333333333",
    content_class: "ai",
    storage_path: "ai/active.avif",
    original_filename: "active.jpg",
    is_active: true
  };
  const activeRequests = [];

  await assert.rejects(
    () => deleteGameImage({
      session,
      image: activeImage,
      config,
      fetchImpl: async (input, options = {}) => {
        const url = new URL(String(input));
        activeRequests.push({ url, options });

        if (url.pathname === "/rest/v1/game_images" && options.method === "PATCH") {
          const body = JSON.parse(options.body);
          return makeJsonResponse([{ ...activeImage, is_active: body.is_active }]);
        }

        if (url.pathname === "/storage/v1/object/game-images" && options.method === "DELETE") {
          return makeJsonResponse(
            { code: "storage_failure", message: "simulated" },
            { status: 500 }
          );
        }

        throw new Error(`Unexpected active delete request: ${url}`);
      }
    }),
    (error) => error.code === "storage_failure"
  );

  assert.deepEqual(
    activeRequests.map(({ url, options }) => [
      url.pathname,
      options.method,
      options.body && typeof options.body === "string"
        ? JSON.parse(options.body).is_active
        : null
    ]),
    [
      ["/rest/v1/game_images", "PATCH", false],
      ["/storage/v1/object/game-images", "DELETE", undefined],
      ["/rest/v1/game_images", "PATCH", true]
    ]
  );
}


async function testProductionMigrationContracts() {
  const config = {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_test_public_key"
  };
  const session = { access_token: "admin-access-token" };

  const entries = [
    ...Array.from({ length: 7 }, (_, index) => ({
      sha256: index.toString(16).padStart(64, "0"),
      type: "ai"
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      sha256: (index + 100).toString(16).padStart(64, "0"),
      type: "human"
    }))
  ];

  const target = await fetchRepositoryMigrationTarget({
    manifestUrl: "../data/images.json",
    fetchImpl: async (input, options = {}) => {
      assert.equal(String(input), "../data/images.json");
      assert.equal(options.cache, "no-store");
      return makeJsonResponse({
        schemaVersion: 1,
        imageCount: 12,
        images: entries.map((entry, index) => ({
          id: entry.sha256,
          src: `./images/${entry.type === "ai" ? "AI" : "HUMAN"}/${index}.avif`,
          type: entry.type
        }))
      });
    }
  });

  assert.equal(target.total, 12);
  assert.equal(target.ai, 7);
  assert.equal(target.human, 5);
  assert.deepEqual(target.entries, entries);

  const readyStatus = {
    expected: { total: 12, ai: 7, human: 5 },
    runtime: { external_live: false, cutover_at: null, cutover_by: null },
    metadata: { total: 12, ai: 7, human: 5, active: 0, inactive: 12 },
    storage: { total: 12, ai: 7, human: 5 },
    integrity: { metadata_missing_storage: 0, storage_orphans: 0 },
    identity: {
      missing_expected: 0,
      unexpected_metadata: 0,
      class_mismatch: 0,
      payload_mismatch: 0
    },
    ready_for_cutover: true,
    live_matches_expected: false
  };

  const status = await getContentMigrationStatus({
    session,
    expectedManifest: target.entries,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/get_content_migration_status");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer admin-access-token");
      assert.deepEqual(JSON.parse(options.body), {
        p_expected_manifest: entries
      });
      return makeJsonResponse(readyStatus);
    }
  });
  assert.equal(status.ready_for_cutover, true);
  assert.equal(status.identity.missing_expected, 0);

  const liveStatus = {
    ...readyStatus,
    runtime: {
      external_live: true,
      cutover_at: "2026-09-29T18:00:00Z",
      cutover_by: "11111111-1111-4111-8111-111111111111"
    },
    metadata: { total: 12, ai: 7, human: 5, active: 12, inactive: 0 },
    ready_for_cutover: false,
    live_matches_expected: true
  };

  const cutover = await cutoverExternalContent({
    session,
    expectedManifest: target.entries,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/cutover_external_content");
      assert.deepEqual(JSON.parse(options.body), {
        p_expected_manifest: entries
      });
      return makeJsonResponse(liveStatus);
    }
  });
  assert.equal(cutover.live_matches_expected, true);
  assert.equal(cutover.metadata.active, 12);

  const rollback = await rollbackExternalContentCutover({
    session,
    config,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/rollback_external_content_cutover");
      assert.deepEqual(JSON.parse(options.body), {});
      return makeJsonResponse({
        external_live: false,
        changed: true,
        active_count: 0
      });
    }
  });
  assert.equal(rollback.external_live, false);

  await assert.rejects(
    () => fetchRepositoryMigrationTarget({
      fetchImpl: async () => makeJsonResponse({
        imageCount: 10,
        images: [
          { id: "not-a-sha", src: "./images/AI/a.avif", type: "ai" },
          ...Array.from({ length: 9 }, (_, index) => ({
            id: (index + 200).toString(16).padStart(64, "0"),
            src: `./images/HUMAN/${index}.avif`,
            type: "human"
          }))
        ]
      })
    }),
    (error) => error.code === "MIGRATION_EXPECTED_MANIFEST_INVALID"
  );

  await assert.rejects(
    () => fetchRepositoryMigrationTarget({
      fetchImpl: async () => makeJsonResponse({
        imageCount: 10,
        images: [
          ...Array.from({ length: 5 }, (_, index) => ({
            id: (index + 300).toString(16).padStart(64, "0"),
            src: `./images/AI/${index}.png`,
            type: "ai"
          })),
          ...Array.from({ length: 5 }, (_, index) => ({
            id: (index + 400).toString(16).padStart(64, "0"),
            src: `./images/HUMAN/${index}.avif`,
            type: "human"
          }))
        ]
      })
    }),
    (error) => error.code === "MIGRATION_MANIFEST_FORMAT_INVALID"
  );
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
}

async function testBuildSuccess() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-or-human-build-ok-"));
  await copyRuntimeFixture(tempRoot);

  for (let i = 0; i < 13; i += 1) {
    await writeSvg(path.join(tempRoot, "images", "AI", `AI zażółć ${i}.svg`), `AI-${i}`);
  }
  for (let i = 0; i < 12; i += 1) {
    await writeSvg(path.join(tempRoot, "images", "HUMAN", `Human photo (${i}).svg`), `H-${i}`);
  }

  const result = await buildSite({ projectRoot: tempRoot });
  assert.equal(result.imageCount, 25);
  const manifest = JSON.parse(await fs.readFile(path.join(tempRoot, "dist", "data", "images.json"), "utf8"));
  assert.equal(manifest.imageCount, 25);
  assert.ok(manifest.images.some((item) => item.src.includes("%C5%BC")), "unicode paths must be URL encoded");
  assert.ok(manifest.images.every((item) => ["ai", "human"].includes(item.type)));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "index.html")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "admin", "index.html")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "admin", "admin.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "admin-content.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "avif-converter.js")));
  assert.ok(await fs.stat(path.join(tempRoot, "dist", "js", "upload-batch.js")));

  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testBuildTooSmall() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-or-human-build-small-"));
  await copyRuntimeFixture(tempRoot);

  for (let i = 0; i < 9; i += 1) {
    await writeSvg(path.join(tempRoot, "images", "AI", `${i}.svg`), `ONLY-${i}`);
  }

  await assert.rejects(
    () => buildSite({ projectRoot: tempRoot }),
    (error) => error?.code === "MINIMUM_IMAGE_COUNT"
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testCrossClassDuplicate() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-or-human-build-dup-"));
  await copyRuntimeFixture(tempRoot);

  const same = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>`;
  await fs.mkdir(path.join(tempRoot, "images", "AI"), { recursive: true });
  await fs.mkdir(path.join(tempRoot, "images", "HUMAN"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "images", "AI", "same.svg"), same, "utf8");
  await fs.writeFile(path.join(tempRoot, "images", "HUMAN", "same.svg"), same, "utf8");

  for (let i = 0; i < 20; i += 1) {
    await writeSvg(path.join(tempRoot, "images", "AI", `extra-${i}.svg`), `EXTRA-${i}`);
  }

  await assert.rejects(
    () => buildSite({ projectRoot: tempRoot }),
    (error) => error?.code === "CROSS_CLASS_DUPLICATE"
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testSourceContracts() {
  const html = await fs.readFile(path.join(projectRoot, "index.html"), "utf8");
  const css = await fs.readFile(path.join(projectRoot, "css", "style.css"), "utf8");
  const game = await fs.readFile(path.join(projectRoot, "js", "game.js"), "utf8");
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
  const buildSiteSource = await fs.readFile(path.join(projectRoot, "scripts", "build-site.js"), "utf8");

  assert.ok(!html.includes("final-percent"));
  assert.ok(!html.includes("reset-history"));
  assert.ok(html.includes("data-feedback-icon"));
  assert.ok(html.includes("data-feedback-label"));
  assert.ok(html.includes('rel="icon"'));
  assert.ok(html.includes('data-session-size="10"'));
  assert.ok(html.includes('data-session-size="20"'));
  assert.ok(html.includes('data-session-size="50"'));
  assert.equal((html.match(/data-session-indicator aria-hidden/g) || []).length, 2,
    "both pickers must have one moving pill indicator");
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
assert.ok(contentSource.includes('/rest/v1/game_images'));
assert.ok(contentSource.includes('cache: "no-store"'));
assert.ok(contentSource.includes('apikey: resolved.publishableKey'));
assert.ok(!contentSource.includes('Authorization:'));
assert.ok(contentSource.includes('while (true)'));
assert.ok(contentSource.includes('offset += rows.length'));
assert.ok(contentSource.includes('/storage/v1/object/public/'));
assert.ok(contentSource.includes('source: "repository"'));
assert.ok(contentSource.includes('source: "supabase"'));
assert.ok(supabaseConfig.includes('projectUrl: "https://kopmcnabslumyweebjgf.supabase.co"'));
assert.ok(supabaseConfig.includes('publishableKey: "sb_publishable_'));
assert.ok(!/publishableKey:\s*["']sb_secret_/i.test(supabaseConfig), "browser config must never contain a Supabase secret key");
assert.ok(!supabaseConfig.includes('sb_secret_') || supabaseConfig.includes('NEVER place an sb_secret_'));
  assert.ok(game.includes("SessionSizePicker"));
  assert.ok(game.includes("syncSessionSizeControls({ animate: true })"));
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
  assert.ok(game.includes("SESSION_SIZE_OPTIONS"));
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
  assert.ok(contentSource.includes("./data/images.json"));
  assert.ok(contentSource.includes("REPOSITORY_MANIFEST_HTTP_ERROR"));
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
assert.ok(adminJs.includes("Legacy quality warning"), "payload mismatch must be shown as an explicit warning");
assert.ok(adminJs.includes("payload mismatch"), "payload mismatch reporting stays visible");
assert.ok(adminCss.includes(".migration-check.is-warning"), "migration warning needs a dedicated visual state");
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
assert.ok(adminJs.includes("runSequentialUploadBatch"), "batch processing must use the tested sequential runner");
assert.ok(adminJs.includes("sourceHashPreflightDone: true"), "UI must not repeat the source-hash preflight");
assert.ok(adminJs.includes("repairPreparedAvifPayload"), "pre-corrective AVIF payloads must be repairable in place");
assert.ok(adminJs.includes("payload_mismatch"), "migration UI must surface exact AVIF payload mismatch");
assert.ok(avifConverter.includes('source.mimeType === "image/avif"'), "AVIF passthrough branch must exist");
assert.ok(avifConverter.includes("sha256: source.sha256"), "AVIF passthrough must preserve exact source hash");
assert.ok(avifConverter.includes("passthrough: true"), "AVIF passthrough must be explicit in prepared metadata");
assert.ok(uploadBatchSource.includes("for (let index = 0; index < entries.length; index += 1)"), "batch runner must remain sequential");
assert.ok(uploadBatchSource.includes("shouldAbort"), "batch runner must support explicit fatal abort only");
assert.ok(adminContent.includes('"x-upsert": "true"'), "repair path must upsert the exact AVIF payload");
assert.ok(adminContent.includes("REPAIR_ACTIVE_FORBIDDEN"), "repair must refuse active production rows");
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
  assert.ok(workflow.includes("npm run test"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("Verify generated Pages artifact"));
  assert.ok(workflow.includes("dist/data/images.json"));
  const workflowMinMatch = workflow.match(/m\.images\.length\s*<\s*(\d+)/);
  assert.ok(workflowMinMatch, "Pages workflow must verify the generated manifest minimum");
  assert.equal(Number(workflowMinMatch[1]), 10, "Pages workflow minimum must match the 10-image Session option");
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
await testAdminContentUploadContracts();
await testAdminInventoryPaginationAndDelete();
await testProductionMigrationContracts();
await testSequentialUploadBatchContinuity();
await testBuildSuccess();
await testBuildTooSmall();
await testCrossClassDuplicate();
await testSwipeLifecycle();
await testImageReadinessContract();
await testAnswerFeedbackLifecycle();
await testSourceContracts();

console.log("TEST PASS");
console.log("Simple sliding Session-size pill: PASS");
console.log("Session configuration 10/20/50: PASS");
console.log("Dynamic preloader 10/20/50: PASS");
console.log("Session selection 10/20/50 unique: PASS");
console.log("External Supabase content source + pagination + migration fallback: PASS");
console.log("Admin password Auth + session refresh + RLS authority probe: PASS");
console.log("V1.5.4 AVIF conversion contracts: PASS");
console.log("V1.5.4 staged Storage + metadata upload contracts: PASS");
console.log("V1.5.5 inventory pagination + Delete X lifecycle: PASS");
console.log("V1.5.6 production migration + cutover RPC contracts: PASS");
console.log("V1.5.6 sequential batch continuity + abort contract: PASS");
console.log("No forced AI/HUMAN ratio: PASS");
console.log("Cross-round repeats allowed + recent images deprioritized: PASS");
console.log("Build >=10 + unicode filenames: PASS");
console.log("Build <10 controlled failure: PASS");
console.log("Cross-class binary duplicate detection: PASS");
console.log("Swipe throw/handoff/return lifecycle: PASS");
console.log("Visible image decode readiness: PASS");
console.log("Mobile pointer capture/cancel recovery: PASS");
console.log("Answer feedback semantic lifecycle: PASS");
console.log("UI/deploy source contracts: PASS");
