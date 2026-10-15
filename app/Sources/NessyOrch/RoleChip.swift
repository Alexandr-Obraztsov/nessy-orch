import SwiftUI
import NessyKit

/// Цвет роли из оттенка 0…360 (0 — серый).
/// Единственное место интерфейса с разными цветами.
enum RoleTint {
	/// значок — белый на насыщенной подложке (приглушённая, «бледная» подложка выглядела грязно, особенно синяя) (читается в обеих темах)
	static func foreground(_ hue: Double, dark: Bool) -> Color { .white }
	static func background(_ hue: Double, dark: Bool) -> Color {
		hue <= 0 ? Color(white: dark ? 0.42 : 0.58) : Color(hue: hue / 360, saturation: dark ? 0.78 : 0.72, brightness: dark ? 0.62 : 0.78)
	}
}

/// Капсула роли для строки агента: иконка и название на подложке оттенка роли.
struct RoleChip: View {
	@Environment(\.colorScheme) private var scheme
	var name: String
	var icon: String?
	var hue: Double
	var body: some View {
		let dark = scheme == .dark
		HStack(spacing: 4) {
			Image(systemName: icon ?? RolePalette.defaultIcon).font(.system(size: 10, weight: .semibold))
			Text(name).font(DS.Typography.caption.weight(.medium)).lineLimit(1)
		}
		.foregroundStyle(RoleTint.foreground(hue, dark: dark))
		.padding(.horizontal, 7).padding(.vertical, 2)
		.background(RoleTint.background(hue, dark: dark), in: Capsule())
	}
}

extension AppModel {
	/// Роль агента для показа: имя, иконка, оттенок. Нет роли — nil; неизвестная роль — серая с её названием.
	func roleInfo(of a: AgentView) -> (name: String, icon: String?, hue: Double, description: String)? {
		guard let id = a.role else { return nil }
		if let r = store.role(id) ?? store.roles.first(where: { $0.name.caseInsensitiveCompare(id) == .orderedSame }) {
			return (r.name, r.icon, r.color, r.description)
		}
		return (id, nil, 0, "")
	}
}
