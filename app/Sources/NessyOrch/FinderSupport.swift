import AppKit
import NessyKit

/// Finder: быстрое действие «Открыть в TClaude-Orch» (пакет службы в ~/Library/Services) и общая логика «папка для объекта».
enum FinderSupport {
	static let bundleId = Bundle.main.bundleIdentifier ?? "com.nessy.orch.app"

	/// Папка объекта: сам каталог или каталог, где лежит файл.
	static func directory(of url: URL) -> String {
		var isDir: ObjCBool = false
		FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
		return (isDir.boolValue ? url : url.deletingLastPathComponent()).path
	}

	/// Первый запуск: ставим быстрое действие (отказаться можно в настройках — флаг не сбрасывается).
	static func autoInstallOnce() {
		let d = UserDefaults.standard
		guard !d.bool(forKey: "finder.autoInstalled") else { return }
		d.set(true, forKey: "finder.autoInstalled")
		_ = setEnabled(true)
	}

	static var isEnabled: Bool { FinderAction.isInstalled() }

	@discardableResult
	static func setEnabled(_ on: Bool) -> Bool {
		do {
			if on { try FinderAction.install(bundleId: bundleId) } else { try FinderAction.uninstall() }
			// системе нужно перечитать службы
			let t = Process()
			t.executableURL = URL(fileURLWithPath: "/System/Library/CoreServices/pbs")
			t.arguments = ["-update"]
			try? t.run()
			return true
		} catch { return false }
	}
}
