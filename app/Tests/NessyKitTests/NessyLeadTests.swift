import Foundation
import Testing
@testable import NessyKit

@Suite("nessy как главный агент")
struct NessyLeadTests {
	func scratch() throws -> URL {
		let d = FileManager.default.temporaryDirectory.appendingPathComponent("nlead-\(UUID().uuidString)")
		try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
		return d
	}

	/// плагин с двумя скиллами и «приложение» с шимом
	func bundle(_ root: URL) throws -> (plugin: URL, shim: URL) {
		let plugin = root.appendingPathComponent("orch/plugin")
		for name in ["nessy-orch", "mr-review"] {
			let dir = plugin.appendingPathComponent("skills/\(name)/references")
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
			try "---\nname: \(name)\ndescription: тест\n---\n".write(to: plugin.appendingPathComponent("skills/\(name)/SKILL.md"), atomically: true, encoding: .utf8)
			try "ссылка".write(to: dir.appendingPathComponent("a.md"), atomically: true, encoding: .utf8)
		}
		let bin = root.appendingPathComponent("orch/bin")
		try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
		let shim = bin.appendingPathComponent("nessy-orch")
		try "#!/bin/sh\n".write(to: shim, atomically: true, encoding: .utf8)
		return (plugin, shim)
	}

	func json(_ url: URL) throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any] }

	@Test func installMergesHooksKeepsUserSettingsAndCopiesSkills() throws {
		let root = try scratch()
		defer { try? FileManager.default.removeItem(at: root) }
		let (plugin, shim) = try bundle(root)
		let home = root.appendingPathComponent(".nessy")
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		let user = #"{"theme":"dark","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo user-stop","name":"user"}]}],"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"true"}]}]}}"#
		try user.write(to: home.appendingPathComponent("settings.json"), atomically: true, encoding: .utf8)
		let inst = NessyLeadInstaller(pluginSource: plugin, shim: shim, home: home)
		#expect(inst.state() == .outdated || inst.state() == .missing)
		try inst.install()
		#expect(inst.state() == .upToDate)

		let s = try json(inst.settingsURL)
		#expect(s["theme"] as? String == "dark", "чужие настройки на месте")
		let hooks = s["hooks"] as! [String: Any]
		let stop = hooks["Stop"] as! [[String: Any]]
		#expect(stop.count == 2, "хук пользователя и наш")
		let ours = (stop.last?["hooks"] as! [[String: Any]])[0]
		#expect(ours["name"] as? String == "nessy-orch" && ours["timeout"] as? Int == 10_000)
		let cmd = ours["command"] as! String
		#expect(cmd.contains("NESSY_ORCH_TERMINAL") && cmd.hasSuffix(" hook stop") && cmd.contains(shim.path), "хук только в терминале приложения")
		#expect(Set(hooks.keys) == ["Stop", "PreToolUse", "SessionStart", "UserPromptSubmit", "StopFailure", "SessionEnd"])
		#expect(FileManager.default.fileExists(atPath: inst.settingsURL.appendingPathExtension("nessy-orch.bak").path), "копия исходных настроек")
		#expect(FileManager.default.fileExists(atPath: home.appendingPathComponent("skills/nessy-orch/SKILL.md").path))
		#expect(FileManager.default.fileExists(atPath: home.appendingPathComponent("skills/mr-review/references/a.md").path), "скилл копируется целиком")

		// повторная установка не плодит записи
		try inst.install()
		let again = (try json(inst.settingsURL)["hooks"] as! [String: Any])["Stop"] as! [[String: Any]]
		#expect(again.count == 2)
	}

	@Test func movedAppIsDetectedAndFixed() throws {
		let root = try scratch()
		defer { try? FileManager.default.removeItem(at: root) }
		let (plugin, shim) = try bundle(root)
		let home = root.appendingPathComponent(".nessy")
		try NessyLeadInstaller(pluginSource: plugin, shim: shim, home: home).install()
		let moved = root.appendingPathComponent("other/nessy-orch")
		try FileManager.default.createDirectory(at: moved.deletingLastPathComponent(), withIntermediateDirectories: true)
		let inst = NessyLeadInstaller(pluginSource: plugin, shim: moved, home: home)
		#expect(inst.state() == .outdated, "путь к приложению сменился")
		try inst.install()
		#expect(inst.state() == .upToDate)
	}

	@Test func uninstallRemovesOnlyOurEntries() throws {
		let root = try scratch()
		defer { try? FileManager.default.removeItem(at: root) }
		let (plugin, shim) = try bundle(root)
		let home = root.appendingPathComponent(".nessy")
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		try #"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo","name":"user"}]}]}}"#.write(to: home.appendingPathComponent("settings.json"), atomically: true, encoding: .utf8)
		let inst = NessyLeadInstaller(pluginSource: plugin, shim: shim, home: home)
		try inst.install()
		try inst.uninstall()
		let hooks = try json(inst.settingsURL)["hooks"] as! [String: Any]
		#expect(Set(hooks.keys) == ["Stop"] && (hooks["Stop"] as! [Any]).count == 1, "остался только хук пользователя")
		#expect(!FileManager.default.fileExists(atPath: home.appendingPathComponent("skills/nessy-orch").path))
		#expect(inst.state() == .missing)
	}

	@Test func brokenSettingsAreNotTouched() throws {
		let root = try scratch()
		defer { try? FileManager.default.removeItem(at: root) }
		let (plugin, shim) = try bundle(root)
		let home = root.appendingPathComponent(".nessy")
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		try "[1,2".write(to: home.appendingPathComponent("settings.json"), atomically: true, encoding: .utf8)
		let inst = NessyLeadInstaller(pluginSource: plugin, shim: shim, home: home)
		#expect(throws: Error.self) { try inst.install() }
		#expect(try String(contentsOf: inst.settingsURL, encoding: .utf8) == "[1,2", "файл пользователя не изменён")
	}

	@Test func leadKindAndTerminalEnvironment() {
		#expect(LeadCommand.kind(of: "claude --model opus") == "claude")
		#expect(LeadCommand.kind(of: "/Users/me/.local/bin/nessy") == "nessy")
		#expect(LeadCommand.kind(of: "aider") == "other")
		let url = URL(string: "http://127.0.0.1:4337")!
		let t = TerminalLaunch.terminal(directory: "/w", sessionId: nil, terminalKey: "k", orchestrator: url, base: ["SHELL": "/bin/zsh", "NESSY_ORCH_LEAD": "старый"], lead: "nessy --resume 'a'", home: "/Users/me")
		#expect(t.env["NESSY_ORCH_LEAD"] == "nessy")
	}
}
