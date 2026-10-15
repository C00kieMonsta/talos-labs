/**
 * Talos Labs check-up from the terminal.
 *
 * Runs the talos-collect binary (or reads a saved SystemState JSON), evaluates the
 * result with the macOS catalog and prints a summary, or the full ScanReport with --json.
 *
 *   pnpm scan [--json] [--build] [<state.json>]
 *   pnpm exec tsx scripts/scan-cli.ts [--json] [--build] [<state.json>]
 *
 * --json   print the ScanReport as JSON instead of the summary
 * --build  run `cargo build --bin talos-collect` first; it also runs when the binary is missing
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertSystemState,
  evaluate,
  MACOS_CATALOG,
  SECTION_KEYS,
  type Evidence,
  type Finding,
  type ScanReport,
  type SystemState,
} from "../packages/core/src/index";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_DIR = join(REPO_ROOT, "apps", "desktop", "src-tauri");
const COLLECTOR = join(TAURI_DIR, "target", "debug", "talos-collect");

interface Options {
  json: boolean;
  build: boolean;
  file: string | null;
}

function fail(message: string): never {
  console.error(`scan-cli: ${message}`);
  process.exit(1);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { json: false, build: false, file: null };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--build") {
      options.build = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: pnpm scan [--json] [--build] [<state.json>]");
      process.exit(0);
    } else if (arg.startsWith("-")) {
      fail(`unknown flag ${arg}`);
    } else if (options.file === null) {
      options.file = arg;
    } else {
      fail("only one state file may be given");
    }
  }
  return options;
}

function buildCollector(): void {
  console.error("scan-cli: building talos-collect");
  const result = spawnSync("cargo", ["build", "--quiet", "--bin", "talos-collect"], {
    cwd: TAURI_DIR,
    stdio: "inherit",
  });
  if (result.error) fail(`could not run cargo: ${result.error.message}`);
  if (result.status !== 0) fail("cargo build --bin talos-collect failed");
}

/** Progress lines go to stderr; the JSON document is stdout. */
function runCollector(): string {
  const result = spawnSync(COLLECTOR, [], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`could not run ${COLLECTOR}: ${result.error.message}`);
  if (result.status !== 0) fail(`talos-collect exited with status ${result.status}`);
  return result.stdout;
}

function loadState(options: Options): SystemState {
  let text: string;
  if (options.file !== null) {
    try {
      text = readFileSync(resolve(options.file), "utf8");
    } catch (error) {
      fail(`could not read ${options.file}: ${describe(error)}`);
    }
  } else {
    if (options.build || !existsSync(COLLECTOR)) buildCollector();
    text = runCollector();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`collector output is not JSON: ${describe(error)}`);
  }
  try {
    assertSystemState(parsed);
    return parsed;
  } catch (error) {
    fail(`collector output does not match SystemState: ${describe(error)}`);
  }
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatEvidence(entry: Evidence): string {
  const value = entry.value;
  if (value.kind === "number") {
    return `${entry.label}: ${value.value}${value.unit === null ? "" : ` ${value.unit}`}`;
  }
  return `${entry.label}: ${String(value.value)}`;
}

function findingLines(finding: Finding): string[] {
  const points = finding.status === "fail" ? `  (+${finding.points} points when fixed)` : "";
  const reason = finding.status === "unknown" ? `  [${finding.unknownReason ?? "unknown"}]` : "";
  const lines = [`  ${finding.ruleId}  ${finding.severity.padEnd(8)} ${finding.headline}${points}${reason}`];
  for (const entry of finding.evidence) {
    lines.push(`      ${formatEvidence(entry)}`);
  }
  return lines;
}

function group(title: string, findings: readonly Finding[]): string[] {
  const lines = [``, `${title} (${findings.length})`];
  if (findings.length === 0) lines.push("  none");
  for (const finding of findings) lines.push(...findingLines(finding));
  return lines;
}

function summary(state: SystemState, report: ScanReport): string {
  const host = report.platform;
  const score = report.score;
  const counts = score.counts;
  const lines: string[] = [
    `Talos Labs check-up: ${host.os} ${host.osVersion}${host.osBuild === null ? "" : ` (${host.osBuild})`} ${host.arch}, collected ${report.collectedAt}`,
    `Catalog ${report.catalogVersion}, ${report.cisEdition}, core ${report.coreVersion}, report ${report.reportId}`,
    `Score ${score.value ?? "n/a"}, grade ${score.grade ?? "n/a"}, deducted ${score.deducted}, complete ${yesNo(score.complete)}, capped by critical ${yesNo(score.cappedByCritical)}`,
    `Counts: pass ${counts.pass}, fail ${counts.fail}, review ${counts.review}, unknown ${counts.unknown}, not applicable ${counts.not_applicable}`,
  ];
  lines.push(...group("Needs fixing", report.findings.filter((f) => f.status === "fail")));
  lines.push(...group("Worth a look", report.findings.filter((f) => f.status === "review")));
  lines.push(...group("Couldn't check", report.findings.filter((f) => f.status === "unknown")));

  const unavailable = SECTION_KEYS.filter((key) => state.sections[key].status === "unavailable");
  lines.push(``, `Sections unavailable (${unavailable.length})`);
  if (unavailable.length === 0) lines.push("  none");
  for (const key of unavailable) {
    const section = state.sections[key];
    if (section.status !== "unavailable") continue;
    lines.push(`  ${key}: ${section.reason}${section.detail === null ? "" : ` (${section.detail})`}`);
  }
  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const state = loadState(options);
const report = evaluate(state, MACOS_CATALOG, { now: new Date().toISOString(), os: state.host.os });
if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(summary(state, report));
}
