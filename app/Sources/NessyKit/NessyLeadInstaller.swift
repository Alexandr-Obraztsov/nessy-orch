import Foundation

/// Подключение nessy как главного агента: хуки сессий в `~/.nessy/settings.json` и скиллы оркестратора в `~/.nessy/skills`.
/// У nessy нет «плагина с хуками и CLI», как у Claude Code: расширения не умеют ни хуки, ни PATH, поэтому приложение пишет две вещи:
///  1. в `hooks` пользовательских настроек — свои записи (имя `nessy-orch`), остальные настройки и чужие хуки не трогаются;
///  2. скиллы плагина (`skills/*/SKILL.md` + references) копируются в `~/.nessy/skills/<имя>`.
/// CLI `nessy-orch` доступен в оболочке агента сам: приложение кладёт `Resources/orch/bin` в PATH терминала. Хуки действуют только
/// в терминале приложения (`NESSY_ORCH_TERMINAL`), а запись настроек идемпотентна и обновляется при каждом запуске (путь к приложению мог смениться).
public struct NessyLeadInstaller: Sendable {
	public enum State: Equatable, Sendable {
		case notBundled
		case missing
		case upToDate
		case outdated
	}

	/// имя нашей записи в `hooks[].hooks[].name` — по нему находим и обновляем только своё
	public static let hookName = "nessy-orch"
	/// событие nessy → аргумент `nessy-orch hook` и таймаут (мс; в nessy таймаут хука задаётся в миллисекундах)
	static let events: [(event: String, arg: String, timeout: Int)] = [
		("SessionStart", "start", 10_000),
		("UserPromptSubmit", "prompt", 10_000),
		("Stop", "stop", 10_000),
		("StopFailure", "stop-failure", 5_000),
		("SessionEnd", "end", 2_000),
	]

	/// `Resources/orch/plugin` (откуда берутся скиллы)
	public let pluginSource: URL?
	/// `Resources/orch/bin/nessy-orch` — команда в хуках
	public let shim: URL?
	/// `~/.nessy` (или `$NESSY_HOME`)
	public let home: URL

	public init(pluginSource: URL?, shim: URL?, home: URL? = nil, env: [String: String] = ProcessInfo.processInfo.environment) {
		self.pluginSource = pluginSource
		self.shim = shim
		self.home = home ?? env["NESSY_HOME"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nessy")
	}

	private var fm: FileManager { .default }
	public var settingsURL: URL { home.appendingPathComponent("settings.json") }
	public var skillsDir: URL { home.appendingPathComponent("skills") }

	/// Строка хука: действует только в терминале приложения.
	func command(_ arg: String) -> String? {
		guard let shim else { return nil }
		return "[ -z \"${NESSY_ORCH_TERMINAL}${NESSY_ORCH_SESSION}\" ] || \(ShellQuote.quote(shim.path)) hook \(arg)"
	}

	/// Скиллы плагина: имена папок, где есть SKILL.md.
	func bundledSkills() -> [String] {
		guard let dir = pluginSource?.appendingPathComponent("skills"),
			let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return [] }
		return names.filter { fm.fileExists(atPath: dir.appendingPathComponent($0).appendingPathComponent("SKILL.md").path) }.sorted()
	}

	private func readSettings() throws -> [String: Any] {
		guard fm.fileExists(atPath: settingsURL.path) else { return [:] }
		let data = try Data(contentsOf: settingsURL)
		if data.isEmpty { return [:] }
		guard let j = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw InstallError.badSettings }
		return j
	}

	/// Есть ли в группе хуков наша запись.
	private func isOurs(_ group: Any) -> Bool {
		guard let g = group as? [String: Any], let hooks = g["hooks"] as? [[String: Any]] else { return false }
		return hooks.contains { ($0["name"] as? String) == Self.hookName }
	}

	public func state() -> State {
		guard pluginSource != nil, shim != nil else { return .notBundled }
		let settings = (try? readSettings()) ?? [:]
		let hooks = settings["hooks"] as? [String: Any] ?? [:]
		var present = 0
		for e in Self.events {
			guard let groups = hooks[e.event] as? [Any], let ours = groups.first(where: isOurs) as? [String: Any],
				let list = ours["hooks"] as? [[String: Any]], let h = list.first(where: { ($0["name"] as? String) == Self.hookName }) else { continue }
			if (h["command"] as? String) == command(e.arg), (h["timeout"] as? Int) == e.timeout { present += 1 }
		}
		let skills = bundledSkills()
		let skillsOK = !skills.isEmpty && skills.allSatisfy { name in
			let a = pluginSource?.appendingPathComponent("skills/\(name)/SKILL.md")
			let b = skillsDir.appendingPathComponent("\(name)/SKILL.md")
			guard let a, let da = try? Data(contentsOf: a), let db = try? Data(contentsOf: b) else { return false }
			return da == db
		}
		if present == 0, !skills.contains(where: { fm.fileExists(atPath: skillsDir.appendingPathComponent($0).path) }) { return .missing }
		return present == Self.events.count && skillsOK ? .upToDate : .outdated
	}

	public func install() throws {
		guard let pluginSource, shim != nil else { throw InstallError.notBundled }
		var settings = try readSettings()
		// копия исходных настроек — один раз, перед первым изменением
		if fm.fileExists(atPath: settingsURL.path) {
			let backup = settingsURL.appendingPathExtension("nessy-orch.bak")
			if !fm.fileExists(atPath: backup.path) { try? fm.copyItem(at: settingsURL, to: backup) }
		}
		var hooks = settings["hooks"] as? [String: Any] ?? [:]
		for e in Self.events {
			guard let cmd = command(e.arg) else { continue }
			var groups = (hooks[e.event] as? [Any] ?? []).filter { !isOurs($0) }
			groups.append(["hooks": [["type": "command", "name": Self.hookName, "command": cmd, "timeout": e.timeout]]])
			hooks[e.event] = groups
		}
		settings["hooks"] = hooks
		try write(settings)
		try fm.createDirectory(at: skillsDir, withIntermediateDirectories: true)
		for name in bundledSkills() {
			let dest = skillsDir.appendingPathComponent(name)
			if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
			try fm.copyItem(at: pluginSource.appendingPathComponent("skills/\(name)"), to: dest)
		}
	}

	public func uninstall() throws {
		var settings = try readSettings()
		if var hooks = settings["hooks"] as? [String: Any] {
			for (event, value) in hooks {
				let kept = (value as? [Any] ?? []).filter { !isOurs($0) }
				if kept.isEmpty { hooks[event] = nil } else { hooks[event] = kept }
			}
			settings["hooks"] = hooks.isEmpty ? nil : hooks
			try write(settings)
		}
		for name in bundledSkills() { try? fm.removeItem(at: skillsDir.appendingPathComponent(name)) }
	}

	private func write(_ settings: [String: Any]) throws {
		try fm.createDirectory(at: home, withIntermediateDirectories: true)
		let data = try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
		let tmp = settingsURL.appendingPathExtension("tmp")
		try data.write(to: tmp, options: .atomic)
		_ = try fm.replaceItemAt(settingsURL, withItemAt: tmp)
	}

	public enum InstallError: Error, LocalizedError {
		case notBundled
		case badSettings
		public var errorDescription: String? {
			switch self {
			case .notBundled: "В приложении нет плагина nessy (соберите через scripts/build-app.sh)."
			case .badSettings: "~/.nessy/settings.json не похож на JSON-объект: не трогаю его, поправьте файл вручную."
			}
		}
	}
}
