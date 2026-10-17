// JSON-lines protocol between Rust and the helper. One object per line, nothing else on stdout.

import Foundation

enum Op: String, Codable {
  case availability
  case generate
  case cancel
  case shutdown
}

enum AiTask: String, Codable {
  case explain
  case prioritise
  case ask
  case watch
}

struct Request: Decodable {
  var id: String?
  var op: Op
  var task: AiTask?
  var instructions: String?
  var prompt: String?
  var maxTokens: Int?
}

enum AvailabilityState: String, Encodable {
  case available
  case deviceNotEligible = "device_not_eligible"
  case appleIntelligenceNotEnabled = "apple_intelligence_not_enabled"
  case modelNotReady = "model_not_ready"
}

enum ErrorCode: String, Encodable {
  case contextWindow = "context_window"
  case guardrail
  case refusal
  case unsupportedLanguage = "unsupported_language"
  case assetsUnavailable = "assets_unavailable"
  case rateLimited = "rate_limited"
  case busy
  case decoding
  case cancelled
  case `internal`
  case badRequest = "bad_request"
}

// Raw JSON text that is written into the event unquoted.
struct RawJSON: Encodable {
  var text: String
}

struct Event: Encodable {
  var id: String
  var event: String
  var state: AvailabilityState?
  var json: RawJSON?
  var code: ErrorCode?

  static func availability(_ id: String, _ state: AvailabilityState) -> Event {
    Event(id: id, event: "availability", state: state)
  }
  static func partial(_ id: String, _ json: String) -> Event {
    Event(id: id, event: "partial", json: RawJSON(text: json))
  }
  static func done(_ id: String, _ json: String) -> Event {
    Event(id: id, event: "done", json: RawJSON(text: json))
  }
  static func error(_ id: String, _ code: ErrorCode) -> Event {
    Event(id: id, event: "error", code: code)
  }

  // Hand-built so the json field is embedded as an object rather than a string.
  func line() -> String {
    var parts = ["\"id\":\(Event.quote(id))", "\"event\":\"\(event)\""]
    if let state { parts.append("\"state\":\"\(state.rawValue)\"") }
    if let json { parts.append("\"json\":\(json.text)") }
    if let code { parts.append("\"code\":\"\(code.rawValue)\"") }
    return "{" + parts.joined(separator: ",") + "}"
  }

  static func quote(_ text: String) -> String {
    let data = (try? JSONEncoder().encode([text])) ?? Data("[\"\"]".utf8)
    let array = String(decoding: data, as: UTF8.self)
    return String(array.dropFirst().dropLast())
  }
}

final class Output: @unchecked Sendable {
  static let shared = Output()
  private let lock = NSLock()
  private let handle = FileHandle.standardOutput

  func write(_ event: Event) {
    lock.lock()
    defer { lock.unlock() }
    handle.write(Data((event.line() + "\n").utf8))
  }
}
