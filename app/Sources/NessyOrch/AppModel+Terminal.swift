import SwiftUI
import AppKit
import NessyKit

/// Терминалы: запуск оболочки пользователя в папке окна, прозрачные хуки Claude, выбор папки (layout-v2.md).
extension AppModel {
	// MARK: папки

	/// Папка сессии: запомненная папка терминала, иначе пространство с наибольшим числом её агентов.
	func projectPath(of session: String) -> String? {
		Projects.path(ofSession: session, sessionDirs: sessionDirs, agents: store.allAgents, spaces: store.spaces)
	}

	func rememberDirectory(_ dir: String, session: String) {
		guard let n = Projects.normalize(dir) else { return }
		sessionDirs[session] = n
		UserDefaults.standard.set(sessionDirs, forKey: "sessionDirs")
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
		p.directoryURL = URL(fileURLWithPath: activeWindow?.dir ?? last ?? NSHomeDirectory())
		p.center()
		guard p.runModal() == .OK, let u = p.url else { return }
		UserDefaults.standard.set(u.path, forKey: "lastProjectDir")
		openTerminal(dir: u.path)
	}

	/// ⇧⌘O: ещё одно окно в выбранной папке.
	func openFolderPanel() { chooseProject(title: "Открыть папку", message: "Папка, в которой откроется терминал") }


	// MARK: запуск

	/// Прозрачные хуки Claude: файл хуков и скрипты оболочек в `~/.nessy-orch` (файлы пользователя не трогаем).
	/// В файле хуков — путь к CLI: установленная ссылка `~/.local/bin/nessy-orch`, иначе встроенный скрипт.
	func prepareShellIntegration() {
		let cli = CLISupport.shared
		let path: String
		if case .installed = cli.state { path = cli.linkPath }
		else if let script = cli.installer.script?.path { path = script }
		else { path = cli.linkPath }
		do {
			try ClaudeHooks.write(cli: path)
			try ShellIntegration.install(layout: ShellIntegration.Layout(home: FileManager.default.homeDirectoryForCurrentUser))
		} catch {
			flash("Хуки Claude не подключены: \(error.localizedDescription)", error: true)
		}
	}

	/// Запустить терминал окна: оболочка пользователя в папке, с `NESSY_ORCH_SESSION` и `NESSY_ORCH_DIR`.
	/// `-debug.terminalCommand "<команда>"` — выполнить команду и остаться в оболочке (для проверок).
	func startTerminal(for win: SessionWindowModel) {
		prepareShellIntegration()
		let spec = TerminalLaunch.terminal(directory: win.dir, sessionId: win.sessionId, orchestrator: AppSettings.serverURL,
										   base: ProcessInfo.processInfo.environment, command: UserDefaults.standard.string(forKey: "debug.terminalCommand"))
		let tab = terminals.add(spec, key: win.key)
		// `exit` в оболочке закрывает окно, как в Terminal.app
		tab.onExit = { [weak win] code in
			guard code == 0, let win else { return }
			NSApp.windows.first { ($0.delegate as? CloseGuard)?.key == win.key }?.close()
		}
	}

	/// ⌘W: закрыть окно (терминал завершается; при живом процессе спросит подтверждение).
	func closeCurrentWindow() { NSApp.keyWindow?.performClose(nil) }

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
	func runDebugLaunch() {
		let d = UserDefaults.standard
		Task { @MainActor in
			// ждём первый снимок оркестратора
			for _ in 0..<40 where store.sessions.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
			if let dir = d.string(forKey: "debug.terminalDir") { suppressHomeWindow = true; openTerminal(dir: dir) }
			if let s = d.string(forKey: "debug.openSession") { show(session: s) }
		}
	}
}
