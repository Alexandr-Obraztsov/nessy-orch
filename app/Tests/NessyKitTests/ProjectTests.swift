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
		let e = TerminalLaunch.environment(base: b, sessionId: nil, orchestrator: URL(string: "http://127.0.0.1:4338")!, home: "/Users/me")
		#expect(e["ORCH_PORT"] == "4338")
		#expect(e["LANG"] == "en_US.UTF-8")
		#expect(e["NESSY_ORCH_SESSION"] == nil)
		#expect(e["PATH"] == "/Users/me/.local/bin:/usr/bin")
	}

	@Test func zshTerminalSpec() {
		let t = TerminalLaunch.terminal(directory: "/w/x", sessionId: "s-1", orchestrator: url, base: base, home: "/Users/me")
		#expect(t.executable == "/bin/zsh" && t.args == ["-l"] && t.directory == "/w/x")
		#expect(t.env["NESSY_ORCH_SESSION"] == "s-1")
		#expect(t.env["NESSY_ORCH_DIR"] == "/w/x")
		#expect(t.env["ZDOTDIR"] == "/Users/me/.nessy-orch/zdotdir")
		#expect(t.env["NESSY_USER_ZDOTDIR"] == "/Users/me")
	}

	@Test func userZdotdirIsPreserved() {
		var b = base; b["ZDOTDIR"] = "/Users/me/.config/zsh"
		let t = TerminalLaunch.terminal(directory: "/w", sessionId: nil, orchestrator: url, base: b, home: "/Users/me")
		#expect(t.env["NESSY_USER_ZDOTDIR"] == "/Users/me/.config/zsh")
		#expect(t.env["NESSY_ORCH_SESSION"] == nil)
	}

	@Test func commandForChecks() {
		let t = TerminalLaunch.terminal(directory: "/w", sessionId: "s", orchestrator: url, base: base, command: "type claude", home: "/Users/me")
		#expect(t.args.prefix(3) == ["-l", "-i", "-c"])
		#expect(t.args[3].hasPrefix("type claude; exec env ZDOTDIR='/Users/me/.nessy-orch/zdotdir' '/bin/zsh' -l"))
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

@Suite("Интеграция оболочки")
struct ShellIntegrationTests {
	let layout = ShellIntegration.Layout(home: URL(fileURLWithPath: "/Users/me"))

	@Test func shellKinds() {
		#expect(ShellIntegration.kind(ofShell: "/bin/zsh") == .zsh)
		#expect(ShellIntegration.kind(ofShell: "/opt/homebrew/bin/bash") == .bash)
		#expect(ShellIntegration.kind(ofShell: "/opt/homebrew/bin/fish") == .other)
		#expect(ShellIntegration.userShell(env: ["SHELL": "/definitely/missing"]) == "/bin/zsh")
		#expect(ShellIntegration.userShell(env: ["SHELL": "/bin/bash"]) == "/bin/bash")
	}

	@Test func functionQuotesPathAndKeepsUserSettings() {
		let f = ShellIntegration.claudeFunction(settings: "/Users/o'neil/.nessy-orch/claude-hooks.json")
		#expect(f.contains("'/Users/o'\\''neil/.nessy-orch/claude-hooks.json'"))
		#expect(f.contains("--settings "))
		#expect(f.contains("command claude \"$@\""))
		#expect(f.contains(#"*" --settings "*|*" --settings="*)"#))
	}

	@Test func zshFilesDelegateToUserFiles() {
		#expect(ShellIntegration.zshenv().contains("$_nessy_orig/.zshenv"))
		#expect(ShellIntegration.zprofile().contains("$_nessy_orig/.zprofile"))
		let rc = ShellIntegration.zshrc(settings: "/s.json")
		#expect(rc.contains("source \"$_nessy_orig/.zshrc\""))
		#expect(rc.contains("ZDOTDIR=\"$_nessy_orig\""))
		#expect(rc.contains("claude() {"))
		// функция определяется после пользовательского .zshrc
		#expect(rc.range(of: "source \"$_nessy_orig/.zshrc\"")!.lowerBound < rc.range(of: "claude() {")!.lowerBound)
	}

	@Test func bashAndWrapper() {
		let b = ShellIntegration.bashrc(settings: "/s.json")
		#expect(b.contains("/etc/profile") && b.contains(".bash_profile") && b.contains("claude() {"))
		let w = ShellIntegration.wrapper(settings: "/s.json")
		#expect(w.hasPrefix("#!/bin/sh") && w.contains("exec claude --settings '/s.json'") && w.contains("grep -vxF"))
	}

	@Test func launchArgumentsAndEnvironment() {
		#expect(ShellIntegration.arguments(kind: .zsh, shell: "/bin/zsh", layout: layout) == ["-l"])
		#expect(ShellIntegration.arguments(kind: .bash, shell: "/bin/bash", layout: layout) == ["--rcfile", "/Users/me/.nessy-orch/bashrc", "-i"])
		#expect(ShellIntegration.arguments(kind: .other, shell: "/usr/bin/fish", layout: layout) == ["-l"])
		#expect(ShellIntegration.environment(kind: .bash, layout: layout, base: [:], home: "/Users/me").isEmpty)
		#expect(ShellIntegration.environment(kind: .other, layout: layout, base: ["PATH": "/usr/bin"], home: "/Users/me")["PATH"] == "/Users/me/.nessy-orch/bin:/usr/bin")
	}

	@Test func installWritesFilesOnce() throws {
		let home = FileManager.default.temporaryDirectory.appendingPathComponent("home-\(UUID().uuidString)")
		defer { try? FileManager.default.removeItem(at: home) }
		let l = ShellIntegration.Layout(home: home)
		try ShellIntegration.install(layout: l)
		for f in ShellIntegration.files(layout: l) { #expect(FileManager.default.fileExists(atPath: f.url.path)) }
		#expect(FileManager.default.isExecutableFile(atPath: l.wrapper.path))
		let m1 = try FileManager.default.attributesOfItem(atPath: l.bashrc.path)[.modificationDate] as? Date
		try ShellIntegration.install(layout: l)
		#expect(try FileManager.default.attributesOfItem(atPath: l.bashrc.path)[.modificationDate] as? Date == m1)
		// файлы пользователя не появляются
		#expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent(".zshrc").path))
	}
}

@Suite("Хуки Claude и состояние")
struct HooksTests {
	@Test func settingsJSONHasFourHooks() throws {
		let json = ClaudeHooks.settingsJSON(cli: "/Users/me/.local/bin/nessy-orch")
		let obj = try #require(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
		let hooks = try #require(obj["hooks"] as? [String: Any])
		#expect(Set(hooks.keys) == ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"])
		let stop = try #require(hooks["Stop"] as? [[String: Any]])
		let inner = try #require(stop[0]["hooks"] as? [[String: Any]])
		#expect(inner[0]["type"] as? String == "command")
		#expect(inner[0]["command"] as? String == "'/Users/me/.local/bin/nessy-orch' hook stop")
		#expect(json.contains("hook prompt") && json.contains("hook start") && json.contains("hook end"))
	}

	@Test func quotingEscapesSingleQuotes() {
		#expect(ClaudeHooks.shellQuote("a b") == "'a b'")
		#expect(ClaudeHooks.shellQuote("it's") == "'it'\\''s'")
		#expect(ClaudeHooks.command(cli: "/x y/nessy-orch", sub: "end") == "'/x y/nessy-orch' hook end")
	}

	@Test func writeIsIdempotent() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hooks-\(UUID().uuidString)")
		let url = dir.appendingPathComponent(".nessy-orch/claude-hooks.json")
		defer { try? FileManager.default.removeItem(at: dir) }
		try ClaudeHooks.write(cli: "/a/nessy-orch", to: url)
		let t1 = try String(contentsOf: url, encoding: .utf8)
		let m1 = try FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date
		try ClaudeHooks.write(cli: "/a/nessy-orch", to: url)
		#expect(try FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date == m1)
		try ClaudeHooks.write(cli: "/b/nessy-orch", to: url)
		#expect(try String(contentsOf: url, encoding: .utf8) != t1)
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
