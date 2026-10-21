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

	@Test("render без хвостов -> при пустых agent и result")
	func noDanglingArrows() {
		#expect(CaseSummary.actionText(.init(what: "w")) == "w")
		#expect(CaseSummary.actionText(.init(what: "w", result: "r", anchor: 4...4)) == "w -> r (n 4)")
		#expect(CaseSummary.actionText(.init(what: "w", agent: "a")) == "w -> a ->")
		let s = CaseSummary.parse("# T\n## Goal: G\n### Actions\n- w -> a ->\n- v -> r\n")
		#expect(s.goals[0].actions == [.init(what: "w", agent: "a"), .init(what: "v", result: "r")])
		#expect(CaseSummary.correctionText(.init(proposed: "p", user: "")) == "Proposed: p")
		#expect(CaseSummary.correctionText(.init(proposed: "", user: "u")) == "User: \"u\"")
	}

	@Test("editable: формат сборщика редактируется, лишнее — нет")
	func editableFlag() {
		#expect(CaseSummary.parse(collectorSample).editable)
		#expect(!CaseSummary.parse("просто текст").editable)
		#expect(!CaseSummary.parse("# T\nвводная\n## Goal: G\n### Plan\n- none\n").editable)
		#expect(!CaseSummary.parse("# T\n## Goal: G\nпояснение\n### Plan\n- none\n").editable)
		#expect(!CaseSummary.parse("# T\n## Goal: G\n### Foo\nx\n").editable)
		#expect(!CaseSummary.parse("# T\n## Goal: G\n### Sources\n- a\n  b\n").editable)
		#expect(!CaseSummary.parse("# T\n## Goal: G\n### Plan\n- none\n## Other\nx\n").editable)
	}

	@Test("правка блоками на грязном образце не теряет чужое")
	func editKeepsRaw() {
		var s = CaseSummary.parse(dirtySummary)
		s.goals[0].open.append("новый")
		let out = CaseEditing.markdown(s)
		#expect(out.contains("### Custom notes\nсвои строки") && out.contains("## Appendix") && out.contains("  деталь к действию") && out.contains("- новый"))
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
		fake.delay = .milliseconds(150)
		let s = store(fake)
		let r = Task { await s.refresh() }
		try await Task.sleep(for: .milliseconds(40))
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-old"))}"#), rev: 9)
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-new"))}"#), rev: 11)
		await r.value
		#expect(s.cases.map(\.id) == ["c-new"])
	}

	@Test("после refresh перечитываются уже открытые чаты")
	func chatsReloaded() async throws {
		let fake = FakeLearning()
		fake.view = try learningView()
		fake.chat = [try decode(#"{"id":"m-1","ts":"t","from":"agent","text":"a","changes":[]}"#)]
		let s = store(fake)
		await s.loadChat("p-1")
		fake.chat.append(try decode(#"{"id":"m-2","ts":"t","from":"agent","text":"b","changes":[]}"#))
		await s.refresh()
		#expect(s.chats["p-1"]?.map(\.id) == ["m-1", "m-2"])
	}
}

@Suite("K1: черновик плейбука на base")
struct DraftBase {
	private func pb(version: Int = 3, _ edit: (inout PlaybookView) -> Void = { _ in }) throws -> PlaybookView {
		var p: PlaybookView = try decode(playbookJSON())
		p.version = version
		edit(&p)
		return p
	}

	@Test("baseVersion = версия снимка")
	func baseVersion() throws {
		var d = PlaybookDraft(try pb(version: 7))
		d.title = "Другое"
		#expect(d.patch()?.baseVersion == 7)
	}

	@Test("чужое изменение поля, которое вы не трогали, не попадает в патч")
	func foreignChangeNotSent() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		d.description = "моё описание"
		// сервер уже изменил sources; черновик об этом не знает и патч sources не несёт
		let patch = try #require(d.patch())
		#expect(patch.description == "моё описание" && patch.sources == nil && patch.title == nil && patch.rules == nil && patch.removeRules == nil)
	}

	@Test("удалённое правило — в removeRules, неизменённые правила в патч не идут")
	func removeRules() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		d.removeRule(key: "r-1")
		let patch = try #require(d.patch())
		#expect(patch.removeRules == ["r-1"] && patch.rules == nil)
		var d2 = PlaybookDraft(p)
		d2.rules[0].text = "правка"
		d2.addRule(text: "новое")
		let p2 = try #require(d2.patch())
		#expect(p2.rules?.map(\.id) == ["r-1", nil] && p2.removeRules == nil)
	}

	@Test("кандидат, добавленный сервером после начала, не архивируется")
	func serverCandidateKept() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		d.title = "Новое имя"
		// на сервере к этому времени появилось правило r-9 — в базе черновика его нет
		let patch = try #require(d.patch())
		#expect(patch.removeRules == nil)
	}

	@Test("rebase без конфликтов: чужое берётся, своё остаётся")
	func rebaseClean() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		d.description = "моё"
		let fresh = try pb(version: 4) { $0.sources = ["wiki", "jira"]; $0.rules.append(RuleView.sample(id: "r-9")) }
		let r = d.rebase(onto: fresh)
		#expect(r.conflicts.isEmpty)
		#expect(r.draft.description == "моё" && r.draft.sources == ["wiki", "jira"] && r.draft.base.version == 4)
		#expect(r.draft.rules.map(\.ruleId) == ["r-1", "r-9"])
		let patch = try #require(r.draft.patch())
		#expect(patch.baseVersion == 4 && patch.sources == nil && patch.removeRules == nil)
	}

	@Test("rebase с конфликтом: поле правили оба — остаётся ваше, поле названо")
	func rebaseConflict() throws {
		let p = try pb()
		var d = PlaybookDraft(p)
		d.description = "моё"
		d.rules[0].text = "моё правило"
		let fresh = try pb(version: 4) { $0.description = "чужое"; $0.rules[0].text = "чужое правило" }
		let r = d.rebase(onto: fresh)
		#expect(r.conflicts.contains("Описание") && r.conflicts.contains { $0.hasPrefix("Правило") })
		#expect(r.draft.description == "моё" && r.draft.rules[0].text == "моё правило")
		var taken = r.draft
		taken.take(.description, from: fresh)
		#expect(taken.description == "чужое")
	}

	@Test("одинаковая правка с обеих сторон — не конфликт")
	func rebaseSameChange() throws {
		var d = PlaybookDraft(try pb())
		d.title = "Одно"
		let fresh = try pb(version: 4) { $0.title = "Одно" }
		#expect(d.rebase(onto: fresh).conflicts.isEmpty)
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

	@Test("patch кодирует baseVersion и removeRules")
	func patchBody() throws {
		let patch = PlaybookPatch(baseVersion: 5, rules: [RulePatch(id: "r-1", text: "а")], removeRules: ["r-2"])
		let j = try JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as! [String: Any]
		#expect(j["baseVersion"] as? Int == 5 && j["removeRules"] as? [String] == ["r-2"])
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
