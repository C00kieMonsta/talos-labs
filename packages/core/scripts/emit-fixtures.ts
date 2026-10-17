import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA } from "../src/explainer/schemas";
import { FIXTURES } from "../src/fixtures/index";
import { fixCatalogJson } from "../src/rules/fix-catalog";
import { MACOS_CATALOG } from "../src/rules/macos/index";

/** Recursively sorts object keys so the JSON on disk is stable across runs. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(outDir, { recursive: true });
for (const [name, state] of Object.entries(FIXTURES)) {
  const file = join(outDir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(sortKeys(state), null, 2)}\n`);
  console.log(`wrote ${file}`);
}
// Source key order, not sorted: the Rust parity test compares parsed values and the file reads like schemas.ts.
const schemasFile = join(outDir, "explainer-schemas.json");
writeFileSync(schemasFile, `${JSON.stringify({ explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA }, null, 2)}\n`);
console.log(`wrote ${schemasFile}`);
const catalogFile = join(outDir, "fix-catalog.json");
writeFileSync(catalogFile, fixCatalogJson(MACOS_CATALOG));
console.log(`wrote ${catalogFile}`);
