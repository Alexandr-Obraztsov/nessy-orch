import SwiftUI
import NessyKit

/// Раздел «Кейсы»: слева список с поиском, справа описание выбранного кейса (только чтение).
struct CasesSection: View {
	@Environment(AppModel.self) private var model
	@State private var query = ""

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		// кейсов нет совсем — одно пустое состояние на всё окно, без второго «Выберите кейс»
		if !learning.cases.contains(where: { $0.status == .ready }) && model.background.objectId == nil {
			LearningEmptyState("Кейсов пока нет", systemImage: "tray.full", message: "Кейс появляется, когда фон описал сессию.")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			HStack(spacing: 0) {
				list.frame(width: 300)
				DSVerticalSeparator()
				detail.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
	}

	private var shown: [CaseView] {
		BackgroundLogic.cases(learning.cases, query: query, titleOf: { model.title(ofCase: $0) }, sessionTitlesOf: { model.sessionTitles(of: $0) })
	}

	private var list: some View {
		VStack(spacing: DS.Metrics.s2) {
			TextField("Поиск по названию и целям", text: $query).textFieldStyle(.roundedBorder)
				.padding(.horizontal, DS.Metrics.s3).padding(.top, DS.Metrics.s3)
			let items = shown
			if items.isEmpty {
				LearningEmptyState("Ничего не найдено", systemImage: "tray.full", message: "Измените запрос.").frame(maxHeight: .infinity)
			} else {
				ScrollView {
					LazyVStack(spacing: 2) {
						ForEach(items) { c in CaseRow(item: c, selected: model.background.objectId == c.id) { model.background.go(.cases, id: c.id) } }
					}
					.padding(.horizontal, DS.Metrics.s2).padding(.bottom, DS.Metrics.s3)
				}
			}
		}
	}

	@ViewBuilder private var detail: some View {
		if let id = model.background.objectId, let c = learning.caseView(id) {
			CaseCard(item: c).id(id)
		} else if model.background.objectId != nil, learning.loaded {
			DeletedObjectView(title: "Кейс удалён")
		} else {
			LearningEmptyState("Выберите кейс", systemImage: "tray.full", message: "Слева — кейсы, самые свежие сверху.")
		}
	}
}

/// Строка списка: название, типы целей чипами и дата.
private struct CaseRow: View {
	@Environment(AppModel.self) private var model
	var item: CaseView
	var selected: Bool
	var action: () -> Void

	var body: some View {
		ListRowButton(selected: selected, action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				Text(model.title(ofCase: item)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
				let types = item.goals.map(\.type).filter { !$0.isEmpty }
				if !types.isEmpty {
					FlowLayout(spacing: DS.Metrics.s1) { ForEach(Array(types.enumerated()), id: \.offset) { _, t in LearningChip(t) } }
				}
				if let d = ISO.parse(item.updatedAt) { Text(d.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
			}
		}
	}
}
