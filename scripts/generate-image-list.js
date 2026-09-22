import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const imageRoot = path.join(projectRoot, "images");
const outputPath = path.join(projectRoot, "data", "images.json");

const folders = [
  { diskName: "AI", type: "ai" },
  { diskName: "HUMAN", type: "human" }
];

const supportedExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".jfif",
  ".png",
  ".bmp",
  ".webp",
  ".avif",
  ".gif",
  ".svg"
]);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...await walk(absolutePath));
      continue;
    }

    if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(absolutePath);
    }
  }

  return results;
}

function toWebPath(absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);
  const encoded = relative
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `./${encoded}`;
}

async function hashFile(absolutePath) {
  const contents = await fs.readFile(absolutePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function main() {
  const images = [];
  const classificationByHash = new Map();

  for (const folder of folders) {
    const directory = path.join(imageRoot, folder.diskName);
    await fs.mkdir(directory, { recursive: true });

    const files = await walk(directory);

    for (const absolutePath of files) {
      const hash = await hashFile(absolutePath);
      const existingType = classificationByHash.get(hash);

      if (existingType && existingType !== folder.type) {
        throw new Error(
          `Ten sam plik występuje w obu klasach: ${toWebPath(absolutePath)}. ` +
          `Usuń konflikt między AI i HUMAN.`
        );
      }

      classificationByHash.set(hash, folder.type);

      images.push({
        id: hash,
        src: toWebPath(absolutePath),
        type: folder.type
      });
    }
  }

  // Identyczne pliki w tym samym folderze traktujemy jako jeden obraz.
  const deduplicated = [...new Map(images.map((item) => [item.id, item])).values()]
    .sort((a, b) => a.src.localeCompare(b.src, "en"));

  const manifest = {
    generatedAt: new Date().toISOString(),
    imageCount: deduplicated.length,
    images: deduplicated
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const aiCount = deduplicated.filter((item) => item.type === "ai").length;
  const humanCount = deduplicated.filter((item) => item.type === "human").length;

  console.log(`Wygenerowano data/images.json`);
  console.log(`AI: ${aiCount}`);
  console.log(`HUMAN: ${humanCount}`);
  console.log(`Razem: ${deduplicated.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
