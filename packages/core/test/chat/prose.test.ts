import { describe, expect, it } from "vitest";
import { claimsAction, containsAppVoice, replyRejected } from "../../src/explainer/prose";
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
