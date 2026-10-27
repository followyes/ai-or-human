/**
 * V1.7.1B-R1.3 — protect the browser bootstrap from dangling DOM references.
 * Missing required event targets stop game.js before *any* button receives a handler.
 * No browser / third-party dependency required in GitHub Actions.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../js/game.js", import.meta.url), "utf8");

const elementsById = new Map();
for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) {
  elementsById.set(match[1], (elementsById.get(match[1]) ?? 0) + 1);
}
for (const [id, count] of elementsById) {
  assert.equal(count, 1, `Duplicate DOM id: #${id}`);
}

// A directly-bound event target must always exist. Do not treat an optional
// telemetry/status UI node as optional if code unconditionally binds to it.
const directBindings = [...source.matchAll(/\b([A-Za-z_$][\w$]*)\.addEventListener\s*\(/g)]
  .map((match) => match[1]);
const documentBindings = new Map();
for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*document\.querySelector\(\s*(["'])(.*?)\2\s*\)/g)) {
  documentBindings.set(match[1], match[3]);
}
let checked = 0;
for (const name of new Set(directBindings)) {
  const selector = documentBindings.get(name);
  if (!selector) continue; // document, window, and event-local button references.
  const id = /^#([\w-]+)$/.exec(selector)?.[1] ?? null;
  if (!id) continue;
  assert.equal(elementsById.get(id), 1,
    `Browser bootstrap abort: ${name}.addEventListener targets missing #${id} in index.html`);
  checked += 1;
}
assert.ok(checked >= 18, `DOM bootstrap binding coverage regressed (${checked})`);

// These controls must remain available when queued results need manual retry.
for (const id of ["pending-result-tools", "pending-results-info", "retry-pending-button"]) {
  assert.equal(elementsById.get(id), 1, `Required offline-results control missing: #${id}`);
}
assert.match(html, /id="profile-dialog-backdrop"\s+hidden/, "Profile dialog must be closed initially");
// R2.1 nickname visibility contract: present a real player name prominently,
// not as a tiny muted "Gracz:" caption. Keep textContent for untrusted aliases.
const css = await readFile(new URL("../css/style.css", import.meta.url), "utf8");
assert.match(source, /resultPlayerName\.textContent\s*=\s*player\.name\s*\|\|\s*""/);
assert.match(css, /\.result-player-name\s*\{[^}]*font-size:\s*clamp\(1\.15rem/s);
assert.match(css, /\.result-player-name\s*\{[^}]*color:\s*var\(--landing-title\)/s);
assert.match(css, /\.result-player-name:empty\s*\{\s*display:\s*none;/);
assert.equal(elementsById.get("result-player-name"), 1);

console.log(`PUBLIC DOM BOOTSTRAP PASS (${checked} mandatory event targets)`);

// R2.2: dedicated, non-green streak overlay must have its own DOM and script.
for (const id of ["streak-celebration"]) {
  assert.equal(elementsById.get(id), 1, `Missing standalone streak reward #${id}`);
}
assert.match(source, /new StreakCelebrationController\(streakCelebrationElement\)/);
assert.match(source, /await streakCelebration\.play\(streakResult\.milestone\)/);
assert.doesNotMatch(source, /answerFeedback\.play\([^\n]*milestone\s*:/,
  "Streak message must never be passed to green DOBRZE feedback");
