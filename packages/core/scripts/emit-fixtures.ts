import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatInstructions } from "../src/explainer/remote";
import { ANSWER_JSON_SCHEMA, CHAT_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, WATCH_JSON_SCHEMA } from "../src/explainer/schemas";
import { buildOnDeviceWatchInstructions, buildWatchJudgeInstructions } from "../src/explainer/watch-prompt";
import { FIXTURES } from "../src/fixtures/index";
import { fixCatalogJson } from "../src/rules/fix-catalog";
import { MACOS_CATALOG } from "../src/rules/macos/index";
import { watchCasesJson } from "../src/watch/cases";
import { playbookJson } from "../src/watch/playbook";

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
writeFileSync(schemasFile, `${JSON.stringify({ explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA, watch: WATCH_JSON_SCHEMA, chat: CHAT_JSON_SCHEMA }, null, 2)}\n`);
console.log(`wrote ${schemasFile}`);
const catalogFile = join(outDir, "fix-catalog.json");
writeFileSync(catalogFile, fixCatalogJson(MACOS_CATALOG));
console.log(`wrote ${catalogFile}`);
// The watch contracts: the playbook rows, the parity cases and the two instruction texts Rust include_str!s.
const playbookFile = join(outDir, "playbook.json");
writeFileSync(playbookFile, playbookJson());
console.log(`wrote ${playbookFile}`);
const casesFile = join(outDir, "watch-cases.json");
writeFileSync(casesFile, watchCasesJson());
console.log(`wrote ${casesFile}`);
// The judge's text: the frozen prompt, the reason rules, then the watch block; Rust include_str!s it.
const instructionsFile = join(outDir, "watch-instructions.txt");
writeFileSync(instructionsFile, buildWatchJudgeInstructions());
console.log(`wrote ${instructionsFile}`);
// The chat task's instructions: the frozen prompt, the chat block and the plain names; the watch text above must not change.
const chatFile = join(outDir, "chat-instructions.txt");
writeFileSync(chatFile, buildChatInstructions());
console.log(`wrote ${chatFile}`);
const onDeviceFile = join(outDir, "watch-instructions-on-device.txt");
writeFileSync(onDeviceFile, buildOnDeviceWatchInstructions());
console.log(`wrote ${onDeviceFile}`);
