import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { advanceAnswerStreak, isStreakMilestone } from "../js/answer-streak.js";
import {
  DEFAULT_STREAK_MESSAGES, createStreakMessageBag,
  normalizeStreakMessage, normalizeStreakMessages, fetchPublicStreakMessages
} from "../js/streak-messages.js";
import {
  listAdminStreakMessages, addAdminStreakMessage,
  updateAdminStreakMessage, deleteAdminStreakMessage
} from "../js/admin-streak-messages.js";

for (const n of [3, 10, 20, 30, 40, 100, 150]) assert.equal(isStreakMilestone(n), true);
for (const n of [0, 1, 2, 4, 9, 11, 19, 21, 99]) assert.equal(isStreakMilestone(n), false);
let streak = 0, awards = [];
for (let n = 1; n <= 120; n++) {
  const result = advanceAnswerStreak(streak, "correct");
  streak = result.streak;
  if (result.milestone !== null) awards.push(result.milestone);
}
assert.deepEqual(awards, [3, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
assert.deepEqual(advanceAnswerStreak(22, "timeout"), { streak: 0, milestone: null });
assert.deepEqual(advanceAnswerStreak(22, "incorrect"), { streak: 0, milestone: null });
assert.equal(advanceAnswerStreak(2, "correct").milestone, 3);
assert.equal(normalizeStreakMessage("  Brawo   brawo! "), "Brawo brawo!");
assert.equal(normalizeStreakMessage("test\nnewline"), null);
assert.equal(normalizeStreakMessage("x".repeat(61)), null);
assert.deepEqual(normalizeStreakMessages(["Wow", "wow", "  WOW  ", "Brawo"]), ["Wow", "Brawo"]);
for (const size of [1, 2, 5]) {
  const items = ["A", "B", "C", "D", "E"].slice(0, size);
  for (const rng of [() => 0, () => .999, () => .53]) {
    const bag = createStreakMessageBag(items, rng);
    let previous = null;
    for (let cycle = 0; cycle < 12; cycle++) {
      const cycleSet = new Set();
      for (let i = 0; i < size; i++) {
        const next = bag.next();
        assert.ok(items.includes(next));
        assert.ok(!cycleSet.has(next), `Duplicate within ${size}-entry bag`);
        if (size > 1) assert.notEqual(next, previous, "Immediate repeat across shuffled cycles");
        cycleSet.add(next);
        previous = next;
      }
      assert.equal(cycleSet.size, size);
    }
  }
}
assert.equal(createStreakMessageBag([], () => 0).size, DEFAULT_STREAK_MESSAGES.length);
const config = { projectUrl: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
const fetchOk = async (url, options) => {
  assert.match(String(url), /streak_messages/);
  assert.equal(options.headers.apikey, config.publishableKey);
  return { ok: true, json: async () => [{ message: "Dobra robota!" }, { message: "Dobra robota!" }, { message: "Super!" }] };
};
assert.deepEqual(await fetchPublicStreakMessages({ config, fetchImpl: fetchOk }), ["Dobra robota!", "Super!"]);
assert.deepEqual(await fetchPublicStreakMessages({ config, fetchImpl: async () => { throw new Error("offline"); } }), [...DEFAULT_STREAK_MESSAGES]);
assert.deepEqual(await fetchPublicStreakMessages({ config, fetchImpl: async () => ({ ok: false, status: 404 }) }), [...DEFAULT_STREAK_MESSAGES]);
assert.deepEqual(await fetchPublicStreakMessages({ config, fetchImpl: async () => ({ ok: true, json: async () => [] }) }), [...DEFAULT_STREAK_MESSAGES]);
const session = { access_token: "ADMIN_JWT" };
const requests = [];
const mockAdmin = async (url, options) => {
  requests.push({ url: String(url), options });
  return { ok: true, json: async () => options.method === "GET" ? [{ id: "1", message: "Brawo!" }] : [{ id: "1", message: "Brawo!" }] };
};
const UUID = "123e4567-e89b-42d3-a456-426614174000";
await listAdminStreakMessages({ config, session, fetchImpl: mockAdmin });
await addAdminStreakMessage("Brawo!", { config, session, fetchImpl: mockAdmin });
await updateAdminStreakMessage(UUID, "Świetnie!", { config, session, fetchImpl: mockAdmin });
await deleteAdminStreakMessage(UUID, { config, session, fetchImpl: mockAdmin });
assert.deepEqual(requests.map(({ options }) => options.method), ["GET", "POST", "PATCH", "DELETE"]);
assert.ok(requests.every(({ options }) => options.headers.Authorization === "Bearer ADMIN_JWT"));
assert.ok(requests[2].url.includes(`id=eq.${UUID}`));
await assert.rejects(listAdminStreakMessages({ config, session, fetchImpl: async () => ({ ok: false, status: 403 }) }), { code: "SESSION", status: 403 });
await assert.rejects(addAdminStreakMessage("Brawo!", { config, session, fetchImpl: async () => ({ ok: false, status: 409 }) }), { code: "DUPLICATE" });
await assert.rejects(listAdminStreakMessages({ config, session, fetchImpl: async () => { throw new Error("offline"); } }), { code: "NETWORK" });
assert.equal(normalizeStreakMessage("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
const adminUi = await readFile(new URL("../js/admin-streak-ui.js", import.meta.url), "utf8");
assert.match(adminUi, /label\.textContent = row\.message/, "Untrusted reward copy must render as text, never HTML");
assert.doesNotMatch(adminUi, /innerHTML/, "Do not create HTML injection surfaces");
assert.rejects(addAdminStreakMessage("  ", { config, session, fetchImpl: mockAdmin }));
await assert.rejects(addAdminStreakMessage("Nowy", { config, session: {}, fetchImpl: mockAdmin }));
const html = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../admin/admin.js", import.meta.url), "utf8");
const game = await readFile(new URL("../js/game.js", import.meta.url), "utf8");
const publicHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
for (const id of ["tab-streak", "streak-workspace", "streak-admin-list", "streak-admin-form", "streak-admin-input", "streak-admin-add", "streak-admin-status"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} missing / duplicated`);
}
assert.match(admin, /new AdminStreakPanel/);
assert.match(admin, /streakPanel\.clear\(\)/);
assert.equal((game.match(/await streakCelebration\.play\(streakResult\.milestone, streakMessageBag\.next\(\)\)/g) || []).length, 2);
assert.match(game, /streakMessageBag = createStreakMessageBag\(streakMessagesCache\)/);
assert.match(game, /fetchPublicStreakMessages\(\)/);
assert.match(publicHtml, /id="profile-dialog-title">Nazwa gracza<\/h2>/);
assert.match(publicHtml, /id="player-name"[^>]*aria-labelledby="profile-dialog-title"/, "Input uses the visible heading as its accessible label");
assert.doesNotMatch(publicHtml, /<label[^>]+for="player-name"/, "No duplicate field label");
assert.equal((publicHtml.match(/>Nazwa gracza</g) || []).length, 1, "One visible player-name prompt");
assert.doesNotMatch(publicHtml, />Twój profil<\/h2>/);
console.log("R2.5 DYNAMIC REWARDS: milestones / shuffle / fallback / Admin API / DOM PASS");
