import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIME_ENTRIES = Object.freeze(["index.html", "css", "js", "admin"]);

async function copyRuntime(projectRoot, distRoot) {
  for (const entry of RUNTIME_ENTRIES) {
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

export async function buildSite({ projectRoot, distRoot = path.join(projectRoot, "dist") } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(distRoot, { recursive: true });
  await copyRuntime(projectRoot, distRoot);

  return Object.freeze({
    contentSource: "supabase",
    distRoot
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");

  buildSite({ projectRoot })
    .then((result) => {
      console.log("BUILD PASS");
      console.log("Content source: Supabase only");
      console.log(`Output: ${result.distRoot}`);
    })
    .catch((error) => {
      console.error(`BUILD FAIL [${error.code || "ERROR"}]: ${error.message || error}`);
      process.exitCode = 1;
    });
}
