/** R2.4A acceptance: one persistent, player-scoped, shared image cycle. */
import assert from "node:assert/strict";
import { ImageRotation, IMAGE_ROTATION_STORAGE_PREFIX } from "../js/image-rotation.js";
import { SpeedRunDeck } from "../js/speed-run.js";
import { LoginPlaceholderController, LOGIN_EXAMPLES, containsLoginWhitespace, rejectWhitespaceEdit } from "../js/login-placeholder.js";

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}
function makeImages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `img-${index}`, src: `image-${index}`, type: index % 2 ? "human" : "ai"
  }));
}
function seeded(seed = 10) {
  let value = seed;
  return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 2 ** 32; };
}
function createRotation(storage, playerId, count, seed = 11) {
  return new ImageRotation(makeImages(count), { storage, playerId, rng: seeded(seed) });
}
function play(rotation, count) {
  const deck = rotation.select(count);
  assert.equal(deck.length, count);
  assert.equal(new Set(deck.map((item) => item.id)).size, count,
    "no image may repeat inside a fixed-length Classic session");
  deck.forEach((image) => rotation.recordExposure(image.id));
  return deck.map((item) => item.id);
}

// Cross-session uniqueness until entire catalog is seen (including reload).
for (const count of [20, 50, 100, 120, 150, 301]) {
  const storage = new FakeStorage();
  const images = makeImages(count);
  const playerId = `player-${count}`;
  const rotation = new ImageRotation(images, { playerId, storage, rng: seeded(88) });
  const observed = play(rotation, count);
  assert.equal(new Set(observed).size, count);
  const fresh = new ImageRotation(images, { playerId, storage, rng: seeded(89) });
  assert.equal(fresh.seenCount, count, "full cycle survives a new page session");
  assert.notEqual(fresh.select(1)[0].id, observed.at(-1), "avoid immediate repeat on the next cycle");
}

{
  const storage = new FakeStorage();
  const id = "player-full-catalog";
  const observed = new Set();
  const rounds = [20, 20, 50];
  for (const size of rounds) {
    const rotation = createRotation(storage, id, 120, 88);
    const deck = play(rotation, size);
    for (const imageId of deck) {
      assert.ok(!observed.has(imageId), "no repeats across Classic sessions while unseen images remain");
      observed.add(imageId);
    }
  }
  assert.equal(observed.size, 90);
  const rotation = createRotation(storage, id, 120, 91);
  const nextHundred = rotation.select(100);
  assert.equal(new Set(nextHundred.map((image) => image.id)).size, 100);
  assert.ok(nextHundred.slice(0, 30).every((image) => !observed.has(image.id)),
    "all 30 remaining never-seen items must precede the next cycle");
  nextHundred.forEach((image) => rotation.recordExposure(image.id));
}
{
  const storage = new FakeStorage();
  const rotation = createRotation(storage, "player-100-plus-20", 120);
  const a = play(rotation, 100);
  const b = play(rotation, 20);
  assert.equal(new Set([...a, ...b]).size, 120,
    "100 -> 20 must use all 120 items before any repeat");
  assert.equal(new Set(play(rotation, 50)).size, 50);
}

// Selecting and preloading is never an exposure. A cancelled session preserves unseen images.
{
  const storage = new FakeStorage();
  const rotation = createRotation(storage, "player-cancel", 100);
  const planned = rotation.select(100);
  assert.equal(rotation.seenCount, 0);
  assert.equal(storage.values.size, 0);
  rotation.recordExposure(planned[0].id);
  const reloaded = createRotation(storage, "player-cancel", 100);
  assert.equal(reloaded.seenCount, 1);
  assert.ok(!reloaded.select(99).some((item) => item.id === planned[0].id));
}

// Two Markos, one browser: Player ID isolates rotation (name is not an identity).
{
  const storage = new FakeStorage();
  const first = createRotation(storage, "marco-profile-1", 120, 9);
  const seenFirst = play(first, 100);
  const second = createRotation(storage, "marco-profile-2", 120, 9);
  assert.equal(second.seenCount, 0);
  assert.equal(second.select(20).length, 20);
  assert.equal(createRotation(storage, "marco-profile-1", 120).seenCount, 100);
  assert.equal(seenFirst.length, 100);
}

// Catalog changes retire deleted IDs and prioritize newly added items.
{
  const storage = new FakeStorage();
  const first = createRotation(storage, "catalog-change", 20);
  play(first, 20);
  const changed = new ImageRotation([
    ...makeImages(18), { id: "new-img", src: "new-img" }
  ], { storage, playerId: "catalog-change", rng: seeded(12) });
  assert.equal(changed.seenCount, 18);
  assert.equal(changed.select(1)[0].id, "new-img");
}

// Broken resources are excluded from the current run, not globally deleted.
{
  const storage = new FakeStorage();
  const rotation = createRotation(storage, "failure", 20);
  const excluded = new Set(["img-3", "img-4"]);
  const prepared = rotation.select(18, { invalidIds: excluded });
  assert.ok(prepared.every((image) => !excluded.has(image.id)));
  assert.throws(() => rotation.select(20, { invalidIds: excluded }), /eligible/);
}


