import { describe, expect, it } from "vitest";
import { claimsAction, claimsAppIdentity, containsMachineText, replyRejected } from "../../src/explainer/prose";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

/** The register: the model may speak as itself; it is never the app and never claims to have acted. */
const PASSES: readonly string[] = [
  "Hi! I'm here to help with your Mac",
  "Hi, I'm happy to help",
  "Hello! I can help with the firewall.",
  "I can't change anything myself; the app shows the buttons and you decide.",
  "I'm open to questions",
  "Let me look at that for you",
  "My view is that the disk matters most",
  "We can go through it together",
  "You can turn it on from the button below",
  "Your disk is not locked",
  "The firewall is turned off",
  "When it is done, the tick appears",
  "As the app shows, your disk is not locked",
  "The app draws a button for that",
  "Talos Labs checked this on your Mac",
  "it is time, and item two",
  "Your mystery and ours",
];

const IDENTITY_CLAIMS: readonly string[] = ["I'm Talos Labs", "I am Talos", "I’m Talos", "as Talos I can", "I, Talos, can see", "This is Talos Labs", "I'm the app", "I am the app you opened", "the app and I agree", "my app found it", "our app shows it"];

const ACTION_CLAIMS: readonly string[] = [
  "I've turned the firewall on",
  "Done, the firewall is on",
  "I fixed it",
  "I'm fixing it now",
  "I'm turning it on",
  "I will fix that",
  "I'll open the settings",
  "I will check that for you",
  "We changed that for you",
  "I locked it",
  "we have removed it",
  "I just fixed it",
  "we are running a scan",
  "we'll encrypt it",
  " Done",
  "first line\nDone, it is on.",
];

describe("claimsAppIdentity", () => {
  it("catches the model naming itself as Talos or the app", () => {
    for (const text of IDENTITY_CLAIMS) expect(claimsAppIdentity(text), text).toBe(true);
  });

  it("passes a conversational first person, the second person and the app named in the third person", () => {
    for (const text of [...PASSES, ...ACTION_CLAIMS]) expect(claimsAppIdentity(text), text).toBe(false);
  });
});

describe("claimsAction", () => {
  it("catches a claim of having changed, changing or being about to change something", () => {
    for (const text of ACTION_CLAIMS) expect(claimsAction(text), text).toBe(true);
  });

  it("passes a greeting, an offer of help and a description of the button", () => {
    for (const text of [...PASSES, ...IDENTITY_CLAIMS]) expect(claimsAction(text), text).toBe(false);
  });
});

describe("replyRejected", () => {
  it("is the union of the command, identity and action checks", () => {
    expect(replyRejected("```\nls\n```")).toBe(true);
    expect(replyRejected("I'm Talos Labs")).toBe(true);
    expect(replyRejected("Done. Your disk is locked.")).toBe(true);
    expect(replyRejected("Done. I have turned your firewall on for you.")).toBe(true);
    expect(replyRejected("Your disk is not locked. Turn it on from the button below.")).toBe(false);
    for (const text of PASSES) expect(replyRejected(text), text).toBe(false);
  });

  it("never mistakes the catalogue's own guided text for a claim", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(replyRejected(rule.guided.why), `${rule.id} why`).toBe(false);
      expect(replyRejected(rule.guided.headline), `${rule.id} headline`).toBe(false);
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
