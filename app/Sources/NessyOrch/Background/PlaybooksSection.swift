import SwiftUI
import NessyKit

/// Раздел «Плейбуки»: слева поиск и список (готовые, ниже «В процессе»), справа весь контент выбранного плейбука.
struct PlaybooksSection: View {
	@Environment(AppModel.self) private var model
	@State private var query = ""

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		// плейбуков нет совсем — одно пустое состояние на всё окно, без второго «Выберите плейбук»
		if learning.playbooks.isEmpty && model.background.objectId == nil {
			LearningEmptyState("Плейбуков пока нет", systemImage: "book.closed", message: "Плейбук собирается из кейсов одной задачи.")
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
		let g = BackgroundLogic.playbooks(learning.playbooks, jobs: learning.jobs, query: query)
		return VStack(spacing: DS.Metrics.s2) {
			TextField("Поиск по названию и описанию", text: $query).textFieldStyle(.roundedBorder)
				.padding(.horizontal, DS.Metrics.s3).padding(.top, DS.Metrics.s3)
			if g.ready.isEmpty && g.inProgress.isEmpty {
				LearningEmptyState("Ничего не найдено", systemImage: "book.closed", message: "Измените запрос.").frame(maxHeight: .infinity)
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: DS.Metrics.s4) {
						group("Готовые", g.ready)
						group("В процессе", g.inProgress)
					}
					.padding(.horizontal, DS.Metrics.s2).padding(.bottom, DS.Metrics.s3)
				}
			}
		}
	}

	@ViewBuilder private func group(_ title: String, _ items: [PlaybookView]) -> some View {
		if !items.isEmpty {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				DSGroupHeader(title: title, count: items.count)
				ForEach(items) { p in PlaybookRow(item: p, busy: BackgroundLogic.isBusy(p, jobs: learning.jobs), selected: model.background.objectId == p.id) { model.background.go(.playbooks, id: p.id) } }
			}
		}
	}

	@ViewBuilder private var detail: some View {
		if let id = model.background.objectId, learning.playbook(id) != nil {
			PlaybookCard(id: id).id(id)
		} else if model.background.objectId != nil, learning.loaded {
			DeletedObjectView(title: "Плейбук удалён")
		} else {
			LearningEmptyState("Выберите плейбук", systemImage: "book.closed", message: "Слева — плейбуки, готовые сверху.")
		}
	}
}

/// Строка списка: название, версия и число кейсов; у ждущего решения — метка, у собирающегося — крутилка.
private struct PlaybookRow: View {
	var item: PlaybookView
	var busy: Bool
	var selected: Bool
	var action: () -> Void

	var body: some View {
		ListRowButton(selected: selected, action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				HStack(spacing: DS.Metrics.s2) {
					Text(item.title).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					Spacer(minLength: 0)
					if busy { ProgressView().controlSize(.small) }
					else if item.status == .review { LearningChip("ждёт вас", tint: DS.Palette.accentText) }
				}
				HStack(spacing: DS.Metrics.s2) {
					Text(BackgroundLogic.playbookLine(item))
					if let t = BackgroundLogic.trialLine(item) { Text("· пробный: \(t)") }
				}
				.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
			}
		}
	}
}
