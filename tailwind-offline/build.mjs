import postcss from "../node_modules/.pnpm/postcss@8.5.26/node_modules/postcss/lib/postcss.mjs";
import tailwindcss from "@tailwindcss/postcss";
import { readFile, writeFile } from "node:fs/promises";

const inputPath = new URL("./input.css", import.meta.url);
const outputPath = new URL(
  "../../../outputs/edgeone-production/styles.css",
  import.meta.url,
);

const source = await readFile(inputPath, "utf8");
const result = await postcss([tailwindcss({ optimize: true })]).process(source, {
  from: inputPath.pathname,
  to: outputPath.pathname,
});

await writeFile(outputPath, result.css);
