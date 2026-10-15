import type { Evidence, Fix, FixCommand } from "@talos/core";

export interface RenderedCommand {
  readonly text: string;
  readonly needsAdmin: boolean;
  readonly interactive: boolean;
}

const PLACEHOLDER = "{path}";
/** Anything outside this set is single-quoted so the shell cannot expand or split a filled path. */
const SAFE_ARG = /^[A-Za-z0-9_./@:=+,-]+$/;

function quote(value: string): string {
  return SAFE_ARG.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function join(program: string, args: readonly string[], needsAdmin: boolean): string {
  const parts = [program, ...args];
  return (needsAdmin ? "sudo " : "") + parts.join(" ");
}

/**
 * Fills {path} only from path-kind evidence whose key equals the command's appliesTo.
 * One rendered command per matching entry; none when nothing matches.
 */
export function renderCommand(command: FixCommand, evidence: readonly Evidence[]): RenderedCommand[] {
  if (command.appliesTo === null) {
    return [
      {
        text: join(command.program, command.args, command.needsAdmin),
        needsAdmin: command.needsAdmin,
        interactive: command.interactive,
      },
    ];
  }
  const target = command.appliesTo;
  const paths: string[] = [];
  for (const entry of evidence) {
    if (entry.key === target && entry.value.kind === "path") paths.push(entry.value.value);
  }
  return paths.map((path) => ({
    text: join(
      command.program,
      command.args.map((arg) => (arg.includes(PLACEHOLDER) ? quote(arg.split(PLACEHOLDER).join(path)) : arg)),
      command.needsAdmin,
    ),
    needsAdmin: command.needsAdmin,
    interactive: command.interactive,
  }));
}

export function renderCommands(fix: Fix, evidence: readonly Evidence[]): RenderedCommand[] {
  return fix.commands.flatMap((command) => renderCommand(command, evidence));
}
