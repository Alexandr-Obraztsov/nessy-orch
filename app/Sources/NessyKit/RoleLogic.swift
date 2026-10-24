import Foundation

/// Правка роли в редакторе: черновик полей и проверка «изменено».
public struct RoleDraft: Equatable, Sendable {
	public var name = ""
	public var description = ""
	public var instructions = ""
	/// оттенок 0…360 (0 — серый) и SF Symbol
	public var color: Double = 0
	public var icon = RolePalette.defaultIcon
	/// у роли есть пакет файлов: правка инструкций его не трогает
	public var hasPackage = false
	/// модель и рантайм роли; пусто — по умолчанию
	public var model = ""
	public var runtime = ""

	public init() {}
	public init(_ r: RoleView) { model = r.model ?? ""; runtime = r.runtime ?? ""; name = r.name; description = r.description; instructions = r.instructions; color = r.color; icon = r.icon ?? RolePalette.defaultIcon; hasPackage = r.package == true }

	/// Новая роль: случайный цвет из палитры и иконка сразу.
	public static func fresh(using g: inout some RandomNumberGenerator) -> RoleDraft {
		var d = RoleDraft()
		d.color = RolePalette.hues.randomElement(using: &g) ?? 215
		d.icon = RolePalette.icons.randomElement(using: &g) ?? RolePalette.defaultIcon
		return d
	}

	/// Можно сохранить: имя и инструкции не пустые.
	public var isValid: Bool {
		!name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	/// Отличается от сохранённой роли (nil — новая роль: изменено, если что-то введено).
	public func isChanged(from role: RoleView?) -> Bool {
		// новая роль изменена, когда введён текст; случайные цвет и иконка сами по себе не считаются
		guard let role else { return !(trimmed.name.isEmpty && trimmed.description.isEmpty && trimmed.instructions.isEmpty) }
		return trimmed != RoleDraft(role).trimmed
	}

	public var trimmed: RoleDraft {
		var d = self
		d.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
		d.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
		d.instructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
		d.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
		d.runtime = runtime.trimmingCharacters(in: .whitespacesAndNewlines)
		return d
	}
}

public enum RoleUsage {
	/// Сколько агентов используют роль (по id или имени без учёта регистра).
	public static func count(_ role: RoleView, in agents: [AgentView]) -> Int {
		agents.filter { a in
			guard let r = a.role else { return false }
			return r == role.id || r.caseInsensitiveCompare(role.name) == .orderedSame
		}.count
	}
}

/// Палитра ролей: цвет и иконка — единственное место, где в интерфейсе допустимы разные оттенки.
public enum RolePalette {
	public static let defaultIcon = "person.crop.circle"
	/// 0 — серый; остальное — оттенки по кругу
	public static let swatches: [Double] = [0, 5, 28, 48, 90, 135, 175, 195, 215, 245, 275, 325]
	public static var hues: [Double] { swatches.filter { $0 > 0 } }
	public static let icons = [
		"magnifyingglass", "hammer", "eye", "ladybug", "checkmark.seal", "lock.shield", "speedometer", "scissors",
		"testtube.2", "books.vertical", "pencil.and.outline", "list.bullet.clipboard", "square.stack.3d.up", "arrow.triangle.merge",
		"checklist", "terminal", "bolt", "gearshape", "globe", "lightbulb", "flag", "person.2", "wand.and.stars", "chart.bar",
		"shippingbox", "doc.text", "paintbrush", "tray.full", "book", "wrench.and.screwdriver", "cpu", "network", "key", "link",
		"bell", "star",
	]
}
