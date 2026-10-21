import Foundation
import Testing
@testable import NessyKit

private func kase(_ id: String, status: String, title: String, goal: String = "Цель", type: String = "t", sessions: String = #"["s1"]"#, updated: String) throws -> CaseView {
	try JSONDecoder().decode(CaseView.self, from: Data(#"{"id":"\#(id)","title":"\#(title)","sessions":\#(sessions),"status":"\#(status)","goals":[{"title":"\#(goal)","type":"\#(type)"}],"events":1,"coveredUntil":1,"createdAt":"2026-10-20T09:00:00Z","updatedAt":"\#(updated)","source":"live"}"#.utf8))
}

private func job(_ status: String, caseId: String) throws -> JobView {
	try JSONDecoder().decode(JobView.self, from: Data(#"{"id":"j","kind":"collect","caseId":"\#(caseId)","subject":"\#(caseId)","status":"\#(status)","attempts":1,"createdAt":"2026-10-20T09:30:00Z"}"#.utf8))
}

@Suite("Правка кейсов")
struct CaseEditingTests {
	@Test("фильтр по статусу и сортировка по свежести")
	func filterAndSort() throws {
		let a = try kase("a", status: "ready", title: "Старый", updated: "2026-10-18T10:00:00Z")
		let b = try kase("b", status: "collecting", title: "Новый", updated: "2026-10-20T10:00:00Z")
		let c = try kase("c", status: "closing", title: "Средний", updated: "2026-10-19T10:00:00Z")
		let all = CaseEditing.list([a, b, c], filter: .all, query: "", titleOf: { $0.title ?? "" }, sessionTitlesOf: { _ in [] })
		#expect(all.map(\.id) == ["b", "c", "a"])
		let coll = CaseEditing.list([a, b, c], filter: .collecting, query: "", titleOf: { $0.title ?? "" }, sessionTitlesOf: { _ in [] })
		#expect(coll.map(\.id) == ["b", "c"])
		let err = CaseEditing.list([a, b, c], filter: .error, query: "", titleOf: { $0.title ?? "" }, sessionTitlesOf: { _ in [] })
		#expect(err.isEmpty)
	}

	@Test("поиск по заголовку, цели, типу и названию сессии без учёта регистра")
	func search() throws {
		let a = try kase("a", status: "ready", title: "Пакет", goal: "Собрать lockfile", type: "implement", updated: "2026-10-18T10:00:00Z")
		let b = try kase("b", status: "ready", title: "Другое", sessions: #"["s2"]"#, updated: "2026-10-19T10:00:00Z")
		func find(_ q: String) -> [String] {
			CaseEditing.list([a, b], filter: .all, query: q, titleOf: { $0.title ?? "" }, sessionTitlesOf: { $0.sessions == ["s2"] ? ["Релиз Альфа"] : [] }).map(\.id)
		}
		#expect(find("LOCKFILE") == ["a"])
		#expect(find("implement") == ["a"])
		#expect(find("альфа") == ["b"])
		#expect(find("пакет") == ["a"])
		#expect(find("  ") == ["b", "a"])
	}

	@Test("перестановка не выходит за границы")
	func move() {
		#expect(CaseEditing.moved([1, 2, 3], at: 0, by: 1) == [2, 1, 3])
		#expect(CaseEditing.moved([1, 2, 3], at: 0, by: -1) == [1, 2, 3])
		#expect(CaseEditing.moved([1, 2, 3], at: 2, by: 1) == [1, 2, 3])
		#expect(CaseEditing.moved([1, 2, 3], at: 2, by: -1) == [1, 3, 2])
	}

	@Test("повтор сохранения, когда по кейсу нет живых заданий")
	func retry() throws {
		#expect(!CaseEditing.canRetry(jobs: [try job("running", caseId: "c-1")], caseId: "c-1"))
		#expect(!CaseEditing.canRetry(jobs: [try job("queued", caseId: "c-1")], caseId: "c-1"))
		#expect(CaseEditing.canRetry(jobs: [try job("done", caseId: "c-1"), try job("running", caseId: "c-2")], caseId: "c-1"))
		#expect(CaseEditing.canRetry(jobs: [], caseId: "c-1"))
	}

	@Test("заметки: строки туда и обратно, пустые отбрасываются")
	func notes() {
		#expect(CaseEditing.notes(from: "a\n\n  b  \n") == ["a", "b"])
		#expect(CaseEditing.text(fromNotes: ["a", " ", "b"]) == "a\nb\n")
		#expect(CaseEditing.text(fromNotes: []) == "")
	}

	@Test("сборка markdown из правок: пустые пункты уходят, формат сборщика сохраняется")
	func markdownFromEdits() {
		var s = CaseSummary(title: "Кейс", goals: [CaseSummary.Goal(title: "Цель", type: "t", plan: ["1. шаг"],
			actions: [CaseSummary.Action(what: "сделал", agent: "a, dev", result: "ок", anchor: 3...7), CaseSummary.Action(what: "  ")],
			sources: ["wiki", ""], corrections: [CaseSummary.Correction(proposed: "", user: "")], open: [" "])])
		let md = CaseEditing.markdown(s)
		#expect(md == "# Кейс\n## Goal: Цель (type: t)\n### Plan\n1. шаг\n### Actions\n- сделал -> a, dev -> ок (n 3–7)\n### Sources\n- wiki\n### User corrections\n- none\n### Open questions\n- none\n")
		// правка переживает круг разбора
		s.goals[0].open = ["версия?"]
		let back = CaseSummary.parse(CaseEditing.markdown(s))
		#expect(back.goals[0].open == ["версия?"])
		#expect(back.goals[0].actions.count == 1)
	}

	@Test("предупреждение об удалении перечисляет правила")
	func impact() throws {
		let i = try JSONDecoder().decode(CaseImpact.self, from: Data(#"{"rules":[{"playbookId":"p-1","ruleId":"r-1","text":"Проверяй lockfile","evidenceLeft":0},{"playbookId":"p-1","ruleId":"r-2","text":"Другое","evidenceLeft":2}]}"#.utf8))
		let l = CaseEditing.impactLines(i)
		#expect(l.count == 2)
		#expect(l[0].contains("без доказательств"))
		#expect(l[1].contains("осталось 2"))
		#expect(CaseEditing.impactLines(try JSONDecoder().decode(CaseImpact.self, from: Data("{}".utf8))).isEmpty)
	}
}
