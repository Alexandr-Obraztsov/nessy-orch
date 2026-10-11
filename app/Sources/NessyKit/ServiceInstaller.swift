import Foundation

/// Служба оркестратора (launchd) из встроенной копии сервера: внутри .app лежат сервер и CLI (`Contents/Resources/orch`),
/// служба запускает сервер оттуда. Если приложение переехало, служба переустанавливается при следующем запуске.
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

	/// Служба запускает сервер из встроенной копии? nil — службы нет.
	public func serviceMatchesBundle() -> Bool? {
		guard let text = try? String(contentsOf: plist, encoding: .utf8) else { return nil }
		guard let main = daemonMain?.path else { return false }
		return text.contains(main)
	}
}
