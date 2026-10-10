import Foundation

/// Как запустить процесс во встроенном терминале.
public struct LaunchSpec: Equatable, Sendable {
	public var executable: String
	public var args: [String]
	/// «ИМЯ=значение», как ждёт forkpty
	public var environment: [String]
	public var directory: String

	public var env: [String: String] {
		Dictionary(environment.compactMap { e in e.firstIndex(of: "=").map { (String(e[..<$0]), String(e[e.index(after: $0)...])) } }, uniquingKeysWith: { $1 })
	}
}

/// Окружение и команды запуска Claude Code / обычной оболочки. Чистые функции: UI только подставляет значения.
public enum TerminalLaunch {
	public static let defaultPort = 4337
	public static let shell = "/bin/zsh"

	/// Переменные родителя, которые нельзя тащить в новый терминал: чужая сессия оркестратора и признаки «внутри Claude Code».
	static let stripped: Set<String> = [
		"NESSY_ORCH_SESSION", "NESSY_ORCH_TERMINAL", "ORCH_PORT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_EXECPATH",
		"TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "INSIDE_EMACS",
	]

	/// Окружение терминала: базовое минус чужое, плюс TERM/COLORTERM/LANG, сессия оркестратора и порт (только нестандартный).
	/// `~/.local/bin` в начале PATH — туда приложение ставит `nessy-orch`, а `claude` обычно лежит там же; login-оболочка
	/// дополнит PATH из профилей.
	public static func environment(base: [String: String], sessionId: String?, terminalKey: String? = nil, orchestrator: URL, home: String = NSHomeDirectory()) -> [String: String] {
		var env = base.filter { !stripped.contains($0.key) && !$0.key.hasPrefix("CLAUDE_CODE_") }
		env["TERM"] = "xterm-256color"
		env["COLORTERM"] = "truecolor"
		let lang = base["LANG"] ?? ""
		env["LANG"] = lang.uppercased().contains("UTF-8") || lang.uppercased().contains("UTF8") ? lang : "en_US.UTF-8"
		env["HOME"] = env["HOME"] ?? home
		let local = home + "/.local/bin"
		let path = (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
		env["PATH"] = ([local] + path.filter { $0 != local }).joined(separator: ":")
		if let sessionId, !sessionId.isEmpty { env["NESSY_ORCH_SESSION"] = sessionId }
		// ключ терминала приложения: хуки Claude по нему привязывают сессию чата (session_id) к терминалу, сессия заранее не создаётся
		if let terminalKey, !terminalKey.isEmpty { env["NESSY_ORCH_TERMINAL"] = terminalKey }
		if let port = orchestrator.port, port != defaultPort { env["ORCH_PORT"] = String(port) }
		return env
	}

	static func pairs(_ env: [String: String]) -> [String] { env.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" } }

	/// Терминал окна: login-оболочка пользователя (`$SHELL`) в папке, с окружением сессии и прозрачными хуками Claude
	/// (`ShellIntegration`). `command` — для проверок: выполнить и остаться в оболочке.
	public static func terminal(directory: String, sessionId: String?, terminalKey: String? = nil, orchestrator: URL, base: [String: String], command: String? = nil,
								home: String = NSHomeDirectory(), fm: FileManager = .default) -> LaunchSpec {
		let shell = ShellIntegration.userShell(env: base, fm: fm)
		let kind = ShellIntegration.kind(ofShell: shell)
		let layout = ShellIntegration.Layout(home: URL(fileURLWithPath: home))
		var env = environment(base: base, sessionId: sessionId, terminalKey: terminalKey, orchestrator: orchestrator, home: home)
		env["NESSY_ORCH_DIR"] = directory
		env["SHELL"] = shell
		for (k, v) in ShellIntegration.environment(kind: kind, layout: layout, base: base, home: home) { env[k] = v }
		return LaunchSpec(executable: shell, args: ShellIntegration.arguments(kind: kind, shell: shell, layout: layout, command: command),
						  environment: pairs(env), directory: directory)
	}

	/// Папка из ссылки: `nessy-orch://terminal?dir=<путь>` или файловый URL папки (открытие папки приложением).
	public static func directory(from url: URL) -> String? {
		if url.isFileURL { return Projects.normalize(url.path) }
		guard url.scheme == "nessy-orch", url.host == "terminal" else { return nil }
		let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
		var value = items?.first { $0.name == "dir" }?.value
		// запасной разбор: путь пришёл закодированным дважды
		if let v = value, !v.hasPrefix("/"), v.contains("%") { value = v.removingPercentEncoding }
		return Projects.normalize(value)
	}

	/// Заголовок сессии оркестратора для окна: имя папки.
	public static func sessionTitle(directory: String) -> String { Projects.name(ofPath: directory) }

	/// Каталог существует и это папка.
	public static func isUsableDirectory(_ path: String, fm: FileManager = .default) -> Bool {
		var isDir: ObjCBool = false
		return fm.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
	}
}
