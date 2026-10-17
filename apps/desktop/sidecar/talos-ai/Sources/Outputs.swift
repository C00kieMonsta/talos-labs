// The three static output shapes, chosen by task. Field names match core's validators.

import FoundationModels

@Generable
struct ExplanationOut {
  var ruleId: String
  @Guide(description: "Why this matters for this reader. Plain words. No commands.")
  var whyItMattersForYou: String
  var whatCouldHappen: String
  @Guide(.anyOf(["today", "this_week", "when_convenient"]))
  var urgency: String
}

@Generable
struct ReasonOut {
  var ruleId: String
  var reason: String
}

@Generable
struct PrioritisationOut {
  @Guide(.maximumCount(12))
  var order: [String]
  @Guide(.maximumCount(10))
  var reasons: [ReasonOut]
  @Guide(.maximumCount(3))
  var startWith: [String]
}

@Generable
struct AnswerOut {
  var answer: String
  @Guide(.maximumCount(10))
  var relatedRuleIds: [String]
  var outsideScope: Bool
}

@Generable
struct ProbeOut {
  var probeId: String
  var reason: String
}

@Generable
struct ActionOut {
  var actionId: String
  var sentence: String
}

// The watch verdict: a rating, the ids it rests on, and ids to re-read or suggest. No partials.
@Generable
struct WatchVerdictOut {
  @Guide(.anyOf(["calm", "keep_an_eye", "act_now"]))
  var rating: String
  @Guide(description: "One short sentence, no commands, no paths, no ports.")
  var ratingReason: String
  @Guide(.maximumCount(6))
  var basedOn: [String]
  @Guide(.maximumCount(3))
  var probes: [ProbeOut]
  @Guide(.maximumCount(3))
  var actions: [ActionOut]
}
