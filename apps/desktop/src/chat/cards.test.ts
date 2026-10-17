import { describe, expect, it } from "vitest";
import { ACTIVITY, BATCH, CHAT, FISHY, FIX, PAYWALL, PERMISSION, QUESTION, SHOW, WATCH } from "../guided/copy";
import { cardContent, cardFor, cardHeadline, lockCard, seedForStep, severityOf, watchCard, writeUpCard } from "./cards";
import { ACT_ITEM, allowedFor, planFor, stepById } from "./testing";

const PLAN = planFor(true);
const ALLOWED = allowedFor(PLAN, true);
const FACTS = { needsPassword: true, noticedTime: "14:32" };

describe("cards", () => {
  it("seedForStep maps every step kind and carries the highest severity", () => {
    expect(seedForStep(stepById(PLAN, "batch")).card).toMatchObject({ kind: "batch", ruleId: null });
    expect(seedForStep(stepById(PLAN, "show:TL-MAC-001")).card).toMatchObject({ kind: "show", ruleId: "TL-MAC-001", severity: "critical" });
    expect(seedForStep(stepById(PLAN, "permission:full_disk_access")).card.kind).toBe("permission");
    expect(seedForStep(stepById(planFor(false), "paywall")).card.kind).toBe("lock");
    expect(severityOf(["TL-MAC-011", "TL-MAC-002"])).toBe("high");
    expect(severityOf([])).toBeNull();
  });

  it("cardFor re-checks the live allow-lists: an item that left allowed draws nothing, and show_list draws rows only", () => {
    expect(cardFor({ kind: "fix_batch", ruleId: null }, PLAN, ALLOWED)?.card.kind).toBe("batch");
    expect(cardFor({ kind: "show_where", ruleId: "TL-MAC-001" }, PLAN, ALLOWED)?.step?.id).toBe("show:TL-MAC-001");
    expect(cardFor({ kind: "show_where", ruleId: "TL-MAC-001" }, PLAN, { ...ALLOWED, show: [] })).toBeNull();
    expect(cardFor({ kind: "fix_batch", ruleId: null }, PLAN, { ...ALLOWED, batch: [] })).toBeNull();
    expect(cardFor({ kind: "show_list", ruleId: null }, PLAN, ALLOWED)).toBeNull();
    expect(cardFor({ kind: "explain_rule", ruleId: "TL-MAC-026" }, PLAN, ALLOWED)?.card).toMatchObject({ kind: "explain", ruleId: "TL-MAC-026", severity: "medium" });
    expect(cardFor({ kind: "open_watch", ruleId: null }, PLAN, ALLOWED)?.card.kind).toBe("watch");
  });

  it("the chooser cards: one 022 card per shared folder with its name, the 029 passphrase form, the 026 question", () => {
    const share = cardContent(seedForStep(stepById(PLAN, "fix:TL-MAC-022:/Users/alice/Public")), FACTS);
    expect(share.folder).toBe("Public");
    expect(share.primary).toBe("Stop sharing it");
    expect(share.link).toBe(FIX.later);
    expect(share.meta).toBe(FIX.password);
    const key = cardContent({ card: { kind: "fix", ruleId: "TL-MAC-029", ruleIds: ["TL-MAC-029"], severity: "high" }, step: { id: "fix:TL-MAC-029:/k", kind: "fix", ruleId: "TL-MAC-029", choice: { kind: "ssh_key", path: "/Users/alice/.ssh/id_ed25519" }, passphrase: true }, item: null }, FACTS);
    expect(key.passphrase).toBe(true);
    expect(key.primary).toBeNull();
    expect(key.keyPath).toBe("/Users/alice/.ssh/id_ed25519");
    const backup = cardContent(seedForStep(stepById(PLAN, "show:TL-MAC-026")), FACTS);
    expect(backup.primary).toBe(QUESTION.yes);
    expect(backup.link).toBe(QUESTION.no);
    expect(backup.body).toContain(QUESTION.ask);
  });

  it("batch, show, permission, lock and watch cards carry the guided strings and one primary each", () => {
    const batch = cardContent(seedForStep(stepById(PLAN, "batch")), FACTS);
    expect(batch.headline).toMatch(/^I can fix \d things for you now\.$/);
    expect(batch.body).toBe(BATCH.password);
    expect(batch.primary).toBe(BATCH.button);
    expect(batch.list.length).toBeGreaterThan(1);
    const show = cardContent(seedForStep(stepById(PLAN, "show:TL-MAC-001")), FACTS);
    expect(show.primary).toBe(SHOW.button);
    expect(show.body).toContain(SHOW.lead);
    expect(show.explainRuleId).toBe("TL-MAC-001");
    const permission = cardContent(seedForStep(stepById(PLAN, "permission:full_disk_access")), FACTS);
    expect(permission.headline).toBe(PERMISSION.title);
    expect(permission.primary).toBe(PERMISSION.button);
    const lock = cardContent(lockCard(["TL-MAC-003", "TL-MAC-011", "TL-MAC-022"]), FACTS);
    expect(lock.headline).toBe("There are 3 more things I could fix.");
    expect(lock.primary).toBe(PAYWALL.buy);
    expect(lock.licence).toBe(true);
    expect(cardHeadline(lockCard(["TL-MAC-003"]))).toBe(CHAT.lockHeadlineOne);
    const watch = cardContent(watchCard(ACT_ITEM), FACTS);
    expect(watch.headline).toBe("Act now: a new program started running on its own");
    expect(watch.body).toBe(FISHY.noticed.body.replace("{time}", "14:32"));
    expect(watch.meta).toBe(WATCH.sourceAct);
    expect(watch.primary).toBe(FISHY.noticed.primary);
    expect(watch.link).toBe(FISHY.noticed.link);
    expect(cardContent(watchCard(ACT_ITEM), { ...FACTS, noticedTime: null }).body).toBe(CHAT.noticedNoTime);
    expect(cardContent(watchCard(null), FACTS).primary).toBe(WATCH.checkNow);
  });
});

