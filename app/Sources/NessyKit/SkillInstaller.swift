import Foundation

/// Глобальная установка скилла `nessy-orch` для Claude Code: копия папки скилла из приложения в личные скиллы пользователя
/// (`~/.claude/skills/nessy-orch`) или в выбранную им папку. Делается только по решению пользователя; в самих настройках Claude ничего не меняется.
public struct SkillInstaller: Sendable {
	public enum State: Equatable, Sendable {
		/// в приложении нет скилла (сборка из исходников)
		case notBundled
		case missing
		case upToDate
		/// установлена копия, отличающаяся от встроенной (старая версия)
		case outdated
	}

	/// папка скилла внутри приложения: `Resources/orch/plugin/skills/nessy-orch`
	public let source: URL?
	/// папка скиллов Claude (по умолчанию `~/.claude/skills`)
	public let root: URL
	public static let name = "nessy-orch"

	public init(source: URL?, root: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/skills")) {
		self.source = source
		self.root = root
	}

	public var destination: URL { root.appendingPathComponent(Self.name) }
	private var fm: FileManager { .default }

	public func state() -> State {
		guard let source, fm.fileExists(atPath: source.appendingPathComponent("SKILL.md").path) else { return .notBundled }
		guard fm.fileExists(atPath: destination.appendingPathComponent("SKILL.md").path) else { return .missing }
		return Self.fingerprint(source) == Self.fingerprint(destination) ? .upToDate : .outdated
	}

	public func install() throws {
		guard let source, state() != .notBundled else { throw InstallError.notBundled }
		try fm.createDirectory(at: root, withIntermediateDirectories: true)
		if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
		try fm.copyItem(at: source, to: destination)
	}

	public func uninstall() throws {
		if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
	}

	/// Относительные пути и содержимое всех файлов папки (для сравнения копий).
	static func fingerprint(_ dir: URL) -> [String: Data] {
		var out: [String: Data] = [:]
		guard let e = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.isRegularFileKey]) else { return out }
		for case let u as URL in e where (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
			out[String(u.path.dropFirst(dir.path.count))] = try? Data(contentsOf: u)
		}
		return out
	}

	public enum InstallError: Error, LocalizedError {
		case notBundled
		public var errorDescription: String? { "В приложении нет скилла (соберите через scripts/build-app.sh)." }
	}
}
