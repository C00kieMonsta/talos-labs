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
