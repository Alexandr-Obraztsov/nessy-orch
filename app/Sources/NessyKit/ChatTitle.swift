import Foundation

/// Название сессии по чату Claude. Claude Code ставит заголовок окна терминала («✳ Название чата» в покое, «◐ Название чата» в ходе): из него берём
/// название, чтобы сессии в меню и списках различались по смыслу, а не только по папке.
public enum ChatTitle {
	/// символы статуса в начале заголовка: ✳ (покой), спиннеры Claude Code и брайлевские спиннеры
	private static let status: Set<Character> = ["✳", "✻", "✶", "✢", "✽", "·", "◐", "◑", "◒", "◓", "●", "○"]

	/// Название чата из заголовка окна или nil (пусто, «Claude Code» без названия, служебное). Длина ограничена 80 знаками.
	public static func clean(_ osc: String) -> String? {
		var s = osc.trimmingCharacters(in: .whitespacesAndNewlines)
		while let f = s.first, status.contains(f) || (f.unicodeScalars.first.map { (0x2800...0x28FF).contains($0.value) } ?? false) {
			s.removeFirst()
			s = s.trimmingCharacters(in: .whitespaces)
		}
		guard !s.isEmpty, s.lowercased() != "claude code", s.lowercased() != "claude" else { return nil }
		return s.count > 80 ? String(s.prefix(79)) + "…" : s
	}

	/// Подпись сессии в меню: название чата; если оно ещё не задано (совпадает с папкой), только папка; иначе «название · папка».
	public static func label(title: String, cwd: String?) -> String {
		let folder = cwd.map { Projects.name(ofPath: $0) } ?? ""
		if folder.isEmpty || title == folder { return title }
		return "\(title) · \(folder)"
	}
}
