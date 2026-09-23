import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPPORTED_EXTENSIONS = new Set([
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

const CLASS_FOLDERS = Object.freeze([
  { diskName: "AI", type: "ai" },
  { diskName: "HUMAN", type: "human" }
]);

const MIN_IMAGE_COUNT = 10;

async function walkImages(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const results = [];
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkImages(absolutePath));
    } else if (
      entry.isFile() &&
      SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      results.push(absolutePath);
    }
  }

  return results;
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function toEncodedWebPath(projectRoot, absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);
  const encoded = relative
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `./${encoded}`;
}

async function collectImages(projectRoot) {
  const byHash = new Map();

  for (const classification of CLASS_FOLDERS) {
    const classRoot = path.join(projectRoot, "images", classification.diskName);
    const files = await walkImages(classRoot);

    for (const absolutePath of files) {
      const hash = await sha256(absolutePath);
      const existing = byHash.get(hash);

      if (existing && existing.type !== classification.type) {
        const error = new Error(
          `Ten sam plik występuje jednocześnie jako AI i HUMAN: ${existing.src} / ` +
          `${toEncodedWebPath(projectRoot, absolutePath)}`
        );
        error.code = "CROSS_CLASS_DUPLICATE";
        throw error;
      }

      if (!existing) {
        byHash.set(hash, {
          id: hash,
          src: toEncodedWebPath(projectRoot, absolutePath),
          type: classification.type,
          absolutePath
        });
      }
    }
  }

  const images = [...byHash.values()].sort((a, b) => a.src.localeCompare(b.src, "en"));

  if (images.length < MIN_IMAGE_COUNT) {
    const error = new Error(
      `Gra wymaga co najmniej ${MIN_IMAGE_COUNT} unikalnych obrazów. Wykryto: ${images.length}.`
    );
    error.code = "MINIMUM_IMAGE_COUNT";
    throw error;
  }

  return images;
}

async function copyRuntime(projectRoot, distRoot) {
  const runtimeEntries = ["index.html", "css", "js"];

  for (const entry of runtimeEntries) {
    const source = path.join(projectRoot, entry);
    const target = path.join(distRoot, entry);
    const stat = await fs.stat(source);

    if (stat.isDirectory()) {
      await fs.cp(source, target, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    }
  }
}

async function copyManifestImages(projectRoot, distRoot, images) {
  for (const image of images) {
    const relative = path.relative(projectRoot, image.absolutePath);
    const target = path.join(distRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(image.absolutePath, target);
  }
}

export async function buildSite({ projectRoot, distRoot = path.join(projectRoot, "dist") } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  const images = await collectImages(projectRoot);

  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(distRoot, { recursive: true });
  await copyRuntime(projectRoot, distRoot);
  await copyManifestImages(projectRoot, distRoot, images);

  const manifest = {
    schemaVersion: 1,
    imageCount: images.length,
    images: images.map(({ id, src, type }) => ({ id, src, type }))
  };

  const dataRoot = path.join(distRoot, "data");
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.writeFile(
    path.join(dataRoot, "images.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );


  return {
    imageCount: images.length,
    aiCount: images.filter((image) => image.type === "ai").length,
    humanCount: images.filter((image) => image.type === "human").length,
    distRoot
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");

  buildSite({ projectRoot })
    .then((result) => {
      console.log("BUILD PASS");
      console.log(`AI: ${result.aiCount}`);
      console.log(`HUMAN: ${result.humanCount}`);
      console.log(`Razem: ${result.imageCount}`);
      console.log(`Output: ${result.distRoot}`);
    })
    .catch((error) => {
      console.error(`BUILD FAIL [${error.code || "ERROR"}]: ${error.message || error}`);
      process.exitCode = 1;
    });
}
