import Foundation

/// Команда главного агента, которую терминал запускает вместо оболочки.
public enum LeadCommand {
	/// Агенты, умеющие продолжить прежний чат флагом `--resume <id>`.
	static let resumable: Set<String> = ["claude", "nessy", "qwen"]

	/// Команда из настроек (по умолчанию `claude`); для повторного открытия сессии к ней добавляется `--resume <id чата>`,
	/// если агент это умеет и пользователь сам не указал resume/continue.
	public static func build(base: String, resumeChat: String?) -> String {
		let b = base.trimmingCharacters(in: .whitespacesAndNewlines)
		let cmd = b.isEmpty ? "claude" : b
		guard let chat = resumeChat, !chat.isEmpty else { return cmd }
		let words = cmd.split(separator: " ").map(String.init)
		guard let first = words.first, resumable.contains(URL(fileURLWithPath: first).lastPathComponent) else { return cmd }
		if words.contains(where: { $0 == "--resume" || $0 == "-r" || $0 == "--continue" || $0 == "-c" }) { return cmd }
		return cmd + " --resume " + ShellQuote.quote(chat)
	}
}
