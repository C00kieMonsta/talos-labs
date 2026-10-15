import { describe, expect, it } from "vitest";
import type { Evidence, Fix, FixCommand } from "@talos/core";
import { renderCommand, renderCommands } from "./placeholders";

const keyPath = (value: string): Evidence => ({ key: "keyPath", label: "Key", value: { kind: "path", value } });

const chmod: FixCommand = { program: "chmod", args: ["600", "{path}"], needsAdmin: false, interactive: false, appliesTo: "keyPath" };
const bootoutUser: FixCommand = {
  program: "launchctl",
  args: ["bootout", "gui/$UID", "{path}"],
  needsAdmin: false,
  interactive: false,
  appliesTo: "agentPlist",
};
const bootoutSystem: FixCommand = {
  program: "launchctl",
  args: ["bootout", "system", "{path}"],
  needsAdmin: true,
  interactive: false,
  appliesTo: "daemonPlist",
};
const guestOff: FixCommand = { program: "sysadminctl", args: ["-guestAccount", "off"], needsAdmin: true, interactive: false, appliesTo: null };

describe("renderCommand", () => {
  it("renders a command with appliesTo null exactly once, with sudo when admin", () => {
    expect(renderCommand(guestOff, [keyPath("/x")])).toEqual([
      { text: "sudo sysadminctl -guestAccount off", needsAdmin: true, interactive: false },
    ]);
  });

  it("fills {path} once per matching path evidence", () => {
    const out = renderCommand(chmod, [keyPath("/Users/a/.ssh/id_ed25519"), keyPath("/Users/a/.ssh/aws.pem")]);
    expect(out.map((c) => c.text)).toEqual(["chmod 600 /Users/a/.ssh/id_ed25519", "chmod 600 /Users/a/.ssh/aws.pem"]);
  });

  it("ignores evidence whose key does not match appliesTo", () => {
    const other: Evidence = { key: "dirPath", label: "Dir", value: { kind: "path", value: "/Users/a/.ssh" } };
    expect(renderCommand(chmod, [other])).toEqual([]);
  });

  it("ignores evidence of the right key but a non-path kind", () => {
    const text: Evidence = { key: "keyPath", label: "Key", value: { kind: "text", value: "/Users/a/.ssh/id" } };
    const enumValue: Evidence = { key: "keyPath", label: "Key", value: { kind: "enum", value: "openssh" } };
    expect(renderCommand(chmod, [text, enumValue])).toEqual([]);
  });

  it("renders nothing when a placeholder command has no matching evidence", () => {
    expect(renderCommand(chmod, [])).toEqual([]);
  });

  it("quotes a filled path that contains spaces and keeps $UID unquoted", () => {
    const agent: Evidence = { key: "agentPlist", label: "Plist", value: { kind: "path", value: "/Users/a b/Library/LaunchAgents/x.plist" } };
    const out = renderCommand(bootoutUser, [agent]);
    expect(out[0]?.text).toBe("launchctl bootout gui/$UID '/Users/a b/Library/LaunchAgents/x.plist'");
  });

  it("quotes a filled path that contains a dollar sign so the shell cannot expand it", () => {
    const agent = (value: string): Evidence => ({ key: "agentPlist", label: "Plist", value: { kind: "path", value } });
    expect(renderCommand(bootoutUser, [agent("/Users/a/Library/LaunchAgents/com.helper$USER.plist")])[0]?.text).toBe(
      "launchctl bootout gui/$UID '/Users/a/Library/LaunchAgents/com.helper$USER.plist'",
    );
    expect(renderCommand(bootoutUser, [agent("/Users/a/Library/LaunchAgents/x$IFS.plist")])[0]?.text).toBe(
      "launchctl bootout gui/$UID '/Users/a/Library/LaunchAgents/x$IFS.plist'",
    );
    expect(renderCommand(chmod, [keyPath("~/.ssh/id_rsa")])[0]?.text).toBe("chmod 600 '~/.ssh/id_rsa'");
  });

  it("rule 023 shape: each command only takes its own evidence key", () => {
    const fix: Fix = {
      summary: "Review background programs",
      settingsPath: ["System Settings", "General", "Login Items & Extensions"],
      settingsPane: "login_items",
      commands: [bootoutUser, bootoutSystem],
      steps: [],
      verify: null,
      effort: "ten_minutes",
      sideEffects: "workflow",
    };
    const evidence: Evidence[] = [
      { key: "agentPlist", label: "Agent", value: { kind: "path", value: "/Users/a/Library/LaunchAgents/a.plist" } },
      { key: "daemonPlist", label: "Daemon", value: { kind: "path", value: "/Library/LaunchDaemons/d.plist" } },
      { key: "agentPlist", label: "Agent", value: { kind: "path", value: "/Library/LaunchAgents/b.plist" } },
    ];
    expect(renderCommands(fix, evidence).map((c) => c.text)).toEqual([
      "launchctl bootout gui/$UID /Users/a/Library/LaunchAgents/a.plist",
      "launchctl bootout gui/$UID /Library/LaunchAgents/b.plist",
      "sudo launchctl bootout system /Library/LaunchDaemons/d.plist",
    ]);
  });
});
