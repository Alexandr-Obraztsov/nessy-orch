import Foundation

/// Установка командной строки `nessy-orch` из самого приложения: внутри .app лежит сервер и CLI (Resources/orch),
/// при запуске приложение кладёт ссылку `~/.local/bin/nessy-orch` на встроенный скрипт — больше ничего ставить не нужно
/// (кроме Node.js, он уже есть у разработчиков). Если приложение переехало, ссылка и служба launchd чинятся при следующем запуске.
public struct CLIInstaller: Sendable {
	public enum State: Equatable, Sendable {
		/// в приложении нет встроенного CLI (сборка из исходников без упаковки)
		case notBundled
		/// ссылки нет
		case missing
		/// ссылка ведёт на встроенный скрипт
		case installed
		/// ссылка ведёт куда-то ещё (старый путь приложения или клон репозитория)
		case stale(String)
		/// на месте ссылки лежит обычный файл — не трогаем
		case conflict
	}

	/// `Contents/Resources/orch` внутри приложения (nil — не упаковано)
	public let bundleRoot: URL?
	public let home: URL

	public init(bundleRoot: URL?, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
		self.bundleRoot = bundleRoot
		self.home = home
	}

	public static let launchLabel = "com.nessy.orch"

	public var script: URL? { bundleRoot?.appendingPathComponent("bin/nessy-orch") }
	public var daemonMain: URL? { bundleRoot?.appendingPathComponent("dist/src/main.js") }
	public var linkDirectory: URL { home.appendingPathComponent(".local/bin") }
	public var link: URL { linkDirectory.appendingPathComponent("nessy-orch") }
	public var plist: URL { home.appendingPathComponent("Library/LaunchAgents/\(Self.launchLabel).plist") }

	private var fm: FileManager { .default }

	public func state() -> State {
		guard let script, fm.fileExists(atPath: script.path) else { return .notBundled }
		guard let attrs = try? fm.attributesOfItem(atPath: link.path) else { return .missing }
		guard attrs[.type] as? FileAttributeType == .typeSymbolicLink else { return .conflict }
		let dest = (try? fm.destinationOfSymbolicLink(atPath: link.path)) ?? ""
		return dest == script.path ? .installed : .stale(dest)
	}

	/// Создать (или обновить) ссылку. Обычный файл на этом месте не перезаписывается.
	public func install() throws {
		guard let script, fm.fileExists(atPath: script.path) else { throw InstallError.notBundled }
		switch state() {
		case .conflict: throw InstallError.conflict(link.path)
		case .installed: return
		case .stale: try fm.removeItem(at: link)
		default: break
		}
		try fm.createDirectory(at: linkDirectory, withIntermediateDirectories: true)
		try fm.createSymbolicLink(at: link, withDestinationURL: script)
	}

	public func uninstall() throws {
		if case .installed = state() { try fm.removeItem(at: link) }
	}

	/// Служба launchd запускает сервер из встроенной копии? nil — службы нет.
	public func serviceMatchesBundle() -> Bool? {
		guard let text = try? String(contentsOf: plist, encoding: .utf8) else { return nil }
		guard let main = daemonMain?.path else { return false }
		return text.contains(main)
	}

	public enum InstallError: Error, LocalizedError, Equatable {
		case notBundled
		case conflict(String)
		public var errorDescription: String? {
			switch self {
			case .notBundled: "В приложении нет встроенной командной строки (соберите через scripts/build-app.sh)."
			case .conflict(let p): "По пути \(p) уже лежит обычный файл — удалите его или переименуйте."
			}
		}
	}
}
