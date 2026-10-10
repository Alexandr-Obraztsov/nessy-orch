import Foundation

/// Правка роли в редакторе: черновик полей и проверка «изменено».
public struct RoleDraft: Equatable, Sendable {
	public var name = ""
	public var description = ""
	public var instructions = ""

	public init() {}
	public init(_ r: RoleView) { name = r.name; description = r.description; instructions = r.instructions }

	/// Можно сохранить: имя и инструкции не пустые.
	public var isValid: Bool {
		!name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	/// Отличается от сохранённой роли (nil — новая роль: изменено, если что-то введено).
	public func isChanged(from role: RoleView?) -> Bool {
		guard let role else { return self != RoleDraft() }
		return trimmed != RoleDraft(role).trimmed
	}

	public var trimmed: RoleDraft {
		var d = self
		d.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
		d.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
		d.instructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
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
