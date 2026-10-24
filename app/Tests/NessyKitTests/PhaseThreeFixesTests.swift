import Foundation
import Testing
@testable import NessyKit

// Исправления этапа 3 по ревью: группа K (описание сессии, rev, черновик плейбука, клиент).

let dirtySummary = """
Вводная строка до заголовка
# Грязный кейс
Текст после заголовка

## Notes from collector
- что-то своё
## Goal: Сделать пакет (type: implement package)
Пояснение сборщика к цели.

### Sources
- GITLAB acme/core
  продолжение источника
### Custom notes
свои строки
- пункт
### Actions
- Сделал раз -> a-1, dev -> ок (n 3–7)
  деталь к действию
- Только итог -> готово
- Агент без итога -> a-2, dev ->
- Просто что
### Plan
- шаг
### User corrections
- Proposed: x. User: "нет" (n 5)
  ещё строка
- Proposed: только предложение
### Open questions
- вопрос
  и его хвост
## Appendix
сырой раздел
### внутри
- не раздел цели
## Goal: Вторая
### Plan
- none

"""

@Suite("K3: описание сессии без потерь")
struct SummaryLossless {
	@Test("круговой тест на грязном образце")
	func dirtyRoundTrip() {
		let s = CaseSummary.parse(dirtySummary)
		#expect(s.render() == dirtySummary)
		#expect(!s.editable)
	}

	@Test("текст до цели, до первого ### и порядок разделов сохраняются")
	func preambleIntroOrder() {
		let s = CaseSummary.parse(dirtySummary)
		#expect(s.title == "Грязный кейс" && s.titleAt == 1)
		#expect(s.preamble.contains("Вводная строка до заголовка") && s.preamble.contains("## Notes from collector"))
		#expect(s.goals[0].intro.contains("Пояснение сборщика к цели."))
		#expect(s.goals[0].slots.count == 6, "known Sources, raw Custom, Actions, Plan, Corrections, Open")
		#expect(s.goals[0].trailing.first == "## Appendix")
	}

	@Test("неизвестный ### и не-Goal ## лежат сырыми строками")
	func rawSections() {
		let g = CaseSummary.parse(dirtySummary).goals[0]
		guard case .raw(let h, let lines) = g.slots[1] else { Issue.record("raw"); return }
		#expect(h == "### Custom notes" && lines == ["свои строки", "- пункт"])
		#expect(g.trailing == ["## Appendix", "сырой раздел", "### внутри", "- не раздел цели"])
	}

	@Test("продолжение пункта — часть пункта")
	func continuation() {
		let g = CaseSummary.parse(dirtySummary).goals[0]
		#expect(g.actions[0].cont == ["  деталь к действию"] && g.actions.count == 4)
		#expect(g.sources == ["GITLAB acme/core\n  продолжение источника"])
		#expect(g.corrections[0].cont == ["  ещё строка"] && g.corrections.count == 2)
		#expect(g.open == ["вопрос\n  и его хвост"])
	}

}

@Suite("K7: rev и чаты при refresh")
@MainActor
struct StoreRev {
	private func store(_ f: FakeLearning) -> LearningStore { LearningStore(source: f) }

	@Test("rev у кадров learning_* разбирается")
	func frameRev() {
		let r = StreamEvent.decodeWithRev(Data(#"{"t":"learning_case","rev":12,"case":\#(caseJSON())}"#.utf8))
		#expect(r.rev == 12)
		guard case .learningCase = r.event else { Issue.record("case"); return }
		#expect(StreamEvent.decodeWithRev(Data(#"{"t":"learning_case","case":\#(caseJSON())}"#.utf8)).rev == nil)
	}

	@Test("LearningView.rev из ответа")
	func viewRev() throws {
		let v: LearningView = try decode(#"{"settings":\#(settingsJSON),"jobs":[],"cases":[],"rev":42}"#)
		#expect(v.rev == 42)
	}

	@Test("событие с rev ≤ ответного не воскрешает удалённое; новее — применяется")
	func bufferFiltersByRev() async throws {
		let fake = FakeLearning()
		var v = try learningView() // кейса уже нет: удалён до сборки ответа
		v.rev = 10
		fake.view = v
		let hold = Hold(); fake.hold = hold
		let s = store(fake)
		let r = Task { await s.refresh() }
		for _ in 0..<100_000 where !hold.entered { await Task.yield() }
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-old"))}"#), rev: 9)
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-new"))}"#), rev: 11)
		hold.release()
		await r.value
		#expect(s.cases.map(\.id) == ["c-new"])
	}

}

extension RuleView {
	static func sample(id: String) -> RuleView {
		try! JSONDecoder().decode(RuleView.self, from: Data(#"{"id":"\#(id)","text":"серверное","stage":null,"status":"candidate","up":0,"down":0,"evidence":[],"against":[],"createdAt":""}"#.utf8))
	}
}

@Suite("K2/K-hash: клиент и хэш")
struct ClientBits {
	@Test("summaryHash в CaseDetail, по умолчанию пусто")
	func detailHash() throws {
		let base = #"{"id":"c-1","title":"T","sessions":[],"status":"ready","goals":[],"events":1,"coveredUntil":1,"createdAt":"a","updatedAt":"b","closedAt":null,"playbook":null,"source":"live","summary":"s","notes":"n""#
		#expect(try decode(base + #","summaryHash":"abc"}"#, as: CaseDetail.self).summaryHash == "abc")
		#expect(try decode(base + "}", as: CaseDetail.self).summaryHash == "")
	}

	@Test("APIError.isStale и версия")
	func stale() {
		#expect(APIError(status: 409, code: "stale", message: "", version: 6).isStale)
		#expect(!APIError(status: 409, code: "playbook_busy", message: "").isStale)
	}

	@Test("sha1 hex")
	func sha1() {
		#expect(TextHash.sha1("abc") == "a9993e364706816aba3e25717850c26c9cd0d89d")
		#expect(TextHash.sha1("") == "da39a3ee5e6b4b0d3255bfef95601890afd80709")
	}
}
