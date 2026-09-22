import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const manifestPath = path.join(root, "data", "images.json");

function fail(message) {
  throw new Error(message);
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.images)) fail("images.json: brak tablicy images.");

  const ids = new Set();
  let ai = 0;
  let human = 0;

  for (const item of manifest.images) {
    if (!item?.id || !item?.src || !["ai", "human"].includes(item?.type)) {
      fail("images.json: nieprawidłowy rekord obrazu.");
    }

    if (ids.has(item.id)) fail(`images.json: zduplikowane ID ${item.id}.`);
    ids.add(item.id);

    const normalizedSrc = item.src.replace(/^\.\//, "");
    const decodedSegments = normalizedSrc.split("/").map((segment) => decodeURIComponent(segment));
    const absolutePath = path.join(root, ...decodedSegments);

    await fs.access(absolutePath);

    const expectedFolder = item.type === "ai" ? "images/AI/" : "images/HUMAN/";
    if (!normalizedSrc.startsWith(expectedFolder)) {
      fail(`${item.src}: typ nie zgadza się z folderem.`);
    }

    const actualHash = await sha256(absolutePath);
    if (actualHash !== item.id) {
      fail(`${item.src}: ID SHA-256 nie zgadza się z zawartością pliku.`);
    }

    if (item.type === "ai") ai += 1;
    else human += 1;
  }

  if (manifest.imageCount !== manifest.images.length) {
    fail("images.json: imageCount nie zgadza się z liczbą rekordów.");
  }

  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const css = await fs.readFile(path.join(root, "css", "style.css"), "utf8");
  const gameJs = await fs.readFile(path.join(root, "js", "game.js"), "utf8");
  const historyJs = await fs.readFile(path.join(root, "js", "history.js"), "utf8");
  const workflow = await fs.readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");

  if (html.includes("reset-history-button")) {
    fail("Publiczny reset historii nadal występuje w projekcie.");
  }

  if (gameJs.includes("localStorage") || historyJs.includes("localStorage")) {
    fail("Historia obrazów nadal używa trwałego localStorage.");
  }

  if (!gameJs.includes("resetSessionHistory();")) {
    fail("Brak resetu historii sesji przy pełnym załadowaniu strony.");
  }

  if (html.includes("final-percent")) {
    fail("Ekran wyniku nadal zawiera procent.");
  }

  if (html.includes("niewidzianych obrazów") || gameJs.includes("niewidzianych obrazów pozostało")) {
    fail("Interfejs nadal pokazuje techniczny licznik pozostałej puli.");
  }

  if (html.includes("✓") || html.includes("✕") || html.includes("×")) {
    fail("Przyciski nadal zawierają sugerujące ikony odpowiedzi.");
  }

  if (/#[0-9a-f]{6}/i.test(css.match(/(?:human|ai)[^}]*}/gi)?.join(" ") || "")) {
    fail("W CSS wykryto osobne kolory przypisane do odpowiedzi AI/HUMAN.");
  }

  const fontFamilyDeclarations = [...css.matchAll(/font-family\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
  if (fontFamilyDeclarations.length !== 1 || fontFamilyDeclarations[0] !== '"Segoe UI", sans-serif') {
    fail("Typografia UI nie jest ograniczona do jednego spójnego font-family.");
  }

  const fontWeights = new Set([...css.matchAll(/font-weight\s*:\s*(\d+)/g)].map((match) => Number(match[1])));
  if ([...fontWeights].some((weight) => ![500, 700].includes(weight))) {
    fail(`Wykryto nieuzgodnioną wagę fontu: ${[...fontWeights].sort().join(", ")}`);
  }

  if (!css.includes("overflow-x: clip") && !css.includes("overflow-x: hidden")) {
    fail("Brak ochrony viewportu przed poziomym rozszerzaniem podczas swipe.");
  }

  if (!css.includes("touch-action: pan-y")) {
    fail("Karta nie ma jawnego touch-action: pan-y.");
  }

  if (gameJs.includes("isTouchFirstDevice")) {
    fail("Swipe nadal zależy od kruchej detekcji typu urządzenia.");
  }

  if (!gameJs.includes('"PointerEvent" in window') || !gameJs.includes("touchstart")) {
    fail("Brak Pointer Events + fallback Touch Events.");
  }

  if (css.includes("transition-duration: 0.001ms !important;\n    animation-duration: 0.001ms")) {
    fail("Globalny reduced-motion nadal może całkowicie ukrywać animację swipe.");
  }

  if (!workflow.includes("npm run images") ||
      !workflow.includes("actions/upload-pages-artifact@v5") ||
      !workflow.includes("actions/deploy-pages@v4")) {
    fail("Workflow Pages nie generuje manifestu i nie wdraża strony automatycznie.");
  }

  if (!gameJs.includes("const ROUND_SIZE = 20;")) {
    fail("Runda nie ma ustawionego limitu 20 obrazów.");
  }

  console.log("AUDIT PASS");
  console.log(`AI: ${ai}`);
  console.log(`HUMAN: ${human}`);
  console.log(`Razem: ${manifest.images.length}`);
  console.log("Brak publicznego resetu historii: PASS");
  console.log("Historia tylko w pamięci strony; refresh resetuje sesję: PASS");
  console.log("Swipe: Pointer Events + Touch fallback + touch-action: PASS");
  console.log("GitHub Pages generuje manifest obrazów przed deployem: PASS");
  console.log("Brak procentu i technicznych liczników puli: PASS");
  console.log("Neutralne odpowiedzi bez ikon/kolorów sugerujących wybór: PASS");
  console.log("Jedna rodzina typograficzna, wagi 500/700: PASS");
  console.log("Ochrona viewportu podczas swipe: PASS");
  console.log("Limit rundy 20: PASS");
  console.log("Ścieżki, typy i SHA-256 obrazów: PASS");
}

main().catch((error) => {
  console.error(`AUDIT FAIL: ${error.message || error}`);
  process.exitCode = 1;
});
