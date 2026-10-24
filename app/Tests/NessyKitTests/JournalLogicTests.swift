import Foundation
import Testing
@testable import NessyKit

private func entry(_ id: String, _ ts: String, level: String? = nil, kind: String = "log", summary: String = "Текст") throws -> JournalEntry {
	let lv = level.map { #","level":"\#($0)""# } ?? ""
	return try decode(#"{"id":"\#(id)","ts":"\#(ts)","kind":"\#(kind)"\#(lv),"subject":"c-1","summary":"\#(summary)","revertible":false}"#)
}

@Suite("Журнал: лента логов")
struct JournalLogicTests {
	@Test("уровень: нет поля или неизвестный — info; kind log и неизвестный не ломают разбор")
	func decoding() throws {
		#expect(try entry("a", "2026-10-20T10:00:00Z").level == .info)
		#expect(try entry("a", "2026-10-20T10:00:00Z", level: "warn").level == .warn)
		#expect(try entry("a", "2026-10-20T10:00:00Z", level: "fatal").level == .info)
		#expect(try entry("a", "2026-10-20T10:00:00Z").kind == .log)
		#expect(try entry("a", "2026-10-20T10:00:00Z", kind: "новое").kind == .unknown)
	}

	@Test("группировка по дням: дни и записи от новых к старым")
	func grouping() throws {
		var cal = Calendar(identifier: .gregorian)
		cal.timeZone = TimeZone(identifier: "UTC")!
		let es = [try entry("1", "2026-10-20T08:00:00Z"), try entry("2", "2026-10-21T09:00:00Z"), try entry("3", "2026-10-20T20:00:00Z")]
		let days = JournalLogic.days(es, calendar: cal)
		#expect(days.count == 2)
		#expect(days[0].entries.map(\.id) == ["2"] && days[1].entries.map(\.id) == ["3", "1"])
	}

	@Test("фильтр уровня и поиск по тексту")
	func filtering() throws {
		let es = [
			try entry("1", "2026-10-20T08:00:00Z", summary: "Запуск чтения"),
			try entry("2", "2026-10-20T09:00:00Z", level: "warn", summary: "Повтор через минуту"),
			try entry("3", "2026-10-20T10:00:00Z", level: "error", summary: "Сбой чтения"),
		]
		#expect(JournalLogic.filter(es, level: .all, query: "").count == 3)
		#expect(JournalLogic.filter(es, level: .warnings, query: "").map(\.id) == ["2"])
		#expect(JournalLogic.filter(es, level: .errors, query: "").map(\.id) == ["3"])
		#expect(JournalLogic.filter(es, level: .all, query: " ЧТЕНИЯ ").map(\.id) == ["1", "3"])
		#expect(JournalLogic.filter(es, level: .errors, query: "повтор").isEmpty)
	}

	@Test("слияние: без дублей, замена по id, порядок по времени, предел отбрасывает старые")
	func merging() throws {
		let a = [try entry("1", "2026-10-20T08:00:00Z"), try entry("3", "2026-10-20T10:00:00Z")]
		let b = [try entry("2", "2026-10-20T09:00:00Z"), try entry("3", "2026-10-20T10:00:00Z", level: "error")]
		let m = JournalLogic.merge(a, b, limit: 10)
		#expect(m.map(\.id) == ["1", "2", "3"] && m[2].level == .error)
		#expect(JournalLogic.merge(a, b, limit: 2).map(\.id) == ["2", "3"])
	}

	@MainActor
	@Test("хранилище: страница старее по before, дубли не множатся, пустая страница — конец")
	func loadMore() async throws {
		let fake = FakeLearning()
		fake.view = try learningView(journal: [journalJSON(id: "e-2", ts: "2026-10-20T12:00:00.000Z")])
		let s = LearningStore(source: fake)
		await s.refresh()
		fake.journalPages = [[try entry("e-1", "2026-10-20T11:00:00Z"), try entry("e-2", "2026-10-20T12:00:00.000Z")], []]
		await s.loadMoreJournal()
		#expect(s.journal.map(\.id) == ["e-1", "e-2"] && fake.journalBefore == ["e-2"])
		await s.loadMoreJournal()
		await s.loadMoreJournal()
		#expect(fake.journalBefore == ["e-2", "e-1"] && s.journalExhausted)
	}

	@Test func plainStripsObjectPrefix() {
		#expect(JournalLogic.plain("p-aff-package: правило r-5 активно") == "правило r-5 активно")
		#expect(JournalLogic.plain("c-demo-1: готов") == "готов")
		#expect(JournalLogic.plain("Опубликован плагин p-a") == "Опубликован плагин p-a")
	}
}
