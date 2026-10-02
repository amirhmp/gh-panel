// Builds everything into dist/ with esbuild (tsc only type-checks):
//   dist/server.js          the server, one ESM file (npm packages stay external)
//   dist/public/app.js      the browser app (Hono JSX DOM runtime bundled in)
//   dist/public/styles.css  src/ui/styles/index.css with its imports inlined
//   dist/public/*           src/ui/assets/ copied as is (panel icon)
//
//   npm run build           everything
//   npm run dev:ui          UI only (--ui), rebuilt on change (--watch)
import { build, context, type BuildOptions } from "esbuild";
import { cp, rm } from "node:fs/promises";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const uiOnly = args.has("--ui");

const shared: BuildOptions = { bundle: true, logLevel: "info" };

const server: BuildOptions = {
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.js",
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  jsx: "automatic",
  jsxImportSource: "hono/jsx",
};

const client: BuildOptions = {
  ...shared,
  entryPoints: ["src/ui/client/main.tsx"],
  outfile: "dist/public/app.js",
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: !watch,
  sourcemap: watch,
  jsx: "automatic",
  jsxImportSource: "hono/jsx/dom",
};

const styles: BuildOptions = {
  ...shared,
  entryPoints: ["src/ui/styles/index.css"],
  outfile: "dist/public/styles.css",
  minify: !watch,
};

const targets = uiOnly ? [client, styles] : [server, client, styles];

await rm(uiOnly ? "dist/public" : "dist", { recursive: true, force: true });

await cp("src/ui/assets", "dist/public", { recursive: true });

if (watch) {
  const contexts = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(targets.map((t) => build(t)));
}
