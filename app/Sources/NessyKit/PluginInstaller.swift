import Foundation

/// Глобальная установка плагина nessy в Claude Code: копия плагина из приложения кладётся в `~/.claude/skills/<имя плагина>/`.
/// Claude Code сам подхватывает такую папку как плагин (`<имя>@skills-dir`, включён по умолчанию), читает его на месте и не копирует,
/// поэтому ни маркетплейс, ни `claude plugin install` не нужны. В плагине: скилл `nessy-orch`, команда и CLI `nessy-orch` (`bin/`
/// попадает в PATH инструмента Bash). Обновление — перезапись папки; приложение делает его при смене версии плагина.
public struct PluginInstaller: Sendable {
	public enum State: Equatable, Sendable {
		/// в приложении нет плагина (сборка из исходников)
		case notBundled
		case missing
		case upToDate
		/// установлена другая версия (или копия повреждена)
		case outdated(installed: String?)
	}

	/// папка плагина внутри приложения: `Resources/orch/plugin`
	public let source: URL?
	/// папка скиллов Claude (по умолчанию `~/.claude/skills`)
	public let root: URL

	public init(source: URL?, root: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/skills")) {
		self.source = source
		self.root = root
	}

	private var fm: FileManager { .default }

	static func manifest(_ dir: URL) -> (name: String, version: String)? {
		let url = dir.appendingPathComponent(".claude-plugin/plugin.json")
		guard let data = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let name = j["name"] as? String else { return nil }
		return (name, j["version"] as? String ?? "")
	}

	/// Имя и версия встроенного плагина.
	public var bundled: (name: String, version: String)? { source.flatMap(Self.manifest) }
	public var destination: URL? { bundled.map { root.appendingPathComponent($0.name) } }

	public func state() -> State {
		guard let b = bundled, let dest = destination else { return .notBundled }
		guard let installed = Self.manifest(dest) else { return fm.fileExists(atPath: dest.path) ? .outdated(installed: nil) : .missing }
		// версия та же и на месте всё, что нужно для работы (CLI и скилл)
		let complete = fm.isExecutableFile(atPath: dest.appendingPathComponent("bin/nessy-orch").path) && fm.fileExists(atPath: dest.appendingPathComponent("skills/nessy-orch/SKILL.md").path)
		// копия новее встроенной (запущена старая копия приложения) — не откатываем: другая копия уже обновила плагин
		return BuildVersion.compare(installed.version, b.version) >= 0 && complete ? .upToDate : .outdated(installed: installed.version)
	}

	public func install() throws {
		guard let source, let dest = destination else { throw InstallError.notBundled }
		try fm.createDirectory(at: root, withIntermediateDirectories: true)
		if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
		try fm.copyItem(at: source, to: dest)
	}

	public func uninstall() throws {
		if let dest = destination, fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
	}

	public enum InstallError: Error, LocalizedError {
		case notBundled
		public var errorDescription: String? { "В приложении нет плагина nessy (соберите через scripts/build-app.sh)." }
	}
}

/// Строка в одинарных кавычках для оболочки; внутренние `'` экранируются.
public enum ShellQuote {
	public static func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
}
