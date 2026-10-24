import Foundation
import Testing
@testable import NessyKit

@Suite("Окно «Фон»: списки и подписи")
struct BackgroundLogicTests {
	private func job(_ id: String, kind: String = "collect", status: String, subject: String? = nil, extra: String = "") throws -> JobView {
		var j = jobJSON(id: id, kind: kind, status: status)
		if let subject { j = j.replacingOccurrences(of: #""subject":"c-1""#, with: #""subject":"\#(subject)""#) }
		if !extra.isEmpty { j = String(j.dropLast()) + "," + extra + "}" }
		return try decode(j)
	}

	@Test("новые поля задания, кейса и плейбука читаются мягко")
	func newFields() throws {
		let j: JobView = try job("j-1", status: "running", extra: #""title":"Сессия про пакет","progress":{"read":12,"total":40}"#)
		#expect(j.title == "Сессия про пакет" && j.progress == JobProgress(read: 12, total: 40))
		let old: JobView = try decode(jobJSON())
		#expect(old.title == nil && old.progress == nil)
		let d: CaseDetail = try decode(String(caseJSON().dropLast()) + ##","summary":"x","draft":"черновик","progress":{"read":1,"total":2}}"##)
		#expect(d.draft == "черновик" && d.progress?.total == 2)
		let d0: CaseDetail = try decode(caseJSON())
		#expect(d0.draft == "" && d0.progress == nil)
		let p: PlaybookView = try decode(playbookJSON(extra: #","tools":[{"name":"check.sh","description":"проверка","content":"echo ok"}]"#))
		#expect(p.tools.map(\.name) == ["check.sh"] && p.tools[0].content == "echo ok")
		let pd: PlaybookDetail = try decode(playbookJSON(extra: ##","fileTexts":{"SKILL.md":"Скилл"}"##))
		#expect(pd.files["SKILL.md"] == "Скилл")
		let old2: PlaybookDetail = try decode(playbookJSON())
		#expect(old2.files.isEmpty && old2.view.tools.isEmpty)
	}

	@Test("«В процессе»: ждущие и идущие сессии, чужие виды заданий не попадают")
	func processLists() throws {
		let jobs = [try job("j-1", status: "queued"), try job("j-2", kind: "close", status: "running"), try job("j-3", kind: "build", status: "running"),
					try job("j-4", status: "done"), try job("j-5", status: "error")]
		#expect(BackgroundLogic.waiting(jobs).map(\.id) == ["j-1"])
		#expect(BackgroundLogic.processing(jobs).map(\.id) == ["j-2"])
	}

	@Test("название строки: из задания, иначе запасное; прогресс словами")
	func titlesAndProgress() throws {
		let j: JobView = try job("j-1", status: "running", extra: #""title":"  ""#)
		#expect(BackgroundLogic.jobTitle(j, fallback: "Кейс") == "Кейс")
		let k: JobView = try job("j-1", status: "running", extra: #""title":"Имя""#)
		#expect(BackgroundLogic.jobTitle(k, fallback: "Кейс") == "Имя")
		#expect(BackgroundLogic.progressLine(JobProgress(read: 12, total: 40)) == "Прочитано 12 из 40 событий")
		#expect(BackgroundLogic.progressLine(nil) == "Читаю сессию…")
		#expect(BackgroundLogic.progressFraction(JobProgress(read: 10, total: 40)) == 0.25)
		#expect(BackgroundLogic.progressFraction(JobProgress(read: 50, total: 40)) == 1)
	}

	@Test("плейбуки: готовые и «в процессе», поиск по названию и описанию, выключенные скрыты")
	func playbookLists() throws {
		var a: PlaybookView = try decode(playbookJSON(id: "p-a", status: "active"))
		a.title = "Сборка пакета"
		var b: PlaybookView = try decode(playbookJSON(id: "p-b", status: "draft")); b.title = "Черновик"
		var c: PlaybookView = try decode(playbookJSON(id: "p-c", status: "trial")); c.title = "Пробный"; c.description = "про ревью кода"
		let d: PlaybookView = try decode(playbookJSON(id: "p-d", status: "disabled"))
		let building = try job("j-9", kind: "improve", status: "running", subject: "p-a")
		let r = BackgroundLogic.playbooks([a, b, c, d], jobs: [building], query: "")
		#expect(r.ready.map(\.id) == ["p-c"] && Set(r.inProgress.map(\.id)) == ["p-a", "p-b"])
		#expect(BackgroundLogic.playbooks([a, b, c], jobs: [], query: "ревью").ready.map(\.id) == ["p-c"])
		#expect(BackgroundLogic.playbooks([a, b, c], jobs: [], query: "ПАКЕТ").ready.map(\.id) == ["p-a"])
		#expect(BackgroundLogic.playbookLine(a) == "v3 · 3 кейса")
	}

	@Test("кейсы: поиск по названию, целям и сессиям; свежие сверху")
	func caseList() throws {
		let c1: CaseView = try decode(caseJSON(id: "c-1", updatedAt: "2026-10-20T10:00:00.000Z"))
		let c2: CaseView = try decode(caseJSON(id: "c-2", updatedAt: "2026-10-21T10:00:00.000Z"))
		let all = BackgroundLogic.cases([c1, c2], query: "", titleOf: { $0.title ?? "" }, sessionTitlesOf: { _ in [] })
		#expect(all.map(\.id) == ["c-2", "c-1"])
		#expect(BackgroundLogic.cases([c1, c2], query: "implement", titleOf: { _ in "" }, sessionTitlesOf: { _ in [] }).count == 2)
		#expect(BackgroundLogic.cases([c1, c2], query: "zzz", titleOf: { _ in "" }, sessionTitlesOf: { _ in [] }).isEmpty)
	}

	@Test("текст плана и markdown в описании")
	func texts() {
		#expect(BackgroundLogic.planLine("- 1. Прочитать") == "1. Прочитать" && BackgroundLogic.planLine("1. Прочитать") == "1. Прочитать")
		#expect(String(BackgroundLogic.inline("запусти `npm test`").characters) == "запусти npm test")
		#expect(BackgroundLogic.plain("`wiki` **x**") == "wiki x")
	}
}
