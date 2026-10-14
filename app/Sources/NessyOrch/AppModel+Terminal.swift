import SwiftUI
import AppKit
import NessyKit

/// Терминалы: запуск оболочки пользователя в папке окна, прозрачные хуки Claude, выбор папки (layout-v2.md).
extension AppModel {
	// MARK: папки

	/// Папка сессии — по её агентам (пространство с наибольшим числом агентов).
	func projectPath(of session: String) -> String? {
		Projects.path(ofSession: session, sessionDirs: [:], agents: store.allAgents, spaces: store.spaces)
	}

	/// Системный выбор папки; новое окно-терминал в ней. Панель по центру экрана, стартует с последней выбранной папки.
	func chooseProject(title: String, message: String) {
		NSApp.activate()
		let p = NSOpenPanel()
		p.canChooseDirectories = true
		p.canChooseFiles = false
		p.allowsMultipleSelection = false
		p.canCreateDirectories = true
		p.title = title
		p.message = message
		p.prompt = "Открыть"
		let last = UserDefaults.standard.string(forKey: "lastProjectDir")
		p.directoryURL = URL(fileURLWithPath: activeWindow?.dir ?? UserDefaults.standard.string(forKey: "projectsDirectory") ?? last ?? NSHomeDirectory())
		p.center()
		guard p.runModal() == .OK, let u = p.url else { return }
		UserDefaults.standard.set(u.path, forKey: "lastProjectDir")
		openTerminal(dir: u.path)
	}

	/// ⌘N: ещё один терминал в той же папке, что у проекта на экране (нет проекта — выбор папки).
	func newWindowHere() {
		if let d = activeWindow?.dir, !d.isEmpty { openTerminal(dir: d, forceNew: true) } else { openFolderPanel() }
	}

	/// ⇧⌘O: ещё одно окно в выбранной папке.
	func openFolderPanel() { chooseProject(title: "Открыть папку", message: "Папка, в которой откроется терминал") }


	// MARK: запуск

	/// Запустить терминал окна: сразу главный агент (команда из настроек; для повторно открытой сессии — с `--resume`), без оболочки.
	/// Агент вышел — проект закрывается целиком; агент не стартовал за первые секунды — окно остаётся и показывает причину.
	/// `-debug.terminalCommand "<команда>"` — выполнить команду и остаться в оболочке (для проверок).
	func startTerminal(for win: SessionWindowModel) {
		let debugCommand = UserDefaults.standard.string(forKey: "debug.terminalCommand")
		let lead = debugCommand == nil ? LeadCommand.build(base: AppSettings.leadCommand, resumeChat: win.value.chat) : nil
		var spec = TerminalLaunch.terminal(directory: win.dir, sessionId: win.sessionId, terminalKey: win.key, orchestrator: AppSettings.serverURL,
										   base: ProcessInfo.processInfo.environment, command: debugCommand, lead: lead, token: OrchToken.read())
		// `nessy-orch` из приложения доступен и в терминале агента (его Bash-инструментах)
		let bundledBin = Bundle.main.resourceURL.map { $0.appendingPathComponent("orch/bin").path }.flatMap { FileManager.default.fileExists(atPath: $0 + "/nessy-orch") ? $0 : nil }
		let extra = [bundledBin].compactMap { $0 }
		if !extra.isEmpty, let i = spec.environment.firstIndex(where: { $0.hasPrefix("PATH=") }) {
			spec.environment[i] = "PATH=" + (extra + [String(spec.environment[i].dropFirst(5))]).joined(separator: ":")
		}
		let tab = terminals.add(spec, key: win.key)
		tab.onExit = { [weak win, weak tab] code in
			guard let win, let tab else { return }
			guard let lead else {
				if code == 0 { win.closed() } // отладочный режим: `exit` в оболочке закрывает окно
				return
			}
			if (code ?? -1) != 0, Date().timeIntervalSince(tab.startedAt) < 3 {
				win.launchFailure = LaunchFailure(command: lead, code: code)
			} else {
				win.closed()
			}
		}
	}

	/// ⌘W: закрыть окно (терминал завершается; при живом процессе спросит подтверждение).
	func closeCurrentWindow() { if let w = activeWindow { close(w) } else { NSApp.keyWindow?.performClose(nil) } }

	// MARK: подтверждение выхода

	/// Выход с живыми терминалами — только с подтверждением.
	func confirmQuit() -> NSApplication.TerminateReply {
		let n = terminals.liveCount
		guard n > 0 else { return .terminateNow }
		let a = NSAlert()
		a.messageText = "Завершить работу?"
		a.informativeText = n == 1 ? "Открыт один терминал: его процесс будет завершён." : "Открыто терминалов: \(n). Их процессы будут завершены."
		a.addButton(withTitle: "Завершить")
		a.addButton(withTitle: "Отмена")
		a.alertStyle = .warning
		guard a.runModal() == .alertFirstButtonReturn else { return .terminateCancel }
		NSApplication.terminatingFlag = true
		terminals.terminateAll()
		return .terminateNow
	}

	// MARK: отладочные флаги (для снимков и проверки; на обычную работу не влияют)

	/// `-debug.terminalDir <путь>` — открыть окно-терминал в папке; `-debug.openSession <id>` — окно сессии;
	/// `-debug.terminalCommand "<команда>"` — терминалы выполняют команду и остаются в оболочке.
	func runDebugLaunchOnce() {
		guard !debugLaunched else { return }
		debugLaunched = true
		runDebugLaunch()
	}

	func runDebugLaunch() {
		let d = UserDefaults.standard
		Task { @MainActor in
			// ждём первый снимок оркестратора
			for _ in 0..<40 where store.sessions.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
			if let dir = d.string(forKey: "debug.terminalDir") { openTerminal(dir: dir) }
			if let s = d.string(forKey: "debug.openSession") { show(session: s) }
		}
	}
}
