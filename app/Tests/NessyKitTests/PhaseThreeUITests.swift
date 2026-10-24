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

/// Ручные ворота: `wait()` стоит, пока тест не вызовет `open()`; время не участвует.
private actor Gate {
	private var waiters: [CheckedContinuation<Void, Never>] = []
	private var opened = 0
	func wait() async {
		if opened > 0 { opened -= 1; return }
		await withCheckedContinuation { waiters.append($0) }
	}
	/// отпустить всех, кто уже ждёт (отменённые таймеры тоже стоят на воротах)
	func openAll() { let w = waiters; waiters = []; w.forEach { $0.resume() } }
	func open() { if waiters.isEmpty { opened += 1 } else { waiters.removeFirst().resume() } }
}

/// Дождаться условия, отдавая управление (без реального времени).
@MainActor private func until(_ cond: () -> Bool) async {
	for _ in 0..<100_000 where !cond() { await Task.yield() }
}

@Suite("Очередь PATCH настроек")
@MainActor
struct SettingsQueueTests {
	@Test("быстрые правки сливаются в один запрос, побеждает последнее значение; отправка — после паузы")
	func debounced() async throws {
		let q = SettingsPatchQueue(debounce: .milliseconds(400))
		let gate = Gate()
		q.sleep = { _ in await gate.wait() }
		let sent = Box<[[String: JSONValue]]>([])
		q.send = { c in sent.mutate { $0.append(c) } }
		q.set(["intervalMin": .number(1)])
		q.set(["intervalMin": .number(2), "idleMin": .number(30)])
		q.set(["intervalMin": .number(3)])
		#expect(q.isBusy)
		await Task.yield()
		#expect(sent.value.isEmpty, "пока пауза не вышла, ничего не ушло")
		await gate.openAll()
		await until { !q.isBusy }
		#expect(sent.value.count == 1)
		#expect(sent.value.first?["intervalMin"] == .number(3))
		#expect(sent.value.first?["idleMin"] == .number(30))
	}

	@Test("запросы идут по одному: правка во время отправки уходит после неё")
	func sequential() async throws {
		let q = SettingsPatchQueue(debounce: .zero)
		q.sleep = { _ in }
		let sendGate = Gate()
		let log = Box<[String]>([])
		q.send = { c in
			log.mutate { $0.append("start \(c.keys.sorted().joined())") }
			await sendGate.wait()
			log.mutate { $0.append("end \(c.keys.sorted().joined())") }
		}
		q.set(["a": .number(1)])
		await until { log.value == ["start a"] }
		q.set(["b": .number(2)])
		await Task.yield()
		#expect(log.value == ["start a"], "b ждёт окончания a")
		await sendGate.open()
		await until { log.value.count == 3 }
		await sendGate.open()
		await until { !q.isBusy }
		#expect(log.value == ["start a", "end a", "start b", "end b"])
	}

	@Test("flush отправляет сразу; ошибка не рвёт очередь")
	func flushAndError() async throws {
		let q = SettingsPatchQueue(debounce: .seconds(10))
		q.sleep = { _ in try await Task.sleep(for: .seconds(3600)) }
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
