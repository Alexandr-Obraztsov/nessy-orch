import Foundation

/// Уборка следов прежних версий: nessy как главный агент больше не поддерживается. Приложение один раз при запуске удаляет свои хуки
/// из `~/.nessy/settings.json` (запись с именем `nessy-orch`; чужие хуки и настройки не трогаются) и скиллы, которые когда-то копировало
/// в `~/.nessy/skills`. Скилл удаляется, только если это наш (в SKILL.md упомянут `nessy-orch`): одноимённые чужие остаются.
public struct LegacyCleanup: Sendable {
	public static let hookName = "nessy-orch"
	/// скиллы плагина nessy прежних версий
	static let skillNames = ["nessy-orch", "code-question", "implement", "incident", "jira-report", "mr-review"]

	public let home: URL

	public init(home: URL? = nil, env: [String: String] = ProcessInfo.processInfo.environment) {
		self.home = home ?? env["NESSY_HOME"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nessy")
	}

	private var fm: FileManager { .default }
	var settingsURL: URL { home.appendingPathComponent("settings.json") }
	var skillsDir: URL { home.appendingPathComponent("skills") }

	private func isOurs(_ group: Any) -> Bool {
		guard let g = group as? [String: Any], let hooks = g["hooks"] as? [[String: Any]] else { return false }
		return hooks.contains { ($0["name"] as? String) == Self.hookName }
	}

	/// Есть ли что убирать.
	public func needed() -> Bool {
		if let data = try? Data(contentsOf: settingsURL), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let hooks = j["hooks"] as? [String: Any], hooks.values.contains(where: { (($0 as? [Any]) ?? []).contains(where: isOurs) }) { return true }
		return Self.skillNames.contains { isOurSkill(skillsDir.appendingPathComponent($0)) }
	}

	private func isOurSkill(_ dir: URL) -> Bool {
		guard let text = try? String(contentsOf: dir.appendingPathComponent("SKILL.md"), encoding: .utf8) else { return false }
		return text.contains("nessy-orch")
	}

	/// Удалить хуки и скиллы прежних версий. Возвращает, что сделано (для журнала); ошибка записи настроек не скрывается.
	@discardableResult
	public func run() throws -> [String] {
		var done: [String] = []
		if let data = try? Data(contentsOf: settingsURL), !data.isEmpty, var settings = try JSONSerialization.jsonObject(with: data) as? [String: Any],
			var hooks = settings["hooks"] as? [String: Any] {
			var changed = false
			for (event, value) in hooks {
				let groups = value as? [Any] ?? []
				let kept = groups.filter { !isOurs($0) }
				guard kept.count != groups.count else { continue }
				changed = true
				if kept.isEmpty { hooks[event] = nil } else { hooks[event] = kept }
			}
			if changed {
				settings["hooks"] = hooks.isEmpty ? nil : hooks
				let out = try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
				let tmp = settingsURL.appendingPathExtension("tmp")
				try out.write(to: tmp, options: .atomic)
				_ = try fm.replaceItemAt(settingsURL, withItemAt: tmp)
				done.append("хуки в \(settingsURL.path)")
			}
		}
		for name in Self.skillNames {
			let dir = skillsDir.appendingPathComponent(name)
			if isOurSkill(dir) { try fm.removeItem(at: dir); done.append("скилл \(name)") }
		}
		return done
	}
}
