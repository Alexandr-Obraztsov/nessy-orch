import Foundation
import Testing
@testable import NessyKit

@Suite struct JournalLogicTests {
	private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
	private func entry(_ id: String, ts: String, subject: String = "p-1", report: String? = nil, revertible: Bool = true, reverted: String? = nil) throws -> JournalEntry {
		let rep = report.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\\\"") + "\"" } ?? "null"
		let rb = reverted.map { "\"\($0)\"" } ?? "null"
		return try decode(#"{"id":"\#(id)","ts":"\#(ts)","kind":"edit","subject":"\#(subject)","summary":"s","report":\#(rep),"revertible":\#(revertible),"revertedBy":\#(rb)}"#)
	}

	@Test func groupsByDayNewestFirst() throws {
		let list = [
			try entry("a", ts: "2026-10-20T10:00:00.000Z"),
			try entry("b", ts: "2026-10-21T08:00:00.000Z"),
			try entry("c", ts: "2026-10-20T18:00:00.000Z"),
			try entry("d", ts: "мусор"),
		]
		let days = JournalLogic.days(list, calendar: cal)
		#expect(days.count == 3)
		#expect(days[0].entries.map(\.id) == ["b"])
		#expect(days[1].entries.map(\.id) == ["c", "a"])
		#expect(days[2].entries.map(\.id) == ["d"])
		#expect(JournalLogic.dayTitle(days[2].start, calendar: cal) == "Без даты")
	}

	@Test func dayTitles() throws {
		let now = ISO.parse("2026-10-21T12:00:00.000Z")!
		let today = cal.startOfDay(for: now)
		#expect(JournalLogic.dayTitle(today, now: now, calendar: cal) == "Сегодня")
		#expect(JournalLogic.dayTitle(cal.date(byAdding: .day, value: -1, to: today)!, now: now, calendar: cal) == "Вчера")
	}

	@Test func revertRules() throws {
		#expect(JournalLogic.canRevert(try entry("a", ts: "")))
		#expect(!JournalLogic.canRevert(try entry("a", ts: "", revertible: false)))
		let r = try entry("a", ts: "", reverted: "j-2")
		#expect(!JournalLogic.canRevert(r) && JournalLogic.isReverted(r))
	}

	@Test func targets() throws {
		#expect(JournalLogic.target(try entry("a", ts: "", subject: "p-7")) == .playbook("p-7"))
		#expect(JournalLogic.target(try entry("a", ts: "", subject: "c-3")) == .caseView("c-3"))
		#expect(JournalLogic.target(try entry("a", ts: "", subject: "x")) == nil)
	}

	@Test func parsesReport() throws {
		let review = #"{"prevStatus":"draft","review":{"playbookId":"p-1","version":2,"ts":"2026-10-20T10:00:00.000Z","passed":false,"stages":[{"stage":1,"verdict":"pass","critical":[],"notes":[],"agentIds":[]},{"stage":2,"verdict":"fail","critical":["плохо"],"notes":[],"agentIds":[]}]}}"#
		let r = try #require(JournalLogic.report(try entry("a", ts: "", report: review)))
		#expect(r.prevStatus == "draft")
		#expect(r.review?.stages.map(\.verdict) == [.pass, .fail])
		#expect(JournalLogic.report(try entry("a", ts: "")) == nil)
		#expect(JournalLogic.report(try entry("a", ts: "", report: "не json")) == nil)
		#expect(JournalLogic.report(try entry("a", ts: "", report: "{}")) == nil)
		let only = try #require(JournalLogic.report(try entry("a", ts: "", report: #"{"ruleId":"r","prevStatus":"active"}"#)))
		#expect(only.prevStatus == "active" && only.review == nil)
	}

	@Test func sessionMenu() throws {
		let s: LearningSettings = try decode(settingsJSON)   // enabled, disabledSessions: [s9]
		let ready: CaseView = try decode(caseJSON(status: "ready"))
		let live: CaseView = try decode(caseJSON(status: "collecting"))
		let m = JournalLogic.SessionMenu(settings: s, caseView: ready, session: "s1")
		#expect(m.learnsHere && m.canRun && m.canRebuild && !m.canStop && m.canDelete && m.canOpen)
		#expect(JournalLogic.SessionMenu(settings: s, caseView: live, session: "s1").canStop)
		let off = JournalLogic.SessionMenu(settings: s, caseView: nil, session: "s9")
		#expect(!off.learnsHere && !off.canRun && !off.canOpen && !off.canDelete)
		#expect(!JournalLogic.SessionMenu(settings: nil, caseView: nil, session: "s1").canRun)
	}

	@Test func toggledDisabled() {
		#expect(JournalLogic.toggled(["a"], session: "b", learn: false) == ["a", "b"])
		#expect(JournalLogic.toggled(["a", "b"], session: "b", learn: true) == ["a"])
		#expect(JournalLogic.toggled(["a", "b"], session: "b", learn: false) == ["a", "b"])
	}

	@Test func backfillText() throws {
		let s: BackfillCandidate = try decode(#"{"kind":"session","id":"s1","title":"t","date":"","size":3}"#)
		let t: BackfillCandidate = try decode(#"{"kind":"transcript","id":"t1","title":"t","date":"","size":2048}"#)
		#expect(JournalLogic.size(s) == "3 сообщения")
		#expect(JournalLogic.size(t) == "2 КБ")
	}
}
