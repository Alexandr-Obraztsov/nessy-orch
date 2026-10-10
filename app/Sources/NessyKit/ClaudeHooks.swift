import Foundation

/// Хуки Claude Code для оркестратора: файл настроек, который передаётся ключом `--settings`
/// (`~/.nessy-orch/claude-hooks.json`). Хуки вызывают `nessy-orch hook start|prompt|stop|end`; номер сессии берётся из
/// переменной `NESSY_ORCH_SESSION` терминала. Пользовательские настройки Claude и файлы его проектов не меняются.
public enum ClaudeHooks {
	/// событие Claude → подкоманда `hook`
	static let events: [(claude: String, sub: String)] = [
		("SessionStart", "start"), ("UserPromptSubmit", "prompt"), ("Stop", "stop"), ("SessionEnd", "end"),
	]

	/// Строка в одинарных кавычках для оболочки; внутренние `'` экранируются.
	public static func shellQuote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

	public static func command(cli: String, sub: String) -> String { "\(shellQuote(cli)) hook \(sub)" }

	/// Содержимое `claude-hooks.json` (стабильный порядок ключей — файл не переписывается без нужды).
	public static func settingsJSON(cli: String) -> String {
		var hooks: [String: Any] = [:]
		for e in events { hooks[e.claude] = [["hooks": [["type": "command", "command": command(cli: cli, sub: e.sub)]]]] }
		let data = try! JSONSerialization.data(withJSONObject: ["hooks": hooks], options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
		return String(decoding: data, as: UTF8.self) + "\n"
	}

	public static func settingsURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
		home.appendingPathComponent(".nessy-orch/claude-hooks.json")
	}

	/// Записать файл, если содержимое изменилось. Возвращает путь.
	@discardableResult
	public static func write(cli: String, to url: URL = settingsURL()) throws -> URL {
		let text = settingsJSON(cli: cli)
		if (try? String(contentsOf: url, encoding: .utf8)) != text {
			try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
			try text.write(to: url, atomically: true, encoding: .utf8)
		}
		return url
	}
}
