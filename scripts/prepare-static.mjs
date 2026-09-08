import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(projectRoot, "public");
const outputDir = path.join(projectRoot, "dist", "public");

async function copyStaticFiles(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyStaticFiles(sourcePath, destinationPath);
    else if (entry.isFile() && !entry.name.endsWith(".ts")) await copyFile(sourcePath, destinationPath);
  }
}

await copyStaticFiles(sourceDir, outputDir);
await copyFile(
  path.join(projectRoot, "node_modules", "bootstrap", "dist", "css", "bootstrap.min.css"),
  path.join(outputDir, "bootstrap.min.css"),
);
