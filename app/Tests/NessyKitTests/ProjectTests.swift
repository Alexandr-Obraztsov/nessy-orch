import Foundation
import Testing
@testable import NessyKit

func sessionJSON(_ id: String, title: String = "T", status: String = "active") -> SessionView {
	let j = #"{"id":"\#(id)","title":"\#(title)","owner":"claude","status":"\#(status)","summary":null,"createdAt":"2026-10-10T10:00:00Z","updatedAt":"2026-10-10T10:00:00Z","sources":0}"#
	return try! JSONDecoder().decode(SessionView.self, from: Data(j.utf8))
}
func spaceJSON(_ name: String, path: String) -> SpaceView {
	let j = #"{"name":"\#(name)","path":"\#(path)","color":10,"mode":"managed","url":null,"status":"ready","error":null}"#
	return try! JSONDecoder().decode(SpaceView.self, from: Data(j.utf8))
}
func agentIn(_ id: String, session: String?, space: String) throws -> AgentView {
	let s = agentJSON(id: id, session: session.map { "\"\($0)\"" } ?? "null").replacingOccurrences(of: "\"space\":\"main\"", with: "\"space\":\"\(space)\"")
	return try decodeAgent(s)
}

@Suite("Папка сессии")
struct ProjectTests {
	let spaces = [spaceJSON("nessy", path: "/w/nessy-orch"), spaceJSON("web", path: "/w/site/")]

	@Test func dirOfTerminalWinsOverSpaces() throws {
		let agents = [try agentIn("a1", session: "s1", space: "web")]
		#expect(Projects.path(ofSession: "s1", sessionDirs: ["s1": "/Users/me/proj/"], agents: agents, spaces: spaces) == "/Users/me/proj")
	}

	@Test func spaceWithMostAgentsWins() throws {
		let agents = [try agentIn("a1", session: "s1", space: "web"), try agentIn("a2", session: "s1", space: "nessy"), try agentIn("a3", session: "s1", space: "nessy"),
					  try agentIn("a4", session: "s2", space: "web")]
		#expect(Projects.path(ofSession: "s1", sessionDirs: [:], agents: agents, spaces: spaces) == "/w/nessy-orch")
		#expect(Projects.path(ofSession: "s2", sessionDirs: [:], agents: agents, spaces: spaces) == "/w/site")
	}

	@Test func tieBreaksByName() throws {
		let agents = [try agentIn("a1", session: "s1", space: "web"), try agentIn("a2", session: "s1", space: "nessy")]
		#expect(Projects.path(ofSession: "s1", sessionDirs: [:], agents: agents, spaces: spaces) == "/w/nessy-orch")
	}

	@Test func noAgentsNoDirMeansNoFolder() {
		#expect(Projects.path(ofSession: "s9", sessionDirs: [:], agents: [], spaces: spaces) == nil)
		#expect(Projects.path(ofSession: "s9", sessionDirs: ["s9": "  "], agents: [], spaces: spaces) == nil)
	}

	@Test func normalizeAndName() {
		#expect(Projects.normalize("/a/b/") == "/a/b")
		#expect(Projects.normalize("/") == "/")
		#expect(Projects.normalize("") == nil)
		#expect(Projects.name(ofPath: "/w/nessy-orch") == "nessy-orch")
	}
}

@Suite("Запуск терминала")
struct TerminalLaunchTests {
	let url = URL(string: "http://127.0.0.1:4337")!
	let base = ["PATH": "/usr/bin:/bin", "HOME": "/Users/me", "LANG": "ru_RU.UTF-8", "SHELL": "/bin/zsh", "CLAUDECODE": "1", "CLAUDE_CODE_SSE_PORT": "5", "NESSY_ORCH_SESSION": "old", "FOO": "bar"]

	@Test func environmentForSession() {
		let e = TerminalLaunch.environment(base: base, sessionId: "s-1", orchestrator: url, home: "/Users/me")
		#expect(e["NESSY_ORCH_SESSION"] == "s-1")
		#expect(e["TERM"] == "xterm-256color")
		#expect(e["COLORTERM"] == "truecolor")
		#expect(e["LANG"] == "ru_RU.UTF-8")
		#expect(e["ORCH_PORT"] == nil)
		#expect(e["CLAUDECODE"] == nil && e["CLAUDE_CODE_SSE_PORT"] == nil)
		#expect(e["FOO"] == "bar")
		#expect(e["PATH"] == "/Users/me/.local/bin:/usr/bin:/bin")
	}

