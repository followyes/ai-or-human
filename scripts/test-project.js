import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build-site.js";
import { RoundSelector, recencyWeight } from "../js/round-selector.js";
import { SwipeController } from "../js/swipe-controller.js";
import {
  DEFAULT_SESSION_SIZE,
  MIN_SESSION_SIZE,
  SESSION_SIZE_OPTIONS,
  isSessionSizeAvailable,
  resolveSessionSize
} from "../js/session-config.js";
import { RoundPreloader, loadImageIntoElement } from "../js/image-preloader.js";

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

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
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

    controller.destroy();

    // Reduced-motion keeps the exact same hidden-handoff contract, only with shorter timings.
    globalThis.window.matchMedia = () => ({ matches: true });
    const reducedCard = new FakeCard();
    const reducedController = new SwipeController(reducedCard, { onDecision: () => {} });
    assert.equal(await reducedController.throw("human"), true);
    assert.equal(reducedCard.lastAnimationOptions.duration, 150);
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


async function copyRuntimeFixture(targetRoot) {
  for (const entry of ["index.html", "css", "js"]) {
    await fs.cp(path.join(projectRoot, entry), path.join(targetRoot, entry), { recursive: true });
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
  const sessionConfig = await fs.readFile(path.join(projectRoot, "js", "session-config.js"), "utf8");
  const workflow = await fs.readFile(path.join(projectRoot, ".github", "workflows", "pages.yml"), "utf8");

  assert.ok(!html.includes("final-percent"));
  assert.ok(!html.includes("reset-history"));
  assert.ok(!/[✓✕×]/u.test(html));
  assert.ok(html.includes('rel="icon"'));
  assert.ok(html.includes('data-session-size="10"'));
  assert.ok(html.includes('data-session-size="20"'));
  assert.ok(html.includes('data-session-size="50"'));
  assert.ok(!html.includes(">Sesja<"), "mode name must stay hidden until multiple modes exist");
  assert.ok(css.includes('font-family: "Segoe UI", sans-serif'));
  assert.ok(css.includes("touch-action: pan-y"));
  assert.ok(!css.includes("transition: opacity 120ms ease"), "image fade must not race the card handoff");
  assert.ok(css.includes("overflow-x: clip") || css.includes("overflow-x: hidden"));
  assert.ok(!game.includes("localStorage"));
  assert.ok(!game.includes("history.js"));
  assert.ok(game.includes("SESSION_SIZE_OPTIONS"));
  assert.ok(sessionConfig.includes("[10, 20, 50]"));
  assert.ok(game.includes("activeSessionSize"));
  assert.ok(game.includes("roundSize: requestedSessionSize"));
  assert.ok(!game.includes("FEEDBACK_HOLD_MS"), "swipe must not pause before throw");
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
  assert.ok(game.includes("Settings > Pages > Source = GitHub Actions"));
  assert.ok(!game.includes("Nie udało się wczytać katalogu obrazów ("));
  assert.ok(swipe.includes("pointerdown"));
  assert.ok(swipe.includes("pointermove"));
  assert.ok(swipe.includes("lostpointercapture"));
  assert.ok(!swipe.includes("touchstart"));
  assert.ok(!swipe.includes("touchmove"));
  assert.ok(swipe.includes("handoffPending"));
  assert.ok(swipe.includes("prepareHidden()"));
  assert.ok(swipe.includes("async reveal()"));
  assert.ok(workflow.includes("npm run test"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("Verify generated Pages artifact"));
  assert.ok(workflow.includes("dist/data/images.json"));
  assert.ok(workflow.includes("m.images.length < 10"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
  assert.ok(workflow.includes("actions/checkout@v7"));
  assert.ok(workflow.includes("actions/setup-node@v7"));
  assert.ok(workflow.includes("actions/configure-pages@v6"));
  assert.ok(workflow.includes("actions/upload-pages-artifact@v3"));
  assert.ok(workflow.includes("actions/deploy-pages@v4"));
  assert.ok(workflow.includes("actions: read"));
}

testSessionConfig();
await testDynamicRoundPreloader();
await testRoundSelector();
await testBuildSuccess();
await testBuildTooSmall();
await testCrossClassDuplicate();
await testSwipeLifecycle();
await testImageReadinessContract();
await testSourceContracts();

console.log("TEST PASS");
console.log("Session configuration 10/20/50: PASS");
console.log("Dynamic preloader 10/20/50: PASS");
console.log("Session selection 10/20/50 unique: PASS");
console.log("No forced AI/HUMAN ratio: PASS");
console.log("Cross-round repeats allowed + recent images deprioritized: PASS");
console.log("Build >=10 + unicode filenames: PASS");
console.log("Build <10 controlled failure: PASS");
console.log("Cross-class binary duplicate detection: PASS");
console.log("Swipe throw/handoff/return lifecycle: PASS");
console.log("Visible image decode readiness: PASS");
console.log("UI/deploy source contracts: PASS");
