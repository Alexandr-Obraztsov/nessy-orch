import SwiftUI
import NessyKit

/// Раздел «Плейбуки» (спека §5): слева список по группам, справа карточка выбранного плейбука.
struct PlaybooksSection: View {
	@Environment(AppModel.self) private var model
	@State private var offOpen = false

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		// плейбуков нет совсем — одно пустое состояние на всё окно, без второго «Выберите плейбук»
		if learning.playbooks.isEmpty && model.background.objectId == nil {
			LearningEmptyState("Плейбуков пока нет", systemImage: "book.closed", message: "Плейбук собирается из трёх кейсов одной задачи.")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			HStack(spacing: 0) {
				list.frame(width: 300)
				DSVerticalSeparator()
				detail.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
	}

	private var list: some View {
		let groups = PlaybookEditing.groups(learning.playbooks)
		return Group {
			if groups.isEmpty {
				LearningEmptyState("Плейбуков пока нет", systemImage: "book.closed", message: "Плейбук собирается из трёх кейсов одной задачи.")
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: DS.Metrics.s4) {
						ForEach(groups, id: \.group) { g in
							VStack(alignment: .leading, spacing: DS.Metrics.s1) {
								if g.group.collapsedByDefault {
									DSGroupHeader(title: g.group.title, count: g.items.count, expanded: $offOpen)
								} else {
									DSGroupHeader(title: g.group.title, count: g.items.count)
								}
								if !g.group.collapsedByDefault || offOpen {
									ForEach(g.items) { p in
										PlaybookRow(item: p, selected: model.background.objectId == p.id) { model.background.go(.playbooks, id: p.id) }
									}
								}
							}
						}
					}
					.padding(.horizontal, DS.Metrics.s2).padding(.vertical, DS.Metrics.s3)
				}
			}
		}
	}

	@ViewBuilder private var detail: some View {
		if let id = model.background.objectId, learning.playbook(id) != nil {
			PlaybookCard(id: id).id(id)
		} else if let id = model.background.objectId, learning.loaded {
			DeletedObjectView(title: "Плейбук удалён", id: id)
		} else {
			LearningEmptyState("Выберите плейбук", systemImage: "book.closed", message: "Слева — плейбуки; те, что ждут вас, сверху.")
		}
	}
}

/// Строка списка: название, тип задачи, версия, число кейсов, суммарные ▲▼ по правилам; у пробного — ход пробы.
private struct PlaybookRow: View {
	var item: PlaybookView
	var selected: Bool
	var action: () -> Void
	@State private var hover = false

	var body: some View {
		let balance = PlaybookEditing.ruleBalance(item)
		Button(action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				HStack(spacing: DS.Metrics.s2) {
					Text(item.title).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					Spacer(minLength: 0)
					if item.status == .review { LearningChip("ждёт вас", tint: DS.Palette.accentText) }
					else if !item.pendingEdits.isEmpty { LearningChip("\(item.pendingEdits.count) \(Durations.plural(item.pendingEdits.count, "правка", "правки", "правок"))", tint: DS.Palette.accentText) }
				}
				HStack(spacing: DS.Metrics.s2) {
					if !item.taskType.isEmpty { Text(item.taskType).lineLimit(1) }
					Text("v\(item.version)").font(DS.Typography.monoCaption)
					Text("\(item.cases.count) \(Durations.plural(item.cases.count, "кейс", "кейса", "кейсов"))")
					Spacer(minLength: 0)
					if balance.up > 0 || balance.down > 0 {
						Text("▲\(balance.up) ▼\(balance.down)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary)
					}
				}
				.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				if let t = PlaybookEditing.trialLine(item) {
					Text("Проба: \(t)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				}
			}
			.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(selected ? DS.Palette.border : (hover ? DS.Palette.hover : .clear), in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.onHover { hover = $0 }
	}
}