	@Test func nonDefaultPortAndLangFallback() {
		var b = base; b["LANG"] = "C"; b["PATH"] = "/Users/me/.local/bin:/usr/bin"
		let e = TerminalLaunch.environment(base: b, sessionId: nil, terminalKey: "term-1", orchestrator: URL(string: "http://127.0.0.1:4338")!, home: "/Users/me")
		#expect(e["NESSY_ORCH_TERMINAL"] == "term-1", "хуки привязывают сессию чата к терминалу по этому ключу")
		#expect(e["ORCH_PORT"] == "4338")
		#expect(e["LANG"] == "en_US.UTF-8")
		#expect(e["NESSY_ORCH_SESSION"] == nil)
		#expect(e["PATH"] == "/Users/me/.local/bin:/usr/bin")
	}

	@Test func terminalSpec() {
		let t = TerminalLaunch.terminal(directory: "/w/x", sessionId: nil, terminalKey: "term-1", orchestrator: url, base: base, home: "/Users/me")
		#expect(t.executable == "/bin/zsh" && t.args == ["-l"] && t.directory == "/w/x")
		#expect(t.env["NESSY_ORCH_TERMINAL"] == "term-1")
		#expect(t.env["NESSY_ORCH_DIR"] == "/w/x")
		#expect(t.env["ZDOTDIR"] == nil, "файлы оболочки пользователя не подменяются")
		#expect(TerminalLaunch.userShell(env: ["SHELL": "/definitely/missing"]) == "/bin/zsh")
		#expect(TerminalLaunch.userShell(env: ["SHELL": "/bin/bash"]) == "/bin/bash")
	}

	@Test func commandForChecks() {
		let t = TerminalLaunch.terminal(directory: "/w", sessionId: nil, orchestrator: url, base: base, command: "type claude", home: "/Users/me")
		#expect(t.args == ["-l", "-i", "-c", "type claude; exec '/bin/zsh' -l"])
	}

	@Test func titleDirectoryAndUrls() {
		#expect(TerminalLaunch.sessionTitle(directory: "/w/nessy-orch") == "nessy-orch")
		#expect(TerminalLaunch.isUsableDirectory("/tmp"))
		#expect(!TerminalLaunch.isUsableDirectory("/definitely/not/here"))
		let enc = "/Users/me/мой проект".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
		#expect(TerminalLaunch.directory(from: URL(string: "nessy-orch://terminal?dir=\(enc)")!) == "/Users/me/мой проект")
		#expect(TerminalLaunch.directory(from: URL(string: "nessy-orch://terminal?dir=%2FUsers%2Fme%2Fмой%20проект")!) == "/Users/me/мой проект")
		#expect(TerminalLaunch.directory(from: URL(string: "nessy-orch://terminal?dir=/a/b/")!) == "/a/b")
		#expect(TerminalLaunch.directory(from: URL(fileURLWithPath: "/Users/me/proj/")) == "/Users/me/proj")
		#expect(TerminalLaunch.directory(from: URL(string: "nessy-orch://session/x")!) == nil)
		#expect(TerminalLaunch.directory(from: URL(string: "nessy-orch://terminal")!) == nil)
	}
}

@Suite("Хуки Claude и состояние")
struct HooksTests {
	@Test func quotingEscapesSingleQuotes() {
		#expect(ShellQuote.quote("a b") == "'a b'")
		#expect(ShellQuote.quote("it's") == "'it'\\''s'")
	}

	@Test func sessionClaudeStateDecodesWithFallback() throws {
		func dec(_ extra: String) throws -> SessionView {
			let j = #"{"id":"s","title":"T","owner":null,"status":"active","summary":null,"createdAt":"x","updatedAt":"x","sources":0\#(extra)}"#
			return try JSONDecoder().decode(SessionView.self, from: Data(j.utf8))
		}
		#expect(try dec("").claude == nil)
		#expect(try dec(#","claude":{"state":"working","at":"2026-10-10T10:00:00Z"}"#).claude?.state == .working)
		#expect(try dec(#","claude":{"state":"ended"}"#).claude?.state == .ended)
		#expect(try dec(#","claude":{"state":"что-то новое"}"#).claude?.state == .idle)
		#expect(try dec(#","claude":"мусор""#).claude == nil)
	}

}
