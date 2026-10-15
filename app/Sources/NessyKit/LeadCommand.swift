import Foundation

/// Команда главного агента, которую терминал запускает вместо оболочки. Главный агент — только Claude Code (`claude`, `tclaude`…).
public enum LeadCommand {
	/// Claude Code: имя файла команды оканчивается на `claude`.
	public static func isClaude(_ command: String) -> Bool {
		guard let first = command.split(separator: " ").first else { return true }
		return URL(fileURLWithPath: String(first)).lastPathComponent.hasSuffix("claude")
	}

	/// Команда из настроек (по умолчанию `claude`) с чатом вкладки: новый чат — `--session-id <uuid>` (id задан заранее, сервер его знает),
	/// повторное открытие — `--resume <id чата>`. Если пользователь сам указал resume/continue/session-id, команда не меняется.
	public static func build(base: String, newChat: String?, resumeChat: String?) -> String {
		let b = base.trimmingCharacters(in: .whitespacesAndNewlines)
		let cmd = b.isEmpty ? "claude" : b
		guard isClaude(cmd) else { return cmd }
		let own: Set<String> = ["--resume", "-r", "--continue", "-c", "--session-id"]
		if cmd.split(separator: " ").contains(where: { own.contains(String($0)) }) { return cmd }
		if let chat = resumeChat, !chat.isEmpty { return cmd + " --resume " + ShellQuote.quote(chat) }
		if let chat = newChat, !chat.isEmpty { return cmd + " --session-id " + ShellQuote.quote(chat) }
		return cmd
	}
}