// A retired image must not prevent subsequent full-cycle resets in Speed Run.
{
  const rotation = new ImageRotation(makeImages(5), { rng: seeded(58) });
  const broken = new Set(["img-4"]);
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    const item = rotation.select(1, { invalidIds: broken })[0];
    samples.push(item.id);
    rotation.recordExposure(item.id, { invalidIds: broken });
  }
  for (let offset = 0; offset < 12; offset += 4) {
    assert.equal(new Set(samples.slice(offset, offset+4)).size, 4,
      "cycles must still reset properly when an unavailable image is retired");
  }
  assert.ok(samples.every((id) => id !== "img-4"));
}

// One rolling Speed Run uses the same history as Classic, including after returning.
{
  const storage = new FakeStorage();
  const playerId = "classic-and-speed";
  const classic = createRotation(storage, playerId, 120, 33);
  const seenClassic = new Set(play(classic, 20));
  const speedRotation = createRotation(storage, playerId, 120, 45);
  const speedDeck = new SpeedRunDeck(speedRotation, { preload: async () => {}, ahead: 3 });
  const seenSpeed = [];
  for (let index = 0; index < 40; index += 1) {
    const item = await speedDeck.next();
    assert.ok(!seenClassic.has(item.id));
    assert.ok(!seenSpeed.includes(item.id));
    seenSpeed.push(item.id);
    speedRotation.recordExposure(item.id);
  }
  speedDeck.cancel();
  const resumedClassic = createRotation(storage, playerId, 120, 78);
  const afterSpeed = resumedClassic.select(50);
  assert.ok(afterSpeed.every((item) => !seenClassic.has(item.id) && !seenSpeed.includes(item.id)));
}

// Speed Run prefetch does not persist anything before reveal; two full cycles remain unique.
{
  const rotation = new ImageRotation(makeImages(20), { rng: seeded(50) });
  let count = 0;
  const deck = new SpeedRunDeck(rotation, { preload: async () => { count += 1; }, ahead: 3 });
  const all = [];
  for (let i = 0; i < 41; i += 1) {
    const item = await deck.next();
    all.push(item.id);
    rotation.recordExposure(item.id);
  }
  assert.equal(new Set(all.slice(0, 20)).size, 20);
  assert.equal(new Set(all.slice(20, 40)).size, 20);
  assert.notEqual(all[19], all[20]);
  assert.ok(count <= all.length + 3, "only bounded preloading is allowed");
  deck.cancel();
}

// Graceful storage corruption / denied access.
{
  const storage = new FakeStorage();
  const key = `${IMAGE_ROTATION_STORAGE_PREFIX}bad-state`;
  storage.setItem(key, "{not-json");
  const rotation = createRotation(storage, "bad-state", 20);
  assert.equal(rotation.seenCount, 0);
  const denied = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  const fallback = new ImageRotation(makeImages(20), { playerId: "denied", storage: denied });
  play(fallback, 20);
  assert.equal(fallback.seenCount, 20);
}

// Login: only sample aliases, never an actual player name; reject whitespace.
assert.equal(LOGIN_EXAMPLES.length, 7);
assert.equal(new Set(LOGIN_EXAMPLES).size, 7);
assert.ok(LOGIN_EXAMPLES.every((name) => /^[A-Za-z0-9_-]{2,20}$/.test(name)));
assert.equal(containsLoginWhitespace("Jan Nowak"), true);
assert.equal(containsLoginWhitespace("Jan\tNowak"), true);
assert.equal(containsLoginWhitespace("Jan\u00a0Nowak"), true);
assert.equal(rejectWhitespaceEdit("Jan Nowak", "Jan"), "Jan");
assert.equal(rejectWhitespaceEdit("PixelFox", ""), "PixelFox");
{
  const input = { value: "", readOnly: false, placeholder: "Login" };
  const callbacks = [];
  const controller = new LoginPlaceholderController(input, {
    reducedMotion: () => false,
    rng: seeded(13),
    schedule: (fn) => { callbacks.push(fn); return callbacks.length; },
    cancel: () => {}
  });
  controller.start();
  assert.ok(input.placeholder.length > 0);
  for (let i = 0; i < 200; i += 1) callbacks.shift()?.();
  assert.ok(input.placeholder.length > 0);
  input.value = "Byte";
  callbacks.shift()?.();
  assert.equal(controller.running, false);
  assert.equal(input.value, "Byte");
  assert.equal(input.placeholder, "Login");
  input.value = "";
  controller.start();
  assert.equal(controller.running, true);
  controller.stop();
  assert.equal(controller.running, false);
  const reduced = new LoginPlaceholderController(input, { reducedMotion: () => true });
  reduced.start();
  assert.ok(LOGIN_EXAMPLES.includes(input.placeholder));
  assert.equal(reduced.running, false);
  input.readOnly = true;
  reduced.start();
  assert.equal(input.placeholder, "Login");
}

console.log("R2.4A IMAGE ROTATION + LOGIN PASS");
