import Foundation
import Testing
@testable import NessyKit

private func pb(_ id: String = "p-1", status: String = "active", updated: String = "2026-10-20T10:00:00.000Z", extra: String = "") throws -> PlaybookView {
	var j = playbookJSON(id: id, status: status, extra: extra)
	j = j.replacingOccurrences(of: "\"updatedAt\":\"2026-10-20T10:00:00.000Z\"", with: "\"updatedAt\":\"\(updated)\"")
	return try decode(j)
}

private let edit = #","pendingEdits":[{"hash":"h1","file":"stages/01-plan.md","before":"a","after":"b","anchor":"n 1","caseId":"c-1","createdAt":"2026-10-20T10:00:00.000Z"}]"#
private let twoStages = #"{"id":"p-2","name":"x","title":"X","description":"d","taskType":"t","status":"active","version":1,"cases":[],"params":[],"sources":[],"files":[],"behavior":[],"stages":[{"n":1,"slug":"a","title":"A","where":"","produce":"","done":"","gate":false,"template":""},{"n":2,"slug":"b","title":"B","where":"","produce":"","done":"","gate":true,"template":""},{"n":3,"slug":"c","title":"C","where":"","produce":"","done":"","gate":false,"template":""}],"rules":[{"id":"r-1","text":"one","stage":1,"status":"active","up":3,"down":1,"evidence":[],"against":[],"createdAt":""},{"id":"r-2","text":"two","stage":2,"status":"candidate","up":0,"down":2,"evidence":[],"against":[],"createdAt":""},{"id":"r-3","text":"old","stage":3,"status":"archived","up":9,"down":9,"evidence":[],"against":[],"createdAt":""}],"createdAt":"","updatedAt":""}"#

@Suite("Плейбуки: список и черновик")
struct PlaybookEditingTests {
	@Test("группы: ждущие сверху, пустые пропущены, свежие первыми")
	func groups() throws {
		let list = [try pb("p-a", status: "active", updated: "2026-10-01T00:00:00Z"), try pb("p-b", status: "active", updated: "2026-10-05T00:00:00Z"),
			try pb("p-c", status: "review"), try pb("p-d", status: "disabled"), try pb("p-e", status: "active", extra: edit), try pb("p-f", status: "trial")]
		let g = PlaybookEditing.groups(list)
		#expect(g.map(\.group) == [.waiting, .active, .trial, .off])
		#expect(Set(g[0].items.map(\.id)) == ["p-c", "p-e"])
		#expect(g[1].items.map(\.id) == ["p-b", "p-a"])
		#expect(PlaybookGroup.off.collapsedByDefault && !PlaybookGroup.active.collapsedByDefault)
	}

