import { ZipArchive } from "archiver";
import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

const excludePaths = ["apps/web/public/", "apps/web/src/assets"];
//
const root = process.cwd();
const outputPath = path.join(root, "project.zip");

console.log("Collecting files...");

// Git gives us files that are NOT ignored.
// --cached includes tracked files even if they are ignored now.
// --others --exclude-standard finds untracked files respecting .gitignore.
const result = await $`git ls-files -co --exclude-standard`.text();

const files = result
  .split("\n")
  .map(file => file.trim())
  .filter(Boolean)
  .filter(file => file !== "project.zip")
  .filter(file => !excludePaths.some(p => file.startsWith(p)));

console.log(`Found ${files.length} files.`);

const output = fs.createWriteStream(outputPath);

const archive = new ZipArchive({
  zlib: { level: 9 },
});

archive.on("error", error => {
  throw error;
});

output.on("close", () => {
  console.log(`✓ Created: ${outputPath}`);
  console.log(`✓ Size: ${(archive.pointer() / 1000000).toFixed(2)} MB`);
});

archive.pipe(output);

for (const file of files) {
  const absolutePath = path.join(root, file);

  archive.file(absolutePath, {
    name: file.replaceAll(path.sep, "/"),
  });
}

await archive.finalize();

await new Promise((resolve, reject) => {
  output.once("close", resolve);
  output.once("error", reject);
});
