import Foundation

public enum PermissionText {
	/// Команда из заголовка запроса: «Shell: git push» → «git push» (префикс инструмента — внутренняя деталь).
	public static func command(_ title: String) -> String {
		let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let r = t.range(of: "^[A-Za-z][\\w .-]{0,23}:\\s+", options: .regularExpression) else { return t }
		return String(t[r.upperBound...])
	}
}
