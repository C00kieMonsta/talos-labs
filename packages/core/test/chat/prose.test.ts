import { describe, expect, it } from "vitest";
import { claimsAction, containsAppVoice, containsMachineText, replyRejected } from "../../src/explainer/prose";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

describe("containsAppVoice", () => {
  it("catches the first person and the app's name", () => {
    for (const text of ["I can fix that", "I'm here", "I'll open it", "I've seen it", "I'd say", "Let me look", "my view", "We can", "we're on it", "we'll see", "we've done", "our app", "the app will do it", "Talos found it", "talos is here"]) {
      expect(containsAppVoice(text), text).toBe(true);
    }
  });

  it("leaves the second person and words that only contain the forms alone", () => {
    expect(containsAppVoice("You can turn it on from the button below")).toBe(false);
    expect(containsAppVoice("Your disk is not locked")).toBe(false);
    expect(containsAppVoice("it is time, and item two")).toBe(false);
    expect(containsAppVoice("Your mystery and ours")).toBe(false);
  });
});

describe("claimsAction", () => {
  it("catches a claim of having changed something", () => {
    for (const text of ["I've turned on your firewall", "Done. Your disk is locked.", "We changed that for you", "I locked it", "we have removed it", "I just fixed it", "we'll encrypted it", " Done", "first line\nDone, it is on."]) {
      expect(claimsAction(text), text).toBe(true);
    }
  });

  it("leaves a description of the button alone", () => {
    expect(claimsAction("You can turn it on from the button below")).toBe(false);
    expect(claimsAction("The firewall is turned off")).toBe(false);
    expect(claimsAction("When it is done, the tick appears")).toBe(false);
  });
});

describe("replyRejected", () => {
  it("is the union of the command, voice and claim checks", () => {
    expect(replyRejected("```\nls\n```")).toBe(true);
    expect(replyRejected("The app will fix it")).toBe(true);
    expect(replyRejected("Done. Your disk is locked.")).toBe(true);
    expect(replyRejected("Your disk is not locked. Turn it on from the button below.")).toBe(false);
  });

  it("never mistakes the catalogue's own guided text for the model's voice", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(containsAppVoice(rule.guided.why), `${rule.id} why`).toBe(false);
      expect(containsAppVoice(rule.guided.headline), `${rule.id} headline`).toBe(false);
    }
  });
});

describe("containsMachineText", () => {
  it("passes the plain sentences of DESIGN-AI-PRESENCE section 7", () => {
    for (const text of ["It comes back at 18:00.", "and/or", "24/7", "Remove the device you don't know.", "Delete the leftover item.", "Your Mac goes out with you.", "Score 72 out of 100, Fair.", "Talos Labs check-up, 17 October 2026"]) {
      expect(containsMachineText(text), text).toBe(false);
    }
  });

  it("rejects paths, ports, rule ids, fake citations, authorities, machine words and command text", () => {
    for (const text of ["~/Library/LaunchAgents", "/usr/bin/x", '"/Users/alice"', "(/tmp/x)", "folder:/Library/LaunchAgents", "port :8080", "TL-MAC-001", "see step 3", "Section 2 says", "CISA says", "kill the pid", "a daemon runs", "launchctl is", "rm it", "unload it", "```\nls\n```", "then\nsudo rm -rf /", "$ ls"]) {
      expect(containsMachineText(text), text).toBe(true);
    }
  });

  it("the catalogue's prose fields all pass; the id and command fields are what it exists to catch", () => {
    for (const rule of MACOS_CATALOG.rules) {
      for (const [name, text] of [["title", rule.title], ["failTitle", rule.failTitle], ["explanation", rule.explanation], ["fix.summary", rule.fix.summary]] as const) {
        expect(containsMachineText(text), `${rule.id} ${name}`).toBe(false);
      }
      for (const [name, text] of Object.entries(rule.guided)) {
        if (typeof text === "string") expect(containsMachineText(text), `${rule.id} guided.${name}`).toBe(false);
      }
      expect(containsMachineText(rule.id), rule.id).toBe(true);
      for (const command of rule.fix.commands) {
        if (command.program.startsWith("/")) expect(containsMachineText([command.program, ...command.args].join(" ")), `${rule.id} command`).toBe(true);
      }
    }
  });
});
