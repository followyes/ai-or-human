import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LocalPlayerProfiles, LOCAL_PROFILES_STORAGE_KEY, parseLocalProfileState } from "../js/player-profiles.js";
import { calculateAccuracy, createCompletedResult, ResultOutbox, submitCompletedResult, PENDING_RESULTS_KEY } from "../js/game-results.js";

const repoRoot = new URL("../", import.meta.url);
const store = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    _values: values
  };
};
let idIndex = 1;
const uuid = () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(idIndex++).padStart(12, "0")}`;
const storage = store();
storage.setItem("ai-or-human.player-name", "Marek");
const first = new LocalPlayerProfiles({ storage, uuid });
assert.equal(first.profiles.length, 1, "existing V1.7.1B nickname should migrate to profile");
assert.equal(first.active.name, "Marek");
assert.equal(first.persisted, true);
const browserId = first.browserId;
const originalPlayer = first.active.id;
const second = first.create("Marek");
assert.notEqual(originalPlayer, second.id);
assert.equal(first.browserId, browserId, "switching players cannot rotate browser id");
assert.equal(first.profiles.length, 2);
first.activate(originalPlayer);
assert.equal(first.active.id, originalPlayer);
const revisit = new LocalPlayerProfiles({ storage, uuid, legacyName: null });
assert.equal(revisit.browserId, browserId, "revisit after any time reuses origin ID");
assert.equal(revisit.profiles.length, 2);
assert.equal(revisit.active.id, originalPlayer);
assert.equal(revisit.activate(second.id)?.id, second.id);
assert.equal(revisit.activate("missing"), null);
assert.equal(revisit.create("Anna").name, "Anna");
assert.throws(() => revisit.create("two words"));
assert.equal(parseLocalProfileState("this is not json"), null);
assert.equal(parseLocalProfileState(JSON.stringify({ version: 1, browserId, activeId: originalPlayer, profiles: [{id: originalPlayer, name: "<script>"}]})), null);
const deniedStorage = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } };
const inMemory = new LocalPlayerProfiles({ storage: deniedStorage, uuid });
assert.equal(inMemory.persisted, false);
assert.equal(inMemory.create("Marek").name, "Marek");
assert.notEqual(inMemory.browserId, browserId);
const secondDevice = new LocalPlayerProfiles({ storage: store(), uuid });
assert.notEqual(secondDevice.browserId, browserId);
assert.equal(calculateAccuracy(40, 50), 80);
assert.equal(calculateAccuracy(4, 7), 57.1);
assert.equal(calculateAccuracy(0, 20), 0);
assert.equal(calculateAccuracy(0, 0), null);
const payload = createCompletedResult({
  sessionId: uuid(), browserId, playerId: originalPlayer, playerName: "Marek",
  mode: "classic", selectedCards: 20, correct: 16, attempts: 20,
  finishedAt: "2026-10-23T12:30:00.000Z"
});
assert.ok(Object.isFrozen(payload));
assert.equal(payload.correct_answers, 16);
assert.equal(payload.finished_at_client, "2026-10-23T12:30:00.000Z");
assert.equal(payload.browser_id, browserId);
assert.ok(!("received_at" in payload), "client must never assign server receipt timestamp");
assert.throws(() => createCompletedResult({ ...{
  sessionId: uuid(), browserId, playerId: originalPlayer, playerName: "Marek",
  mode: "classic", selectedCards: 20, correct: 21, attempts: 20
}}));
assert.throws(() => createCompletedResult({
  sessionId: uuid(), browserId, playerId: originalPlayer, playerName: "Marek",
  mode: "speed-run", difficulty: "insane", correct: 1, attempts: 2
}));
const speed = createCompletedResult({
  sessionId: uuid(), browserId, playerId: originalPlayer, playerName: "Marek",
  mode: "speed-run", difficulty: "hard", correct: 4, attempts: 7
});
assert.equal(speed.selected_cards, null);
assert.equal(calculateAccuracy(speed.correct_answers, speed.attempts), 57.1);
let requests = [];
const config = { projectUrl: "https://test.example.com", publishableKey: "sb_publishable_testing" };
const fakeFetch = async (url, init) => {
  requests.push({url, init});
  return { ok: true, status: 201 };
};
await submitCompletedResult(payload, { config, fetchImpl: fakeFetch });
assert.equal(requests[0].url, "https://test.example.com/rest/v1/game_results");
assert.equal(requests[0].init.method, "POST");
assert.equal(requests[0].init.headers.Prefer, "return=minimal");
assert.equal(requests[0].init.headers.apikey, config.publishableKey);
assert.equal(JSON.parse(requests[0].init.body).client_session_id, payload.client_session_id);
assert.ok(!("Authorization" in requests[0].init.headers));
await assert.rejects(submitCompletedResult(payload, {config, fetchImpl: async () => ({ok: false, status: 409})}), {code: "CONFLICT"});
await assert.rejects(submitCompletedResult(payload, {config, fetchImpl: async () => {throw new Error("offline");}}), {code: "NETWORK"});
let shouldFail = true;
let attemptedIds = [];
const pendingStorage = store();
const outbox = new ResultOutbox({storage: pendingStorage, submit: async (item) => {
  attemptedIds.push(item.client_session_id);
  if (shouldFail) throw Error("offline");
  return true;
}});
assert.equal(outbox.enqueue(payload), true);
assert.equal(outbox.enqueue(payload), true, "same session should not duplicate outbox record");
assert.equal(outbox.pending, 1);
let result = await outbox.retryAll();
assert.equal(result.pending, 1, "offline must retain immutable snapshot");
assert.equal(new ResultOutbox({storage: pendingStorage}).pending, 1, "pending survives reload");
shouldFail = false;
result = await outbox.retryAll();
assert.equal(result.saved, 1);
assert.equal(outbox.pending, 0);
assert.equal(attemptedIds[0], attemptedIds[1], "retry must preserve session ID");
assert.equal(new ResultOutbox({storage: pendingStorage}).pending, 0);
const otherGame = createCompletedResult({
  sessionId: uuid(), browserId, playerId: originalPlayer, playerName: "Marek",
  mode: "classic", selectedCards: 20, correct: 20, attempts: 20
});
assert.notEqual(payload.client_session_id, otherGame.client_session_id, "replay creates a different session ID");
const conflictOutbox = new ResultOutbox({storage: store(), submit: async () => { const e = new Error("conflict"); e.code = "CONFLICT"; throw e; }});
conflictOutbox.enqueue(otherGame);
assert.equal((await conflictOutbox.retryAll()).pending, 1, "duplicate cannot be treated as verified success");
const noStorageOutbox = new ResultOutbox({storage: deniedStorage, submit: async () => true});
assert.equal(noStorageOutbox.enqueue(otherGame), true);
assert.equal(noStorageOutbox.storageAvailable, false);
assert.equal((await noStorageOutbox.retryAll()).pending, 0);
const sql = await readFile(new URL("../../OUTSIDE_REPO/SQL/V1_7_1B_R1.sql", import.meta.url), "utf8");
assert.ok(sql.includes("browser_id uuid NOT NULL") && sql.includes("client_session_id uuid NOT NULL UNIQUE"));
assert.ok(sql.includes("ENABLE ROW LEVEL SECURITY"));
assert.ok(/GRANT INSERT \(/.test(sql) && /\) ON TABLE public\.game_results TO anon/.test(sql));
assert.ok(!/GRANT\s+(SELECT|DELETE|UPDATE)/i.test(sql));
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const game = await readFile(new URL("../js/game.js", import.meta.url), "utf8");
assert.ok(html.includes('id="change-player-button"') && html.includes('id="local-player-list"'));
assert.ok(html.includes('id="result-accuracy"') && html.includes('id="result-save-status"'));
assert.ok(game.includes("activeGameSessionId = newGameSessionId()"));
assert.ok(game.includes("resultsOutbox.enqueue(snapshot)"));
assert.ok(!game.includes("savePlayerName"), "no legacy overwrite of profile name");
console.log("R1 TEST PASS — local profiles, duplicate names, browser ID, retry/outbox, result contract, SQL permissions");
