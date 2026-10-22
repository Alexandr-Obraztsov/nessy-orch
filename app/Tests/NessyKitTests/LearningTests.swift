import Foundation
import Testing
@testable import NessyKit

// MARK: образцы JSON (как в docs/api.md и shared/types/learning.ts)

func caseJSON(id: String = "c-1", status: String = "ready", sessions: String = #"["s1"]"#, playbook: String = "null", closedAt: String = "null", updatedAt: String = "2026-10-20T10:00:00.000Z") -> String {
	#"{"id":"\#(id)","title":"Пакет","sessions":\#(sessions),"status":"\#(status)","goals":[{"title":"Собрать пакет","type":"implement package"}],"events":40,"coveredUntil":40,"createdAt":"2026-10-20T09:00:00.000Z","updatedAt":"\#(updatedAt)","closedAt":\#(closedAt),"playbook":\#(playbook),"source":"live"}"#
}
func jobJSON(id: String = "j-1", kind: String = "collect", status: String = "running", caseId: String = "c-1", finishedAt: String = "null") -> String {
	#"{"id":"\#(id)","kind":"\#(kind)","caseId":"\#(caseId)","subject":"\#(caseId)","status":"\#(status)","attempts":1,"agentId":"a-9","error":null,"note":null,"range":[1,40],"createdAt":"2026-10-20T09:30:00.000Z","startedAt":"2026-10-20T09:31:00.000Z","finishedAt":\#(finishedAt)}"#
}
func playbookJSON(id: String = "p-1", status: String = "active", extra: String = "") -> String {
	#"{"id":"\#(id)","name":"build-package","title":"Сборка пакета","description":"Use when building a package","taskType":"implement package","status":"\#(status)","version":3,"cases":["c-1","c-2","c-3"],"heldOut":null,"params":[{"name":"repo","description":"репозиторий","source":"user"}],"sources":["wiki"],"files":["README.md"],"behavior":["спрашивай версию"],"stages":[{"n":1,"slug":"plan","title":"План","role":null,"where":"orch","produce":"план","done":"план согласован","gate":true,"template":""}],"rules":[{"id":"r-1","text":"Проверяй lockfile","stage":1,"status":"active","up":2,"down":0,"evidence":[{"caseId":"c-1","anchor":"n 3–7"}],"against":[],"lastAppliedAt":null,"createdAt":"2026-10-20T09:00:00.000Z"}],"trial":null\#(extra),"createdAt":"2026-10-20T09:00:00.000Z","updatedAt":"2026-10-20T10:00:00.000Z"}"#
}
func journalJSON(id: String, kind: String = "rule_activated", ts: String = "2026-10-20T12:00:00.000Z") -> String {
	#"{"id":"\#(id)","ts":"\#(ts)","kind":"\#(kind)","subject":"p-1","summary":"Правило включено","report":null,"revertible":true,"revertedBy":null}"#
}
let settingsJSON = #"{"enabled":true,"autoReview":false,"intervalMin":10,"idleMin":60,"maxAgents":2,"disabledSessions":["s9"]}"#

func frame(_ s: String) -> StreamEvent { StreamEvent.decode(Data(s.utf8)) }
func decode<T: Decodable>(_ s: String, as: T.Type = T.self) throws -> T { try JSONDecoder().decode(T.self, from: Data(s.utf8)) }

