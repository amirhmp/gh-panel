// Bundles the project into project.zip: every file git does not ignore
// (tracked, or untracked but not in .gitignore). Run with `npm run zip`
// (or `bun scripts/zip.ts`).
import { ZipArchive } from "archiver";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const excludePaths = ["apps/web/public/", "apps/web/src/assets"];

const root = process.cwd();
const outputPath = path.join(root, "project.zip");

console.log("Collecting files...");

// --cached includes tracked files even if they are ignored now.
// --others --exclude-standard finds untracked files respecting .gitignore.
const { stdout } = await promisify(execFile)(
  "git",
  ["ls-files", "-co", "--exclude-standard"],
  {
    maxBuffer: 64 * 1024 * 1024,
  },
);

const files = stdout
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => file !== "project.zip")
  .filter((file) => !excludePaths.some((p) => file.startsWith(p)));

console.log(`Found ${files.length} files.`);

const output = fs.createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

archive.on("error", (error) => {
  throw error;
});

output.on("close", () => {
  console.log(`✓ Created: ${outputPath}`);
  console.log(`✓ Size: ${(archive.pointer() / 1000000).toFixed(2)} MB`);
});

archive.pipe(output);

for (const file of files) {
  archive.file(path.join(root, file), { name: file.replaceAll(path.sep, "/") });
}

await archive.finalize();

await new Promise<void>((resolve, reject) => {
  output.once("close", () => resolve());
  output.once("error", reject);
});
