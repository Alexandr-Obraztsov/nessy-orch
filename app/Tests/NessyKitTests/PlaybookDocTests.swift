import Foundation
import Testing
@testable import NessyKit

@Suite("Документ плейбука")
struct PlaybookDocTests {
	@Test func outcomes() {
		#expect(PlaybookDocLogic.outcome(APIError(status: 409, code: "stale", message: "x")) == .stale)
		#expect(PlaybookDocLogic.outcome(APIError(status: 409, code: "playbook_busy", message: "x")) == .busy)
		#expect(PlaybookDocLogic.outcome(APIError(status: 400, code: "lint", message: "первое\n\n второе ")) == .lint(["первое", "второе"]))
		#expect(PlaybookDocLogic.outcome(APIError(status: 500, code: "x", message: "сбой")) == .failed("сбой"))
	}

	@Test func softDecoding() throws {
		let d: PlaybookDetail = try decode(##"{"id":"p-1","sources":[{"session":"Разбор MR","date":"2026-10-20"},"старая строка"],"markdown":"# Док","fileTexts":{"tools/run.sh":"echo"}}"##)
		#expect(d.markdown == "# Док")
		#expect(d.view.sources.map(\.session) == ["Разбор MR", "старая строка"])
		#expect(PlaybookDocLogic.entries(d).map(\.path) == ["SKILL.md", "tools/run.sh"])
		#expect(PlaybookDocLogic.toolText(d, path: "tools/run.sh") == "echo")
		let old: PlaybookDetail = try decode(#"{"id":"p-2"}"#)
		#expect(old.markdown.isEmpty)
	}

	@Test func settingsDefaults() throws {
		let s: LearningSettings = try decode("{}")
		#expect(s.idleMin == 120 && s.retrySec == 60 && s.stallMin == 20 && s.blockEvents == 80 && s.blockChars == 40000 && s.archiveDays == 30)
	}
}