/// Заглушка сервера: отдаёт заданный ответ и считает вызовы.
final class FakeLearning: LearningSource, @unchecked Sendable {
	var view: LearningView?
	var error: Error?
	var delay: Duration = .zero
	var calls = 0
	var chat: [ChatMessage] = []
	func learning() async throws -> LearningView {
		calls += 1
		let v = view, e = error
		if delay > .zero { try? await Task.sleep(for: delay) }
		if let e { throw e }
		return v!
	}
	func chat(_ subject: String) async throws -> [ChatMessage] { chat }
	func sendChat(_ subject: String, text: String) async throws -> ChatMessage {
		try decode(#"{"id":"m-u","ts":"2026-10-20T10:00:00Z","from":"user","text":"\#(text)","changes":[]}"#)
	}
}

extension FakeLearning {
	/// Пустое состояние обучения для тестов `OrchStore`: `snapshot` перечитывает его, не ходя в сеть.
	static func empty() -> FakeLearning {
		let f = FakeLearning()
		f.view = try? learningView()
		return f
	}
}

func learningView(jobs: [String] = [], cases: [String] = [], playbooks: [String] = [], journal: [String] = []) throws -> LearningView {
	try decode(#"{"settings":\#(settingsJSON),"jobs":[\#(jobs.joined(separator: ","))],"cases":[\#(cases.joined(separator: ","))],"playbooks":[\#(playbooks.joined(separator: ","))],"journal":[\#(journal.joined(separator: ","))]}"#)
}

// MARK: модели и кадры SSE

@Suite("Обучение: модели и кадры")
struct LearningDecodingTests {
	@Test func frames() throws {
		guard case .learningJob(let j) = frame(#"{"t":"learning_job","rev":5,"job":\#(jobJSON())}"#) else { Issue.record("job"); return }
		#expect(j.id == "j-1" && j.kind == .collect && j.status == .running && j.range == [1, 40] && j.agentId == "a-9")
		guard case .learningCase(let k) = frame(#"{"t":"learning_case","rev":5,"case":\#(caseJSON(playbook: "\"p-1@3\""))}"#) else { Issue.record("case"); return }
		#expect(k.id == "c-1" && k.status == .ready && k.goals.first?.type == "implement package")
		#expect(k.playbookRef?.id == "p-1" && k.playbookRef?.version == 3)
		guard case .learningCaseRemoved("c-1") = frame(#"{"t":"learning_case_removed","rev":6,"id":"c-1"}"#) else { Issue.record("case_removed"); return }
		guard case .learningSettings(let s) = frame(#"{"t":"learning_settings","rev":7,"settings":\#(settingsJSON)}"#) else { Issue.record("settings"); return }
		#expect(s.enabled && !s.autoReview && s.disabledSessions == ["s9"])
		guard case .learningPlaybook(let p) = frame(#"{"t":"learning_playbook","rev":8,"playbook":\#(playbookJSON())}"#) else { Issue.record("playbook"); return }
		#expect(p.id == "p-1" && p.stages.first?.gate == true && p.stages.first?.where == "orch" && p.rules.first?.evidence.first?.anchor == "n 3–7")
		guard case .learningPlaybookRemoved("p-1") = frame(#"{"t":"learning_playbook_removed","rev":9,"id":"p-1"}"#) else { Issue.record("playbook_removed"); return }
		guard case .learningJournal(let e) = frame(#"{"t":"learning_journal","rev":10,"entry":\#(journalJSON(id: "e-1"))}"#) else { Issue.record("journal"); return }
		#expect(e.kind == .ruleActivated && e.revertible && e.revertedBy == nil)
		guard case .learningChat(let subject, let m) = frame(#"{"t":"learning_chat","rev":11,"subject":"p-1","message":{"id":"m-1","ts":"2026-10-20T10:00:00Z","from":"agent","text":"Готово","changes":["этап 2"]}}"#) else { Issue.record("chat"); return }
		#expect(subject == "p-1" && m.from == .agent && m.changes == ["этап 2"])
	}

	@Test func oldPlaybookWithoutPendingEditsAndUnknownEnums() throws {
		let p = try decode(playbookJSON(status: "новый-статус"), as: PlaybookView.self)
		#expect(p.pendingEdits.isEmpty && p.status == .unknown)
		let with = try decode(playbookJSON(extra: #","pendingEdits":[{"hash":"ab12","file":"SKILL.md","before":"a","after":"b","anchor":"n 3","caseId":"c-1","createdAt":"2026-10-20T10:00:00Z"}]"#), as: PlaybookView.self)
		#expect(with.pendingEdits.map(\.hash) == ["ab12"])
		let j = try decode(jobJSON(kind: "future", status: "paused"), as: JobView.self)
		#expect(j.kind == .unknown && j.status == .unknown)
		#expect(try decode(journalJSON(id: "e", kind: "новое"), as: JournalEntry.self).kind == .unknown)
	}

	@Test func lossyLearningView() throws {
		let v = try decode(#"{"settings":\#(settingsJSON),"jobs":[\#(jobJSON()),{"id":5}],"cases":[{"title":"без id"},\#(caseJSON())],"playbooks":[\#(playbookJSON())],"journal":[\#(journalJSON(id: "e-1")),null]}"#, as: LearningView.self)
		#expect(v.jobs.map(\.id) == ["j-1"] && v.cases.map(\.id) == ["c-1"] && v.playbooks.count == 1 && v.journal.count == 1)
		#expect(v.skipped == 3)
		// старый сервер: нет playbooks и journal
		let old = try decode(#"{"settings":\#(settingsJSON),"jobs":[],"cases":[]}"#, as: LearningView.self)
		#expect(old.playbooks.isEmpty && old.journal.isEmpty)
	}

	@Test func detailsAndReports() throws {
		let d = try decode(playbookJSON(extra: #","notes":"- x","changelog":"v3: правка","versions":[{"version":3,"ts":"2026-10-20T10:00:00Z","message":"правка"}],"reviews":[{"playbookId":"p-1","version":3,"ts":"2026-10-20T10:00:00Z","passed":false,"stages":[{"stage":2,"verdict":"fail","critical":["нет гейта"],"notes":[],"agentIds":["a-1"]}]}]"#), as: PlaybookDetail.self)
		#expect(d.id == "p-1" && d.view.version == 3 && d.versions.first?.message == "правка" && d.reviews.first?.stages.first?.verdict == .fail && d.notes == "- x")
		let c = try decode(#"{"id":"c-1","title":"T","sessions":[],"status":"ready","goals":[],"events":1,"coveredUntil":1,"createdAt":"a","updatedAt":"b","closedAt":null,"playbook":null,"source":"backfill","summary":"Описание","notes":"n"}"#, as: CaseDetail.self)
		#expect(c.id == "c-1" && c.summary == "Описание" && c.view.source == .backfill)
		let jd = try decode(#"{"job":\#(jobJSON()),"runs":[{"name":"collect-1","text":"ответ"}]}"#, as: JobDetail.self)
		#expect(jd.id == "j-1" && jd.runs.first?.text == "ответ")
		let raw = try decode(#"{"n":3,"ts":1760000000000,"kind":"user","from":"you","to":null,"text":"привет","ref":"m1"}"#, as: RawEvent.self)
		#expect(raw.id == 3 && raw.kind == .user && raw.to == nil)
		let imp = try decode(#"{"rules":[{"playbookId":"p-1","ruleId":"r-1","text":"t","evidenceLeft":1}]}"#, as: CaseImpact.self)
		#expect(imp.rules.first?.evidenceLeft == 1)
	}

	@Test func apiErrorFlags() {
		#expect(APIError(status: 503, code: "learning_unavailable", message: "").isUnavailable)
		#expect(APIError(status: 404, code: "not_found", message: "").isUnavailable)
		#expect(!APIError(status: 404, code: "no_case", message: "").isUnavailable)
		#expect(APIError(status: 409, code: "playbook_busy", message: "").isBusy)
		#expect(APIError(status: 400, code: "lint", message: "").isLint)
	}
}

// MARK: LearningStore

@MainActor
@Suite("Обучение: состояние")
struct LearningStoreTests {
	func store(_ fake: FakeLearning = FakeLearning()) -> LearningStore { LearningStore(source: fake) }

	@Test func refreshLoadsAndUnavailable() async throws {
		let fake = FakeLearning()
		fake.view = try learningView(jobs: [jobJSON()], cases: [caseJSON()], playbooks: [playbookJSON()], journal: [journalJSON(id: "e-1")])
		let s = store(fake)
		#expect(!s.loaded)
		await s.refresh()
		#expect(s.loaded && s.available && s.jobs.count == 1 && s.cases.count == 1 && s.playbooks.count == 1 && s.journal.count == 1)
		#expect(s.settings?.autoReview == false)
		// нет связи: данные остаются
		fake.error = APIError(status: 0, code: "offline", message: "нет связи")
		await s.refresh()
		#expect(s.available && s.cases.count == 1)
		// сервер без обучения
		fake.error = APIError(status: 503, code: "learning_unavailable", message: "нет")
		await s.refresh()
		#expect(!s.available)
	}

	@Test func applyUpsertRemoveAndJournalCap() throws {
		let s = store()
		s.apply(frame(#"{"t":"learning_job","job":\#(jobJSON())}"#))
		s.apply(frame(#"{"t":"learning_job","job":\#(jobJSON(status: "done"))}"#))
		#expect(s.jobs.count == 1 && s.jobs[0].status == .done, "upsert по id")
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON())}"#))
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-2"))}"#))
		s.apply(frame(#"{"t":"learning_case_removed","id":"c-1"}"#))
		#expect(s.cases.map(\.id) == ["c-2"])
		for i in 0..<250 { s.apply(frame(#"{"t":"learning_journal","entry":\#(journalJSON(id: "e-\(i)"))}"#)) }
		#expect(s.journal.count == 200 && s.journal.first?.id == "e-50" && s.journal.last?.id == "e-249")
		// повторная запись (откат) заменяет, а не дублирует
		s.apply(frame(#"{"t":"learning_journal","entry":\#(journalJSON(id: "e-249", kind: "reverted"))}"#))
		#expect(s.journal.count == 200 && s.journal.last?.kind == .reverted)
	}

	@Test func snapshotTriggersRefresh() async throws {
		let fake = FakeLearning()
		fake.view = try learningView(cases: [caseJSON()])
		let s = store(fake)
		s.apply(frame(#"{"t":"snapshot","rev":1,"spaces":[],"agents":[],"roles":[],"sessions":[],"messages":[]}"#))
		for _ in 0..<100 where fake.calls == 0 { try await Task.sleep(for: .milliseconds(10)) }
		for _ in 0..<100 where s.cases.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
		#expect(fake.calls == 1 && s.cases.count == 1)
	}

	@Test func orchStoreForwardsLearningEvents() throws {
		let o = OrchStore(learning: FakeLearning.empty(), defaults: UserDefaults(suiteName: "test-\(UUID())")!)
		o.apply(frame(#"{"t":"learning_job","job":\#(jobJSON())}"#))
		o.apply(frame(#"{"t":"learning_case","case":\#(caseJSON())}"#))
		#expect(o.learning.jobs.count == 1 && o.learning.cases.count == 1)
	}

	@Test func eventsDuringRefreshSurviveStaleResponse() async throws {
		let fake = FakeLearning()
		fake.view = try learningView(cases: [caseJSON()]) // ответ собран до события
		fake.delay = .milliseconds(150)
		let s = store(fake)
		let r = Task { await s.refresh() }
		try await Task.sleep(for: .milliseconds(40))
		s.apply(frame(#"{"t":"learning_case","case":\#(caseJSON(id: "c-new"))}"#))
		await r.value
		#expect(Set(s.cases.map(\.id)) == ["c-1", "c-new"], "событие не теряется из-за устаревшего ответа")
		// событие до первого чтения не дублируется после него
		let s2 = store(fake)
		s2.apply(frame(#"{"t":"learning_case","case":\#(caseJSON())}"#))
		await s2.refresh()
		#expect(s2.cases.count == 1)
	}

}

// MARK: описание сессии

let collectorSample = """
# Package build and review
## Goal: Build package acme-core v2 (type: implement package)
### Plan
Build in two steps, then ask the user for the review.
- first the core, then the docs
### Actions
- Cloned repo and read README -> a-1, code-explorer -> found the build script (n 3–7)
- Ran the build -> a-2, builder -> failed: missing lockfile (n 12)
- Wrote CHANGELOG -> a-3, writer -> done
### Sources
- GITLAB acme/core
- wiki: Build guide
### User corrections
- Proposed: bump the version to 2.1. User: "no, keep 2.0 until release" (n 14–15)
### Open questions
- none
## Goal: Review merge request !42 (type: review merge request)
### Plan
- none
### Actions
- none
### Sources
- MR !42
### User corrections
- none
### Open questions
- Who merges?

"""

@Suite("Обучение: описание сессии")
struct CaseSummaryTests {
	@Test func parsesCollectorFormat() {
		let s = CaseSummary.parse(collectorSample)
		#expect(!s.unparsed && s.title == "Package build and review" && s.goals.count == 2)
		let g = s.goals[0]
		#expect(g.title == "Build package acme-core v2" && g.type == "implement package")
		#expect(g.plan == ["Build in two steps, then ask the user for the review.", "- first the core, then the docs"])
		#expect(g.actions.count == 3)
		#expect(g.actions[0] == .init(what: "Cloned repo and read README", agent: "a-1, code-explorer", result: "found the build script", anchor: 3...7))
		#expect(g.actions[1].anchor == 12...12 && g.actions[1].result == "failed: missing lockfile")
		#expect(g.actions[2].anchor == nil)
		#expect(g.sources == ["GITLAB acme/core", "wiki: Build guide"])
		#expect(g.corrections == [.init(proposed: "bump the version to 2.1", user: "no, keep 2.0 until release", anchor: 14...15)])
		#expect(g.open.isEmpty, "`- none` — пустой раздел")
		let g2 = s.goals[1]
		#expect(g2.plan.isEmpty && g2.actions.isEmpty && g2.corrections.isEmpty && g2.open == ["Who merges?"])
	}

	@Test func roundTrip() {
		#expect(CaseSummary.parse(collectorSample).render() == collectorSample)
	}

	@Test func arrowAndDashVariants() {
		let s = CaseSummary.parse("""
		# T
		## Goal: G (type: t)
		### Actions
		- Did it → a-1 → ok (n 5-9)
		""")
		#expect(s.goals[0].actions == [.init(what: "Did it", agent: "a-1", result: "ok", anchor: 5...9)])
	}

	@Test func unparsedText() {
		let s = CaseSummary.parse("Просто текст без разделов.\n\n- пункт\n")
		#expect(s.unparsed && s.goals.isEmpty)
		#expect(CaseSummary.parse("").unparsed)
	}

}

@Suite("Обучение: тексты и ссылки")
struct LearningTextTests {
	@Test func kindsAndStatuses() throws {
		#expect(LearningText.kind(.collect) == "Описание сессии" && LearningText.kind(.match) == "Сопоставление" && LearningText.kind(.edit) == "Правка из чата")
		#expect(LearningText.caseStatus(.collecting) == "собирается" && LearningText.playbookStatus(.review) == "ждёт вас")
		#expect(LearningText.journalKind(.reviewFailed) == "Ревью не пройдено" && LearningText.rawKind(.reply) == "ответ агента")
	}

	@Test func anchorText() {
		#expect(LearningText.anchor(3...7) == "n 3–7" && LearningText.anchor(5...5) == "n 5")
		#expect(LearningText.parseAnchor("n 3–7") == 3...7 && LearningText.parseAnchor("(n 12)") == 12...12 && LearningText.parseAnchor("3-7") == nil)
	}

	@Test func backgroundLinks() {
		let a = BackgroundSection.parse(host: "background", path: ["/", "cases", "c-1"])
		#expect(a?.section == .cases && a?.id == "c-1")
		#expect(BackgroundSection.parse(host: "background", path: [])?.section == .work)
		#expect(BackgroundSection.parse(host: "background", path: ["/", "nope"]) == nil)
		#expect(BackgroundSection.parse(host: "session", path: ["/", "x"]) == nil)
		#expect(BackgroundSection.playbooks.link(id: "p-1")?.absoluteString == "nessy-orch://background/playbooks/p-1")
	}
}
