import { build } from "esbuild";
import { cp, mkdir, rm, readFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["public/app.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/app.js",
  target: "es2022",
});
await build({
  entryPoints: ["public/styles.css"],
  minify: true,
  outfile: "dist/styles.css",
});
const css = await readFile("public/styles.css", "utf8");
if (
  /(?:font-family\s*:[^;}]*\b(?:Inter|Roboto|Arial|Helvetica|Geist|system-ui)\b|fonts\.googleapis)/i.test(
    css,
  )
)
  throw new Error("Unexpected font");
console.log("Production assets built; Paper Mono audit passed.");
