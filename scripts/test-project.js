import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build-site.js";
import { RoundSelector, recencyWeight } from "../js/round-selector.js";

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

async function copyRuntimeFixture(targetRoot) {
  for (const entry of ["index.html", "css", "js"]) {
    await fs.cp(path.join(projectRoot, entry), path.join(targetRoot, entry), { recursive: true });
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

  for (let i = 0; i < 19; i += 1) {
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
  const workflow = await fs.readFile(path.join(projectRoot, ".github", "workflows", "pages.yml"), "utf8");

  assert.ok(!html.includes("final-percent"));
  assert.ok(!html.includes("reset-history"));
  assert.ok(!/[✓✕×]/u.test(html));
  assert.ok(css.includes('font-family: "Segoe UI", sans-serif'));
  assert.ok(css.includes("touch-action: pan-y"));
  assert.ok(css.includes("overflow-x: clip") || css.includes("overflow-x: hidden"));
  assert.ok(!game.includes("localStorage"));
  assert.ok(!game.includes("history.js"));
  assert.ok(swipe.includes("pointerdown"));
  assert.ok(swipe.includes("pointermove"));
  assert.ok(swipe.includes("lostpointercapture"));
  assert.ok(!swipe.includes("touchstart"));
  assert.ok(!swipe.includes("touchmove"));
  assert.ok(workflow.includes("npm run test"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("actions/upload-pages-artifact@v4"));
  assert.ok(workflow.includes("actions/deploy-pages@v4"));
}

await testRoundSelector();
await testBuildSuccess();
await testBuildTooSmall();
await testCrossClassDuplicate();
await testSourceContracts();

console.log("TEST PASS");
console.log("Round selection 20/20 unique: PASS");
console.log("No forced AI/HUMAN ratio: PASS");
console.log("Cross-round repeats allowed + recent images deprioritized: PASS");
console.log("Build >=20 + unicode filenames: PASS");
console.log("Build <20 controlled failure: PASS");
console.log("Cross-class binary duplicate detection: PASS");
console.log("UI/deploy source contracts: PASS");
