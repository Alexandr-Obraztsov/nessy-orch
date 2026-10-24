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

/// Капсула рантайма: значок и название («nessy», «Claude Code»). Нет рантайма — nessy. Модель — отдельно (`ModelLine`, `ModelMenu`).
struct RuntimeBadge: View {
	var runtime: String?

	private var symbol: String {
		switch RuntimeLogic.id(runtime) {
		case "nessy-sdk": "sparkle"
		case "tclaude": "terminal"
		default: "cpu"
		}
	}

	var body: some View {
		HStack(spacing: 4) {
			Image(systemName: symbol).font(.system(size: 9, weight: .semibold))
			Text(RuntimeLogic.name(runtime)).font(DS.Typography.caption.weight(.medium)).lineLimit(1)
		}
		.foregroundStyle(DS.Palette.textSecondary)
		.padding(.horizontal, 6).padding(.vertical, 1)
		.background(DS.Palette.hover, in: Capsule())
		.help("Рантайм: \(RuntimeLogic.name(runtime))")
	}
}

/// Модель агента тихой строкой: короткая форма и, если запрошена другая или не подтверждена, пометка «запрошена X» с иконкой. Нет модели — не рисуется.
struct ModelLine: View {
	var agent: AgentView

	var body: some View {
		if let c = RuntimeLogic.modelCaption(agent) {
			HStack(spacing: 4) {
				Image(systemName: "cube").font(.system(size: 9, weight: .medium))
				Text(c.text).lineLimit(1)
				if let r = c.requested {
					Image(systemName: "exclamationmark.triangle").font(.system(size: 9, weight: .semibold))
					Text("запрошена \(r)").lineLimit(1).foregroundStyle(DS.Palette.textTertiary)
				}
			}
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			.frame(maxWidth: .infinity, alignment: .leading)
			.help(c.help)
			.accessibilityElement(children: .ignore)
			.accessibilityLabel(c.requested.map { "модель \(c.text), запрошена \($0)" } ?? "модель \(c.text)")
		}
	}
}

/// Меню «Модель» в шапке агента: модели его рантайма, текущая отмечена. Рантайм не умеет менять модель — просто строка модели; занятому агенту меню недоступно.
struct ModelMenu: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	@State private var hover = false

	var body: some View {
		let info = model.store.runtimeInfo(of: agent)
		if RuntimeLogic.supportsModelSwitch(info) {
			let options = RuntimeLogic.modelOptions(info, current: agent.model)
			let busy = RuntimeLogic.isBusy(agent)
			Menu {
				ForEach(options, id: \.id) { m in
					Button { model.setModel(agent, to: m.id) } label: {
						if RuntimeLogic.isSelected(m, current: agent.model) { Label(m.label, systemImage: "checkmark") } else { Text(m.label) }
					}
				}
			} label: {
				HStack(spacing: 3) {
					Text(RuntimeLogic.shortModel(agent.model) ?? "Модель").lineLimit(1)
					if RuntimeLogic.modelCaption(agent)?.requested != nil { Image(systemName: "exclamationmark.triangle").font(.system(size: 9, weight: .semibold)) }
					Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
				}
				.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				.padding(.horizontal, 6).padding(.vertical, 1)
				.background(hover && !busy ? DS.Palette.hover : .clear, in: Capsule())
			}
			.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
			.disabled(busy || model.isOffline)
			.onHover { hover = $0 }
			.help(busy ? "Модель меняется, когда агент закончил ход и очередь пуста" : (RuntimeLogic.modelCaption(agent)?.help ?? "Сменить модель"))
		} else if let c = RuntimeLogic.modelCaption(agent) {
			ModelLine(agent: agent).fixedSize().help(c.help)
		}
	}
}

extension AppModel {
	/// Рантайм агента для показа: свой, иначе пространства, иначе nessy-sdk.
	func runtimeId(of a: AgentView) -> String { RuntimeLogic.id(of: a, spaces: store.spaces) }
	/// Роль агента для показа: имя, иконка, оттенок. Нет роли — nil; неизвестная роль — серая с её названием.
	func roleInfo(of a: AgentView) -> (name: String, icon: String?, hue: Double, description: String)? {
		guard let id = a.role else { return nil }
		if let r = store.role(id) ?? store.roles.first(where: { $0.name.caseInsensitiveCompare(id) == .orderedSame }) {
			return (r.name, r.icon, r.color, r.description)
		}
		return (id, nil, 0, "")
	}
}
