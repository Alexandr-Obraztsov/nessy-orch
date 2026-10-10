import Foundation

/// Оценка риска команды в запросе разрешения: что подсветить в интерфейсе, прежде чем нажать «Разрешить».
public struct Risk: Equatable, Sendable {
	public enum Level: Int, Sendable { case none, caution, danger }
	public var level: Level
	public var reasons: [String]
	public static let none = Risk(level: .none, reasons: [])
}

public enum RiskAssessor {
	private static let rules: [(pattern: String, level: Risk.Level, reason: String)] = [
		("\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)", .danger, "рекурсивное удаление"),
		("\\bgit\\s+push\\b.*(--force|-f\\b|--force-with-lease)", .danger, "принудительный push"),
		("\\bgit\\s+reset\\s+--hard", .danger, "git reset --hard"),
		("\\bgit\\s+clean\\s+-[a-zA-Z]*f", .danger, "git clean -f"),
		("(curl|wget)[^|]*\\|\\s*(sudo\\s+)?(ba|z)?sh", .danger, "выполнение скачанного скрипта"),
		("\\bsudo\\b", .danger, "sudo"),
		("\\bchmod\\s+(-R\\s+)?[0-7]*7[0-7]{0,2}\\b", .caution, "широкие права доступа"),
		("\\bDROP\\s+(TABLE|DATABASE)\\b", .danger, "удаление данных БД"),
		("\\bgit\\s+push\\b", .caution, "отправка в удалённый репозиторий"),
		("\\bnpm\\s+publish\\b|\\bdocker\\s+push\\b", .caution, "публикация"),
		("\\b(kill|killall|pkill)\\b", .caution, "завершение процессов"),
		(">\\s*/(etc|usr|System|Library)/", .danger, "запись в системный каталог"),
		("\\bmv\\s+.*\\s+/dev/null", .danger, "перенос в /dev/null"),
	]

	public static func assess(_ command: String) -> Risk {
		var level = Risk.Level.none
		var reasons: [String] = []
		for r in rules {
			guard let re = try? NSRegularExpression(pattern: r.pattern, options: [.caseInsensitive]),
				re.firstMatch(in: command, range: NSRange(command.startIndex..., in: command)) != nil else { continue }
			reasons.append(r.reason)
			if r.level.rawValue > level.rawValue { level = r.level }
		}
		return Risk(level: level, reasons: reasons)
	}
}

public enum PermissionText {
	/// Команда из заголовка запроса: «Shell: git push» → «git push» (префикс инструмента — внутренняя деталь).
	public static func command(_ title: String) -> String {
		let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let r = t.range(of: "^[A-Za-z][\\w .-]{0,23}:\\s+", options: .regularExpression) else { return t }
		return String(t[r.upperBound...])
	}
}
