import Foundation

/// Служба оркестратора (launchd): внутри .app лежат сервер и CLI (`Contents/Resources/orch`). Служба запускается не из конкретной копии .app, а
/// из рабочей копии `~/.nessy-orch/runtime`, которую `nessy-orch install --ensure` обновляет только вперёд (по `VERSION`): запуск другой копии
/// приложения службу не перетягивает и не перезапускает.
public struct ServiceInstaller: Sendable {
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
	public var isBundled: Bool { script.map { FileManager.default.fileExists(atPath: $0.path) } ?? false }
	public var plist: URL { home.appendingPathComponent("Library/LaunchAgents/\(Self.launchLabel).plist") }
}
