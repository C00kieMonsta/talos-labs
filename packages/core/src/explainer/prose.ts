import { PATH_LIKE } from "../watch/validate";
import { containsCommandText } from "./validate";

/** The first-person forms, case-sensitive so "i" inside a word or a lower-case quote never trips it. */
const I_FORMS = /\b(I|I'm|I'll|I've|I'd)\b/;
/** The rest of the app's voice, any case. */
const APP_VOICE = /\b(me|my|we|we're|we'll|we've|our|the app|Talos)\b/i;

/** True when the text speaks as the app: I, me, my, we, our, "the app" or "Talos". */
export function containsAppVoice(text: string): boolean {
  return I_FORMS.test(text) || APP_VOICE.test(text);
}

const ACTION_CLAIM =
  /\b(I|we)('ve| have| just|'ll| will)? ?(fixed|turned|switched|changed|enabled|disabled|removed|deleted|installed|updated|ran|applied|locked|encrypted|opened|started|stopped)\b/i;
const DONE_CLAIM = /^\s*Done\b/m;

/** True when the text says the model did, will do or has changed something. */
export function claimsAction(text: string): boolean {
  return ACTION_CLAIM.test(text) || DONE_CLAIM.test(text);
}

/** The chat's prose rule, run on every partial and the final value. */
export function replyRejected(text: string): boolean {
  return containsCommandText(text) || containsAppVoice(text) || claimsAction(text);
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
