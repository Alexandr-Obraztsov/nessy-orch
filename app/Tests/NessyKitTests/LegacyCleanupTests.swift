import Foundation
import Testing
@testable import NessyKit

struct LegacyCleanupTests {
	func home() throws -> URL {
		let h = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-\(UUID().uuidString)")
		try FileManager.default.createDirectory(at: h.appendingPathComponent("skills"), withIntermediateDirectories: true)
		return h
	}

	@Test func removesOurHooksAndSkillsKeepsForeign() throws {
		let h = try home()
		defer { try? FileManager.default.removeItem(at: h) }
		let settings: [String: Any] = [
			"theme": "dark",
			"hooks": [
				"Stop": [["hooks": [["type": "command", "name": "nessy-orch", "command": "x hook stop"]]], ["hooks": [["type": "command", "name": "mine", "command": "echo"]]]],
				"SessionStart": [["hooks": [["type": "command", "name": "nessy-orch", "command": "x hook start"]]]],
			],
		]
		try JSONSerialization.data(withJSONObject: settings).write(to: h.appendingPathComponent("settings.json"))
		for (name, text) in [("nessy-orch", "nessy-orch скилл"), ("implement", "мой собственный скилл")] {
			let d = h.appendingPathComponent("skills/\(name)")
			try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
			try text.write(to: d.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
		}
		let c = LegacyCleanup(home: h)
		#expect(c.needed())
		let done = try c.run()
		#expect(done.count == 2)
		let out = try JSONSerialization.jsonObject(with: Data(contentsOf: h.appendingPathComponent("settings.json"))) as! [String: Any]
		#expect(out["theme"] as? String == "dark")
		let hooks = out["hooks"] as! [String: Any]
		#expect(hooks["SessionStart"] == nil, "пустое событие убрано")
		#expect((hooks["Stop"] as! [Any]).count == 1, "чужой хук остался")
		#expect(!FileManager.default.fileExists(atPath: h.appendingPathComponent("skills/nessy-orch").path))
		#expect(FileManager.default.fileExists(atPath: h.appendingPathComponent("skills/implement/SKILL.md").path), "чужой одноимённый скилл не тронут")
		#expect(!c.needed())
	}

	@Test func nothingToDoOnCleanHome() throws {
		let h = try home()
		defer { try? FileManager.default.removeItem(at: h) }
		#expect(!LegacyCleanup(home: h).needed())
		#expect(try LegacyCleanup(home: h).run().isEmpty)
	}
}
