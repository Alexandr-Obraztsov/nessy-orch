import Foundation
import Testing
@testable import NessyKit

// Исправления этапа 3 по ревью: группа U (логика без UI).

private final class Box<T: Sendable>: @unchecked Sendable {
	private let lock = NSLock()
	private var v: T
	init(_ v: T) { self.v = v }
	var value: T { get { lock.lock(); defer { lock.unlock() }; return v } set { lock.lock(); v = newValue; lock.unlock() } }
	func mutate(_ f: (inout T) -> Void) { lock.lock(); f(&v); lock.unlock() }
}

@Suite("Токен запроса")
struct RequestTokenTests {
	@Test("устаревший ответ не применяется")
	func stale() {
		var t = RequestToken()
		let a = t.next(), b = t.next()
		#expect(!t.isCurrent(a))
		#expect(t.isCurrent(b))
	}
}

@Suite("Очередь PATCH настроек")
@MainActor
struct SettingsQueueTests {
	@Test("быстрые правки сливаются в один запрос, побеждает последнее значение")
	func debounced() async throws {
		let q = SettingsPatchQueue(debounce: .milliseconds(40))
		let sent = Box<[[String: JSONValue]]>([])
		q.send = { c in sent.mutate { $0.append(c) } }
		q.set(["intervalMin": .number(1)])
		q.set(["intervalMin": .number(2), "idleMin": .number(30)])
		q.set(["intervalMin": .number(3)])
		#expect(q.isBusy)
		try await Task.sleep(for: .milliseconds(200))
		#expect(sent.value.count == 1)
		#expect(sent.value.first?["intervalMin"] == .number(3))
		#expect(sent.value.first?["idleMin"] == .number(30))
		#expect(!q.isBusy)
	}

	@Test("запросы идут по одному: правка во время отправки уходит после неё")
	func sequential() async throws {
		let q = SettingsPatchQueue(debounce: .milliseconds(10))
		let log = Box<[String]>([])
		q.send = { c in
			log.mutate { $0.append("start \(c.keys.sorted().joined())") }
			try await Task.sleep(for: .milliseconds(80))
			log.mutate { $0.append("end \(c.keys.sorted().joined())") }
		}
		q.set(["a": .number(1)])
		try await Task.sleep(for: .milliseconds(40))
		q.set(["b": .number(2)])
		try await Task.sleep(for: .milliseconds(300))
		#expect(log.value == ["start a", "end a", "start b", "end b"])
	}

	@Test("flush отправляет сразу; ошибка не рвёт очередь")
	func flushAndError() async throws {
		let q = SettingsPatchQueue(debounce: .seconds(10))
		let sent = Box(0), errors = Box(0)
		q.send = { _ in sent.mutate { $0 += 1 }; if sent.value == 1 { throw APIError(status: 500, code: "x", message: "x") } }
		q.onError = { _ in errors.mutate { $0 += 1 } }
		q.set(["a": .number(1)])
		await q.flush()
		q.set(["a": .number(2)])
		await q.flush()
		#expect(sent.value == 2)
		#expect(errors.value == 1)
	}
}

@Suite("Мелочи")
struct SmallUITests {
	@Test("предел 500 событий")
	func rawLimit() {
		#expect(LearningText.rawLimitNote(count: 499) == nil)
		#expect(LearningText.rawLimitNote(count: 500) == "Показаны первые 500 событий")
	}

	@Test("длинный текст: счёт ограничен, огромный не считается целиком")
	func longText() {
		#expect(!LongTextMeasure.isLong("коротко", preview: 600, lines: 6))
		#expect(LongTextMeasure.isLong(String(repeating: "я", count: 700), preview: 600, lines: 6))
		#expect(LongTextMeasure.isLong("a\nb\nc\nd", preview: 600, lines: 3))
		#expect(LongTextMeasure.isLong(String(repeating: "x", count: 5_000_000), preview: 600, lines: 6))
	}

}
