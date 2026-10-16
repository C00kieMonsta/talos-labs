// Entry point: reads JSON-lines requests from stdin, runs one Task per generate request.

import Foundation
import FoundationModels

@main
struct TalosAI {
  static func main() async {
    let runner = Runner()
    while let line = readLine(strippingNewline: true) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.isEmpty { continue }
      guard let request = try? JSONDecoder().decode(Request.self, from: Data(trimmed.utf8)) else {
        Output.shared.write(.error("", .badRequest))
        continue
      }
      switch request.op {
      case .shutdown:
        exit(0)
      case .availability:
        await runner.availability(request.id ?? "")
      case .generate:
        await runner.generate(request)
      case .cancel:
        await runner.cancel(request.id ?? "")
      }
    }
    exit(0)
  }
}

actor Runner {
  private var tasks: [String: Task<Void, Never>] = [:]
  private var prewarmed = false

  func availability(_ id: String) {
    let state: AvailabilityState
    switch SystemLanguageModel.default.availability {
    case .available:
      state = .available
      if !prewarmed {
        prewarmed = true
        LanguageModelSession().prewarm()
      }
    case .unavailable(let reason):
      switch reason {
      case .deviceNotEligible: state = .deviceNotEligible
      case .appleIntelligenceNotEnabled: state = .appleIntelligenceNotEnabled
      case .modelNotReady: state = .modelNotReady
      @unknown default: state = .modelNotReady
      }
    }
    Output.shared.write(.availability(id, state))
  }

  func generate(_ request: Request) {
    guard let id = request.id, let task = request.task,
      let instructions = request.instructions, let prompt = request.prompt
    else {
      Output.shared.write(.error(request.id ?? "", .badRequest))
      return
    }
    if tasks[id] != nil {
      Output.shared.write(.error(id, .busy))
      return
    }
    let maxTokens = request.maxTokens ?? 600
    tasks[id] = Task.detached { [self] in
      let outcome = await Generator.run(id: id, task: task, instructions: instructions, prompt: prompt, maxTokens: maxTokens, runner: self)
      await self.finish(id, outcome)
    }
  }

  // Acknowledges straight away; later output for this id is dropped.
  func cancel(_ id: String) {
    guard let task = tasks.removeValue(forKey: id) else { return }
    task.cancel()
    Output.shared.write(.error(id, .cancelled))
  }

  func emit(_ id: String, _ event: Event) {
    if tasks[id] != nil { Output.shared.write(event) }
  }

  private func finish(_ id: String, _ outcome: Event) {
    guard tasks.removeValue(forKey: id) != nil else { return }
    Output.shared.write(outcome)
  }
}

enum Generator {
  static func run(id: String, task: AiTask, instructions: String, prompt: String, maxTokens: Int, runner: Runner) async -> Event {
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: maxTokens)
    do {
      let json: String
      switch task {
      case .explain:
        json = try await stream(id, session, prompt, options, ExplanationOut.self, partials: true, runner)
      case .prioritise:
        json = try await stream(id, session, prompt, options, PrioritisationOut.self, partials: false, runner)
      case .ask:
        json = try await stream(id, session, prompt, options, AnswerOut.self, partials: true, runner)
      }
      return .done(id, json)
    } catch is CancellationError {
      return .error(id, .cancelled)
    } catch let error as LanguageModelSession.GenerationError {
      return .error(id, map(error))
    } catch {
      FileHandle.standardError.write(Data("talos-ai: \(error)\n".utf8))
      return .error(id, .internal)
    }
  }

  private static func stream<T: Generable>(
    _ id: String, _ session: LanguageModelSession, _ prompt: String, _ options: GenerationOptions,
    _ type: T.Type, partials: Bool, _ runner: Runner
  ) async throws -> String {
    var last: GeneratedContent?
    for try await snapshot in session.streamResponse(to: prompt, generating: T.self, options: options) {
      try Task.checkCancellation()
      last = snapshot.rawContent
      if partials { await runner.emit(id, .partial(id, snapshot.rawContent.jsonString)) }
    }
    try Task.checkCancellation()
    guard let last else { throw LanguageModelSession.GenerationError.decodingFailure(.init(debugDescription: "empty stream")) }
    _ = try T(last)
    return last.jsonString
  }

  static func map(_ error: LanguageModelSession.GenerationError) -> ErrorCode {
    switch error {
    case .exceededContextWindowSize: return .contextWindow
    case .guardrailViolation: return .guardrail
    case .refusal: return .refusal
    case .unsupportedLanguageOrLocale: return .unsupportedLanguage
    case .assetsUnavailable: return .assetsUnavailable
    case .rateLimited: return .rateLimited
    case .concurrentRequests: return .busy
    case .decodingFailure: return .decoding
    case .unsupportedGuide: return .internal
    @unknown default: return .internal
    }
  }
}