/* AGENT part B region: the five kinds (docs/DESIGN-AGENT.md 2f, 2g, 2h). */
describe("cards: the agent intents", () => {
  it("remind_rule, close_watch and investigate draw no card; what_if draws the rule's step or a Details card; write_up its own card", () => {
    const agent = { ...ALLOWED, kinds: [...ALLOWED.kinds, "investigate" as const, "close_watch" as const], investigate: ["sig.persistence_new" as const] };
    expect(cardFor({ kind: "remind_rule", ruleId: "TL-MAC-001", signalId: null, when: "tomorrow" }, PLAN, agent)).toBeNull();
    expect(cardFor({ kind: "close_watch", ruleId: null, signalId: null, when: null }, PLAN, agent)).toBeNull();
    expect(cardFor({ kind: "investigate", ruleId: null, signalId: "sig.persistence_new", when: null }, PLAN, agent)).toBeNull();
    expect(cardFor({ kind: "what_if", ruleId: "TL-MAC-001", signalId: null, when: null }, PLAN, ALLOWED)?.step?.id).toBe("show:TL-MAC-001");
    expect(cardFor({ kind: "what_if", ruleId: "TL-MAC-002", signalId: null, when: null }, PLAN, ALLOWED)?.card.kind).toBe("batch");
    expect(cardFor({ kind: "what_if", ruleId: "TL-MAC-005", signalId: null, when: null }, PLAN, { ...ALLOWED, whatIf: [...ALLOWED.whatIf, "TL-MAC-005"] })?.card).toMatchObject({ kind: "details", ruleId: "TL-MAC-005" });
    expect(cardFor({ kind: "what_if", ruleId: "TL-MAC-001", signalId: null, when: null }, PLAN, { ...ALLOWED, whatIf: [] })).toBeNull();
    const writeUp = cardFor({ kind: "write_up", ruleId: null, signalId: null, when: null }, PLAN, ALLOWED);
    expect(writeUp).toEqual({ card: { kind: "write_up", ruleId: null, ruleIds: [], severity: null }, step: null, item: null });
  });

  it("the write-up card: the chip's headline, the lead, the Copy it primary, no link and no Explain", () => {
    const content = cardContent({ ...writeUpCard("Talos Labs check-up, 17 October"), text: "Talos Labs check-up, 17 October" }, FACTS);
    expect(content.headline).toBe(ACTIVITY.chips.writeUp);
    expect(content.body).toBe(ACTIVITY.writeUp.lead);
    expect(content.primary).toBe(ACTIVITY.writeUp.copy);
    expect(content.link).toBeNull();
    expect(content.explainRuleId).toBeNull();
    expect(cardHeadline(writeUpCard())).toBe(ACTIVITY.chips.writeUp);
  });
});