	@Test("пробный: «1 из 3 кейсов», у остальных нет; суммарные ▲▼ без архива")
	func trialAndBalance() throws {
		let t = try pb(status: "trial")
		#expect(PlaybookEditing.trialLine(t) == "0 из 3 кейсов")
		let t1: PlaybookView = try decode(playbookJSON(status: "trial").replacingOccurrences(of: #""trial":null"#, with: #""trial":{"before":4,"cases":["c-1"],"corrections":[2]}"#))
		#expect(PlaybookEditing.trialLine(t1) == "1 из 3 кейсов")
		#expect(PlaybookEditing.trialAverage(t1) == 2)
		#expect(PlaybookEditing.trialLine(try pb()) == nil)
		let b = PlaybookEditing.ruleBalance(try decode(twoStages))
		#expect(b.up == 3 && b.down == 3)
	}

	@Test("без правок патча нет; меняется только изменённое поле")
	func patchOnlyChanged() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		#expect(d.patch(against: p) == nil && !d.isDirty(against: p))
		d.sources.append("  jira  "); d.sources.append("   ")
		let patch = try #require(d.patch(against: p))
		#expect(patch.sources == ["wiki", "jira"] && patch.files == nil && patch.rules == nil && patch.stages == nil)
	}

	@Test("правила: новое без id, правка с id, удалённого нет в теле, архивные не входят")
	func rulePatch() throws {
		let p: PlaybookView = try decode(twoStages)
		var d = PlaybookDraft(p)
		#expect(d.rules.map(\.ruleId) == ["r-1", "r-2"])
		d.rules[0].text = "один"
		d.removeRule(key: "r-2")
		d.addRule(text: "новое", stage: 2)
		let r = try #require(d.patch(against: p)?.rules)
		#expect(r.map(\.id) == ["r-1", nil] && r[0].text == "один" && r[1].stage == 2)
		#expect(d.removedRules(against: p).map(\.id) == ["r-2"])
	}

	@Test("перенос этапа тянет за собой этап правил, удаление сдвигает и снимает")
	func stageMoves() throws {
		let p: PlaybookView = try decode(twoStages)
		var d = PlaybookDraft(p)
		d.moveStage(at: 0, by: 1)
		#expect(d.stages.map(\.slug) == ["b", "a", "c"] && d.stages.map(\.n) == [1, 2, 3])
		#expect(d.rules.map(\.stage) == [2, 1])
		d.removeStage(at: 0) // b
		#expect(d.stages.map(\.slug) == ["a", "c"])
		#expect(d.rules.map(\.stage) == [1, nil])
		d.moveStage(at: 1, by: 1) // за границу: ничего
		#expect(d.stages.map(\.slug) == ["a", "c"])
		let patch = try #require(d.patch(against: p))
		#expect(patch.stages?.map(\.n) == [1, 2])
	}

	@Test("тело патча кодирует этап правила null явно, id нового правила не пишет")
	func encoding() throws {
		let p: PlaybookView = try decode(twoStages)
		var d = PlaybookDraft(p)
		d.addRule(text: "без этапа")
		let data = try JSONEncoder().encode(try #require(d.patch(against: p)))
		let s = String(decoding: data, as: UTF8.self)
		#expect(s.contains(#""stage":null"#) && s.contains(#""text":"без этапа""#))
		#expect(!s.contains(#""title""#))
	}

	@Test("lint: замечания по строкам; заметки — строки туда и обратно")
	func textHelpers() {
		#expect(PlaybookEditing.lintLines("a\n\n  b \n") == ["a", "b"])
		#expect(PlaybookEditing.noteLines("# Notes\n\n- 20.10: x\n") == ["# Notes", "- 20.10: x"])
		#expect(PlaybookEditing.notesText(["# Notes", " ", "- x"]) == "# Notes\n- x\n")
		#expect(PlaybookEditing.notesText([]) == "")
	}

	@Test("переключатель: активный выключается, выключенный включается, черновику нельзя")
	func toggle() throws {
		#expect(PlaybookEditing.toggleStatus(try pb(status: "active"))?.to == .disabled)
		#expect(PlaybookEditing.toggleStatus(try pb(status: "trial"))?.to == .disabled)
		#expect(PlaybookEditing.toggleStatus(try pb(status: "disabled"))?.to == .active)
		#expect(PlaybookEditing.toggleStatus(try pb(status: "draft")) == nil)
	}
}

@Suite("Плейбуки: повтор при занятом плейбуке")
struct PlaybookRetryTests {
	private final class Counter: @unchecked Sendable { var n = 0 }
	private func busy() -> APIError { APIError(status: 409, code: "playbook_busy", message: "занят") }

	@Test("повторяет, пока занят, и возвращает результат")
	func retriesThenSucceeds() async throws {
		let c = Counter()
		let r = try await PlaybookEditing.retryingWhileBusy(attempts: 5, delay: .milliseconds(1)) { () -> Int in
			c.n += 1
			if c.n < 3 { throw busy() }
			return c.n
		}
		#expect(r == 3)
	}

	@Test("после лимита отдаёт ошибку занятости")
	func givesUp() async {
		let c = Counter()
		do {
			_ = try await PlaybookEditing.retryingWhileBusy(attempts: 3, delay: .milliseconds(1)) { () -> Int in c.n += 1; throw busy() }
			Issue.record("ожидалась ошибка")
		} catch let e as APIError { #expect(e.isBusy && c.n == 3) } catch { Issue.record("не та ошибка") }
	}

	@Test("другая ошибка не повторяется")
	func otherErrorImmediately() async {
		let c = Counter()
		do {
			_ = try await PlaybookEditing.retryingWhileBusy(attempts: 3, delay: .milliseconds(1)) { () -> Int in c.n += 1; throw APIError(status: 400, code: "lint", message: "x\ny") }
			Issue.record("ожидалась ошибка")
		} catch let e as APIError { #expect(e.isLint && c.n == 1) } catch { Issue.record("не та ошибка") }
	}
}
