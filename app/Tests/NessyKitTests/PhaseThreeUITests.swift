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

private func pb(version: Int = 3, _ edit: (inout PlaybookView) -> Void = { _ in }) throws -> PlaybookView {
	var p: PlaybookView = try decode(playbookJSON())
	p.version = version
	edit(&p)
	return p
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

@Suite("Кэш отчётов журнала")
@MainActor
struct JournalCacheTests {
	private func entry(_ id: String, report: String?) throws -> JournalEntry {
		let r = report.map { #","report":"\#($0.replacingOccurrences(of: "\"", with: "\\\""))""# } ?? ""
		return try decode(#"{"id":"\#(id)","ts":"2026-10-20T10:00:00.000Z","kind":"published","subject":"p-1","summary":"s","revertible":false\#(r)}"#)
	}

	@Test("отчёт разбирается один раз на запись, в том числе пустой")
	func once() throws {
		let c = JournalReportCache()
		let a = try entry("j-1", report: #"{"prevStatus":"draft"}"#), b = try entry("j-2", report: nil)
		for _ in 0..<5 { #expect(c.report(a)?.prevStatus == "draft"); #expect(c.report(b) == nil) }
		#expect(c.parses == 2)
	}

	@Test("статус до изменения — по-русски")
	func prevStatus() {
		#expect(LearningText.prevStatus("draft") == "черновик")
		#expect(LearningText.prevStatus("candidate") == "кандидат")
		#expect(LearningText.prevStatus("active") == "активен")
		#expect(LearningText.prevStatus("weird") == "weird")
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

	@Test("удаление кейса: ошибка проверки не блокирует, но говорит об этом")
	func deleteText() {
		let m = CaseDeleteText.message(impact: nil, failed: true)
		#expect(m.contains("Не удалось проверить, какие правила потеряют доказательства"))
		#expect(!CaseDeleteText.message(impact: nil, failed: false).contains("Не удалось"))
	}

	@Test("подтверждение ухода: только при несохранённом и смене объекта")
	func leave() {
		#expect(LeaveGuard.needsConfirm(from: "c-1", to: "c-2", unsaved: true))
		#expect(!LeaveGuard.needsConfirm(from: "c-1", to: "c-1", unsaved: true))
		#expect(!LeaveGuard.needsConfirm(from: "c-1", to: "c-2", unsaved: false))
		#expect(!LeaveGuard.needsConfirm(from: nil, to: "c-2", unsaved: true))
	}

	@MainActor
	@Test("черновики кейса: что считается несохранённым и что копируется")
	func caseDrafts() {
		let d = CaseDraftState()
		#expect(!d.hasDrafts)
		d.notes = ["одна", "две"]
		#expect(d.hasDrafts && !d.editingSummary)
		d.text = "# Текст"
		#expect(d.editingSummary)
		#expect(d.copyText().hasPrefix("# Текст"))
		#expect(d.copyText().contains("одна"))
		d.clear()
		#expect(!d.hasDrafts)
	}

	@Test("текст черновика плейбука для копирования")
	func playbookText() throws {
		var d = PlaybookDraft(try pb())
		d.title = "Мой плейбук"
		d.addRule(text: "новое правило")
		let t = d.plainText()
		#expect(t.hasPrefix("# Мой плейбук"))
		#expect(t.contains("новое правило"))
	}
}

@Suite("Сохранение плейбука")
struct PlaybookSavingTests {
	private func edited(_ p: PlaybookView) -> PlaybookDraft { var d = PlaybookDraft(p); d.title = "Моё название"; return d }
	private let stale = APIError(status: 409, code: "stale", message: "stale", version: 4)
	private let busy = APIError(status: 409, code: "playbook_busy", message: "busy")

	@Test("успех и «менять нечего»")
	func saved() async throws {
		let p = try pb()
		let sent = Box(0)
		var r = await PlaybookSaving.save(edited(p), send: { _ in sent.mutate { $0 += 1 } }, fetch: { p })
		guard case .saved = r else { Issue.record("ждали saved"); return }
		#expect(sent.value == 1)
		r = await PlaybookSaving.save(PlaybookDraft(p), send: { _ in sent.mutate { $0 += 1 } }, fetch: { p })
		guard case .unchanged = r else { Issue.record("ждали unchanged"); return }
		#expect(sent.value == 1)
	}

	@Test("409 stale: правки переносятся на свежую версию, чужое поле не конфликтует")
	func staleRebase() async throws {
		let p = try pb(version: 3)
		let fresh = try pb(version: 4) { $0.description = "чужое описание" }
		let r = await PlaybookSaving.save(edited(p), send: { _ in throw stale }, fetch: { fresh })
		guard case .rebased(let rb) = r else { Issue.record("ждали rebased"); return }
		#expect(rb.fields.isEmpty && rb.ruleNotes.isEmpty)
		#expect(rb.draft.base.version == 4)
		#expect(rb.draft.title == "Моё название")
		#expect(rb.draft.description == "чужое описание")
		#expect(rb.draft.patch()?.baseVersion == 4)
		#expect(rb.draft.patch()?.description == nil)
	}

	@Test("409 stale: поле изменено и вами, и на сервере — конфликт, «взять новые» работает")
	func staleConflict() async throws {
		let p = try pb(version: 3)
		let fresh = try pb(version: 4) { $0.title = "Серверное название" }
		let r = await PlaybookSaving.save(edited(p), send: { _ in throw stale }, fetch: { fresh })
		guard case .rebased(var rb) = r else { Issue.record("ждали rebased"); return }
		#expect(rb.fields == [.title])
		#expect(rb.draft.title == "Моё название")
		rb.draft.take(.title, from: rb.fresh)
		#expect(rb.draft.title == "Серверное название")
		#expect(rb.draft.patch() == nil)
	}

	@Test("занято: повторы, затем busy; между повторами лишние ожидания не копятся")
	func busyRetries() async throws {
		let p = try pb()
		let sent = Box(0), waits = Box(0)
		let r = await PlaybookSaving.save(edited(p), send: { _ in sent.mutate { $0 += 1 }; throw busy }, fetch: { p },
			onWait: { _ in waits.mutate { $0 += 1 } }, attempts: 3, delay: .milliseconds(1))
		guard case .busy = r else { Issue.record("ждали busy"); return }
		#expect(sent.value == 3 && waits.value == 2)
	}

	@Test("занято, затем свободно — сохранено")
	func busyThenOk() async throws {
		let p = try pb()
		let sent = Box(0)
		let r = await PlaybookSaving.save(edited(p), send: { _ in sent.mutate { $0 += 1 }; if sent.value < 2 { throw busy } }, fetch: { p },
			attempts: 4, delay: .milliseconds(1))
		guard case .saved = r else { Issue.record("ждали saved"); return }
		#expect(sent.value == 2)
	}

	@Test("занято, пока ждали, версия сменилась — перенос на свежую, а не повтор поверх неё")
	func busyThenVersionChanged() async throws {
		let p = try pb(version: 3)
		let fresh = try pb(version: 4) { $0.behavior = ["чужое"] }
		let sent = Box(0)
		let r = await PlaybookSaving.save(edited(p), send: { _ in sent.mutate { $0 += 1 }; throw busy }, fetch: { fresh },
			attempts: 4, delay: .milliseconds(1))
		guard case .rebased(let rb) = r else { Issue.record("ждали rebased"); return }
		#expect(sent.value == 1)
		#expect(rb.draft.base.version == 4)
		#expect(rb.draft.behavior == ["чужое"])
	}

	@Test("lint и прочие ошибки")
	func lintAndOther() async throws {
		let p = try pb()
		let lint = APIError(status: 400, code: "lint", message: "- плохо\n- совсем")
		var r = await PlaybookSaving.save(edited(p), send: { _ in throw lint }, fetch: { p })
		guard case .lint(let l) = r else { Issue.record("ждали lint"); return }
		#expect(!l.isEmpty)
		r = await PlaybookSaving.save(edited(p), send: { _ in throw APIError(status: 500, code: "boom", message: "бум") }, fetch: { p })
		guard case .failed = r else { Issue.record("ждали failed"); return }
	}
}
