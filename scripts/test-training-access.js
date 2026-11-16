import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  redeemTrainingCode, validateTrainingToken, generateTrainingCodes, getTrainingCodeStats,
  getTrainingToken, saveTrainingToken, clearTrainingToken, TrainingAccessError
} from "../js/training-access.js";

const config = { projectUrl: "https://fake.supabase.co", publishableKey: "sb_publishable_test" };
const code = "TRN-ABCDEF12-1234ABCD-ABCDEF12-1234ABCD";
const token = "a".repeat(64);
const row = { code };
const calls = [];
const fetchImpl = async (url, opts) => {
  calls.push({ url, opts });
  const result = url.endsWith("/redeem_training_code") ? token
    : url.endsWith("/validate_training_access") ? true
    : url.endsWith("/generate_training_codes") ? [row]
    : [{ total_count: 5, unused_count: 4, used_count: 1 }];
  return { ok: true, status: 200, json: async () => result };
};
const opts = { config, fetchImpl };
assert.equal(await redeemTrainingCode(code.toLowerCase(), "Marek", opts), token);
assert.ok(calls[0].url.endsWith("/rest/v1/rpc/redeem_training_code"));
assert.ok(!("Authorization" in calls[0].opts.headers), "anon RPC must not contain admin auth");
assert.equal(calls[0].opts.headers.apikey, config.publishableKey);
assert.deepEqual(JSON.parse(calls[0].opts.body), { p_code: code, p_player_name: "Marek" });
assert.equal(await validateTrainingToken(token, "Marek", opts), true);
assert.equal(await validateTrainingToken("bad", "Marek", opts), false);
assert.deepEqual(await generateTrainingCodes(1, "jwt.admin", opts), [code]);
assert.equal(calls.at(-1).opts.headers.Authorization, "Bearer jwt.admin");
assert.deepEqual(await getTrainingCodeStats("jwt.admin", opts), { total_count: 5, unused_count: 4, used_count: 1 });
assert.equal(calls.at(-1).opts.headers.Authorization, "Bearer jwt.admin");
await assert.rejects(redeemTrainingCode("TRN-not-a-code", "Marek", opts), { code: "REJECTED" });
await assert.rejects(generateTrainingCodes(0, "jwt.admin", opts), { code: "COUNT" });
await assert.rejects(generateTrainingCodes(201, "jwt.admin", opts), { code: "COUNT" });
await assert.rejects(generateTrainingCodes(1, "", opts), { code: "FORBIDDEN" });
const rejectFetch = async () => ({ ok: false, status: 400, json: async () => ({ code: "P0001" }) });
await assert.rejects(redeemTrainingCode(code, "Marek", { ...opts, fetchImpl: rejectFetch }), { code: "REJECTED" });
const failFetch = async () => { throw new Error("offline"); };
await assert.rejects(validateTrainingToken(token, "Marek", { ...opts, fetchImpl: failFetch }), { code: "NETWORK" });
const storage = new Map();
const fakeStorage = { getItem: (k) => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: (k) => storage.delete(k) };
assert.equal(saveTrainingToken("profile-1", token, fakeStorage), true);
assert.equal(getTrainingToken("profile-1", fakeStorage), token);
clearTrainingToken("profile-1", fakeStorage);
assert.equal(getTrainingToken("profile-1", fakeStorage), null);
assert.ok(TrainingAccessError.prototype instanceof Error);
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../admin/index.html", import.meta.url), "utf8");
const game = await readFile(new URL("../js/game.js", import.meta.url), "utf8");
const admin = await readFile(new URL("../admin/admin.js", import.meta.url), "utf8");
for (const id of ["training-code", "training-code-help"]) assert.ok(html.includes(`id="${id}"`));
for (const id of ["tab-codes", "codes-workspace", "codes-count", "codes-generate", "codes-copy", "codes-output", "codes-stats"]) assert.ok(adminHtml.includes(`id="${id}"`));
assert.ok(game.includes("await validateTrainingToken(previousToken, profile.name)"));
assert.ok(game.includes("await redeemTrainingCode(code, profile.name)"));
assert.ok(game.includes("await requireTrainingAccess(localPlayers.active, trainingCodeInput.value)"));
assert.ok(game.includes("void prepareAndStartSession(trigger, \"Rozpocznij\")"));
assert.ok(admin.includes('import { AdminTrainingCodesPanel }'));
// SQL lives outside repo intentionally. Validate DB permissions through POSTCHECK and live API QA.
console.log("R3 TRAINING ACCESS TEST PASS — RPC, JWT, gate, errors, local token, DOM");
