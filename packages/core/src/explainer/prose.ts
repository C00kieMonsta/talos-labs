import { PATH_LIKE } from "../watch/validate";
import { containsCommandText } from "./validate";

/** "I'm Talos", "I am Talos Labs", "as Talos", "I, Talos": the model naming itself as the product. */
const IDENTITY_TALOS = /\b(I['’]m|I am|this is|as|I,)\s+Talos( Labs)?\b/i;
/** "I'm the app", "I am the app": the model naming itself as the app. */
const IDENTITY_APP = /\b(I['’]m|I am)\s+the app\b/i;
const APP_AND_I = /\bthe app and I\b/i;
const OUR_APP = /\b(my|our) app\b/i;

/** True when the text claims to be Talos Labs or the app; a conversational "I" passes. */
export function claimsAppIdentity(text: string): boolean {
  return IDENTITY_TALOS.test(text) || IDENTITY_APP.test(text) || APP_AND_I.test(text) || OUR_APP.test(text);
}

/** Past, present, future and progressive forms of the verbs the model may never claim for itself. */
const ACTION_CLAIM =
  /\b(I|we)(['’]ll| will|['’]ve| have| just|['’]m| am|['’]re| are| did)?\s?(fix(ed|ing)?|turn(ed|ing)?|switch(ed|ing)?|chang(ed|ing)|enabl(ed|ing)|disabl(ed|ing)|remov(ed|ing)|delet(ed|ing)|install(ed|ing)?|updat(ed|ing)|ran|run(ning)?|appl(ied|ying)|lock(ed|ing)?|encrypt(ed|ing)?|open(ed|ing)|start(ed|ing)?|stopp(ed|ing)|check(ed|ing))\b/i;
/** "I'll open" and "I will check": the bare stems only behind a future claim, so "I'm open to questions" passes. */
const FUTURE_CLAIM = /\b(I|we)(['’]ll| will)\s+(open|check)\b/i;
const DONE_CLAIM = /^\s*Done\b/m;

/** True when the text says the model did, is doing, will do or has changed something. */
export function claimsAction(text: string): boolean {
  return ACTION_CLAIM.test(text) || FUTURE_CLAIM.test(text) || DONE_CLAIM.test(text);
}

/** The chat's prose rule, run on every partial and the final value: commands, identity claims and action claims. */
export function replyRejected(text: string): boolean {
  return containsCommandText(text) || claimsAppIdentity(text) || claimsAction(text);
}

/** DESIGN-AI-PRESENCE section 6's form; watch/validate's PORT_LIKE also catches a dotted host and is not reused here. */
const PORT_LIKE_PROSE = /(?<![0-9]):[0-9]{2,5}\b/;
const RULE_ID_LIKE = /\bTL-[A-Z]{3}-/;
const FAKE_CITATION = /\b(step|section)\s*[0-9]/i;
const AUTHORITY = /\b(NIST|CISA|SANS|NCSC)\b/;
const MACHINE_WORDS = /\b(pid|kill|rm|unload|launchctl|daemon)\b/i;

/** True when the text carries a command, a path, a port, a rule id, a fake citation or a machine word; DESIGN-AI-PRESENCE section 6. */
export function containsMachineText(text: string): boolean {
  return (
    containsCommandText(text) ||
    PATH_LIKE.test(text) ||
    PORT_LIKE_PROSE.test(text) ||
    RULE_ID_LIKE.test(text) ||
    FAKE_CITATION.test(text) ||
    AUTHORITY.test(text) ||
    MACHINE_WORDS.test(text)
  );
}
