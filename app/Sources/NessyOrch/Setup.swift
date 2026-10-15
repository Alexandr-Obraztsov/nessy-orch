import SwiftUI
import NessyKit

/// Установка — только плагин nessy: при запуске приложение копирует его (скилл `nessy-orch`, CLI `nessy-orch` в `bin/`, хук Stop) в
/// `~/.claude/skills/nessy`, и Claude Code подхватывает его при любом запуске `claude` (в том числе после закрытия и повторного открытия).
/// Копия обновляется, когда версия плагина в приложении другая. Служба оркестратора («хост») поднимается молча, как раньше.
@MainActor
@Observable
final class SetupModel {
	let service = ServiceInstaller(bundleRoot: Bundle.main.resourceURL?.appendingPathComponent("orch"))
	/// плагин внутри приложения → `~/.claude/skills/nessy`
	var plugin: PluginInstaller { PluginInstaller(source: Bundle.main.resourceURL?.appendingPathComponent("orch/plugin")) }
	private(set) var revision = 0

	var autoPlugin: Bool { UserDefaults.standard.object(forKey: "autoPlugin") as? Bool ?? true }
	var autoService: Bool { UserDefaults.standard.object(forKey: "autoInstallService") as? Bool ?? true }

	/// Запуск приложения: плагин (нет или другая версия) и служба (нет, старый путь или не отвечает) — молча.
	func launch(daemonOnline: @escaping @MainActor () async -> Bool) {
		if autoPlugin { installPluginIfNeeded() }
		cleanupLegacy()
		guard autoService, service.isBundled else { return }
		Task {
			try? await Task.sleep(for: .seconds(2.5)) // дать подключиться к уже работающему оркестратору
			let match = service.serviceMatchesBundle()
			let online = match == nil ? await daemonOnline() : true
			if match == false || (match == nil && !online) { await installService() }
		}
		watchService()
	}

	private var watching = false
	private var offlineSince: Date?
	private var lastRestart: Date?
	private var failures = 0

	/// Следит за службой: оркестратор недоступен дольше нескольких секунд — перезапускаем её сами (launchd kickstart, а если службы нет,
	/// ставим заново). Повторные неудачи пробуем реже, после третьей говорим об этом пользователю.
	private func watchService() {
		guard !watching, autoService, service.isBundled else { return }
		watching = true
		Task { @MainActor in
			let dog = ServiceWatchdog()
			while !Task.isCancelled {
				try? await Task.sleep(for: .seconds(2))
				guard autoService else { continue }
				var offline = false
				if case .offline = AppModel.shared.store.daemon { offline = true }
				if !offline {
					offlineSince = nil
					failures = 0
					continue
				}
				let now = Date()
				if offlineSince == nil { offlineSince = now }
				let action = dog.decide(offlineFor: now.timeIntervalSince(offlineSince ?? now), sinceRestart: lastRestart.map { now.timeIntervalSince($0) }, failures: failures)
				guard action == .restart else { continue }
				lastRestart = now
				let ok = await restartService()
				if !ok {
					failures += 1
					if dog.shouldReport(failures: failures) { AppModel.shared.flash("Служба оркестратора не поднимается. Проверьте, что установлен Node.js", error: true) }
				}
				try? await Task.sleep(for: .seconds(3))
				await AppModel.shared.store.refreshStatus()
			}
		}
	}

	/// Перезапуск службы: `launchctl kickstart -k` (если она загружена), иначе установка заново из встроенной копии.
	@discardableResult
	func restartService() async -> Bool {
		let label = ServiceInstaller.launchLabel
		let r = await Shell.run("launchctl kickstart -k gui/$(id -u)/\(label)", timeout: 20)
		if r.status == 0 { return true }
		return await installService()
	}

	private func installPluginIfNeeded() {
		switch plugin.state() {
		case .missing, .outdated: installPlugin()
		case .upToDate, .notBundled: break
		}
	}

	/// nessy как главный агент больше не поддерживается: убираем хуки и скиллы, которые приложение когда-то записало в `~/.nessy`.
	private func cleanupLegacy() {
		let c = LegacyCleanup()
		guard c.needed() else { return }
		do { _ = try c.run() } catch { AppModel.shared.flash("Не удалось убрать старые хуки nessy: \(error.localizedDescription)", error: true) }
	}

	func installPlugin() {
		do { try plugin.install() } catch { AppModel.shared.flash("Плагин не установлен: \(error.localizedDescription)", error: true) }
		revision += 1
	}

	func removePlugin() {
		try? plugin.uninstall()
		revision += 1
	}

	/// Статус для настроек.
	var pluginStatus: String {
		_ = revision
		let p = plugin
		let place = (p.destination?.path ?? "~/.claude/skills/nessy").replacingOccurrences(of: NSHomeDirectory(), with: "~")
		switch p.state() {
		case .upToDate: return "Установлен: \(place) · версия \(p.bundled?.version ?? "?")"
		case .missing: return "Не установлен (\(place))"
		case .outdated(let v): return "Установлена версия \(v ?? "?"), в приложении \(p.bundled?.version ?? "?")"
		case .notBundled: return "В этой сборке нет плагина (запуск из исходников)"
		}
	}

	/// Служба launchd из встроенной копии сервера: `node <orch>/bin/nessy-orch install` (пишет plist и запускает).
	@discardableResult
	func installService() async -> Bool {
		guard let script = service.script?.path else { return false }
		guard let node = await Shell.run("command -v node").output.split(separator: "\n").last.map(String.init), node.hasPrefix("/") else { return false }
		return await Shell.run("exec \(ShellQuote.quote(node)) \(ShellQuote.quote(script)) install", timeout: 60).status == 0
	}
}

/// Команда в login-оболочке пользователя (там же, где живут PATH и node), с ограничением по времени.
enum Shell {
	struct Result: Sendable { var status: Int32; var output: String }

	static func run(_ command: String, timeout: Double = 20) async -> Result {
		await Task.detached {
			let p = Process()
			p.executableURL = URL(fileURLWithPath: "/bin/zsh")
			p.arguments = ["-lc", command]
			let pipe = Pipe()
			p.standardOutput = pipe
			p.standardError = pipe
			do { try p.run() } catch { return Result(status: -1, output: error.localizedDescription) }
			let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
			DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
			let data = pipe.fileHandleForReading.readDataToEndOfFile()
			p.waitUntilExit()
			killer.cancel()
			return Result(status: p.terminationStatus, output: String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
		}.value
	}
}

/// Блок настроек «Плагин Claude»: статус, автоподключение, переустановка и удаление.
struct InstallSettingsSection: View {
	@Environment(AppModel.self) private var model
	@AppStorage("autoPlugin") private var autoPlugin = true

	var body: some View {
		let setup = model.setup
		Section {
			LabeledContent("Плагин nessy") { Text(setup.pluginStatus).foregroundStyle(.secondary).multilineTextAlignment(.trailing) }
			Toggle("Подключать к Claude Code автоматически", isOn: $autoPlugin)
			HStack {
				Button(setup.plugin.state() == .upToDate ? "Переустановить" : "Установить") { setup.installPlugin() }
				Button("Удалить") { setup.removePlugin() }.disabled(setup.plugin.state() == .missing)
			}
		} header: {
			Text("Claude Code")
		} footer: {
			Text("Плагин (скилл nessy-orch, команда nessy-orch и хуки сессий) лежит в ~/.claude/skills/nessy и обновляется вместе с приложением. Работает в любом запуске claude.")
				.foregroundStyle(DS.Palette.textSecondary)
		}
	}
}
