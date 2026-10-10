import SwiftUI
import NessyKit

/// Командная строка и служба оркестратора, встроенные в приложение: при запуске приложение само кладёт `nessy-orch` в `~/.local/bin`
/// и, если оркестратор не запущен, ставит службу launchd из встроенной копии — «запустил приложение, и всё доступно».
@MainActor
@Observable
final class CLISupport {
	static let shared = CLISupport()

	let installer = CLIInstaller(bundleRoot: Bundle.main.resourceURL?.appendingPathComponent("orch"))
	private(set) var state: CLIInstaller.State
	private(set) var nodePath: String?
	private(set) var busy = false
	private(set) var lastError: String?

	init() {
		state = installer.state()
		// путь к node ищет login-оболочка: синхронно её запускать нельзя (внутри ждёт run loop — другие окна заходят в `shared` повторно)
		findNodeAsync()
	}

	func refresh() {
		state = installer.state()
		findNodeAsync()
	}

	private func findNodeAsync() {
		Task { @MainActor in
			let p = await Task.detached { Self.findNode() }.value
			self.nodePath = p
		}
	}

	var linkPath: String { installer.link.path }
	var isBundled: Bool { if case .notBundled = state { false } else { true } }

	/// Ссылка `~/.local/bin/nessy-orch` на встроенный скрипт (чужой обычный файл не трогаем).
	@discardableResult
	func installLink() -> Bool {
		do {
			try installer.install()
			lastError = nil
		} catch {
			lastError = error.localizedDescription
		}
		refresh()
		if case .installed = state { return true }
		return false
	}

	/// Служба launchd из встроенной копии сервера: `node <orch>/bin/nessy-orch install` (пишет plist и запускает).
	@discardableResult
	func installService() async -> Bool {
		guard let script = installer.script?.path else { return false }
		guard let node = nodePath else {
			lastError = "Не найден Node.js (нужен ≥ 20): установите его, например `brew install node`."
			return false
		}
		busy = true
		defer { busy = false }
		let ok = await Self.run("exec '\(node)' '\(script)' install")
		lastError = ok ? nil : "Не удалось установить службу оркестратора (см. логи в ~/.nessy-orch/logs)."
		return ok
	}

	/// Автонастройка при запуске: ссылка на CLI; служба — если её нет, она смотрит на старый путь или оркестратор не отвечает.
	func autoSetup(daemonOnline: @escaping @MainActor () async -> Bool) {
		guard isBundled else { return }
		switch state {
		case .missing, .stale: installLink()
		default: break
		}
		guard UserDefaults.standard.object(forKey: "autoInstallService") as? Bool ?? true else { return }
		Task {
			try? await Task.sleep(for: .seconds(2.5)) // дать подключиться к уже работающему оркестратору
			let mismatch = installer.serviceMatchesBundle() == false
			let missing = installer.serviceMatchesBundle() == nil
			let online = missing ? await daemonOnline() : true
			if mismatch || (missing && !online) { await installService() }
		}
	}

	/// Node.js из login-оболочки (как у службы launchd): `command -v node`.
	nonisolated private static func findNode() -> String? {
		let p = Process()
		p.executableURL = URL(fileURLWithPath: "/bin/zsh")
		p.arguments = ["-lc", "command -v node"]
		let pipe = Pipe()
		p.standardOutput = pipe
		p.standardError = FileHandle.nullDevice
		do { try p.run() } catch { return nil }
		p.waitUntilExit()
		let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return out.hasPrefix("/") ? out.components(separatedBy: "\n").last : nil
	}

	private static func run(_ command: String) async -> Bool {
		await Task.detached {
			let p = Process()
			p.executableURL = URL(fileURLWithPath: "/bin/zsh")
			p.arguments = ["-lc", command]
			p.standardOutput = FileHandle.nullDevice
			p.standardError = FileHandle.nullDevice
			do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
		}.value
	}
}

/// Блок настроек «Командная строка».
struct CLISettingsSection: View {
	@Environment(AppModel.self) private var model
	var cli = CLISupport.shared
	@AppStorage("autoInstallService") private var autoService = true

	var body: some View {
		Section("Командная строка") {
			LabeledContent("nessy-orch") {
				Text(statusText).foregroundStyle(statusColor)
			}
			if cli.isBundled {
				Text(cli.linkPath).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
				HStack {
					Button(cli.state == .installed ? "Переустановить" : "Установить") { cli.installLink(); if let e = cli.lastError { model.flash(e, error: true) } }
					Button("Установить службу оркестратора") { Task { if await cli.installService() { await model.store.refreshStatus() } else if let e = cli.lastError { model.flash(e, error: true) } } }
						.disabled(cli.busy)
				}
				Toggle("Ставить службу автоматически, если оркестратор не запущен", isOn: $autoService)
				if cli.nodePath == nil { Label("Node.js не найден — нужен для CLI и службы", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.secondary) }
			} else {
				Text("Это сборка без встроенной командной строки: используйте bin/nessy-orch из репозитория.").font(.caption).foregroundStyle(.secondary)
			}
		}
	}

	private var statusText: String {
		switch cli.state {
		case .installed: "установлена"
		case .missing: "не установлена"
		case .stale: "ссылка ведёт на другое место"
		case .conflict: "по этому пути лежит чужой файл"
		case .notBundled: "не встроена"
		}
	}
	private var statusColor: Color {
		switch cli.state { case .installed: .secondary; case .conflict, .stale, .missing: DS.Palette.danger; case .notBundled: .secondary }
	}
}
