import SwiftUI
import NessyKit

/// Раздел «Кейсы» (спека §5): слева список с фильтром и поиском, справа карточка выбранного кейса.
struct CasesSection: View {
	@Environment(AppModel.self) private var model
	@State private var filter = CaseFilter.all
	@State private var query = ""

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		HStack(spacing: 0) {
			list.frame(width: 300)
			DSSeparator().frame(maxHeight: .infinity)
			detail.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	// MARK: список

	private var shown: [CaseView] {
		CaseEditing.list(learning.cases, filter: filter, query: query,
			titleOf: { model.title(ofCase: $0) }, sessionTitlesOf: { model.sessionTitles(of: $0) })
	}

	private var list: some View {
		VStack(spacing: DS.Metrics.s2) {
			VStack(spacing: DS.Metrics.s2) {
				TextField("Поиск по названию и целям", text: $query).textFieldStyle(.roundedBorder)
				Picker("Статус", selection: $filter) {
					ForEach(CaseFilter.allCases, id: \.self) { Text($0.title).tag($0) }
				}
				.pickerStyle(.segmented).labelsHidden()
			}
			.padding(.horizontal, DS.Metrics.s3).padding(.top, DS.Metrics.s3)

			let items = shown
			if items.isEmpty {
				LearningEmptyState(learning.cases.isEmpty ? "Кейсов пока нет" : "Ничего не найдено", systemImage: "tray.full",
					message: learning.cases.isEmpty ? "Кейс появляется, когда сборщик описывает сессию." : "Измените фильтр или запрос.")
					.frame(maxHeight: .infinity)
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
		} else if let id = model.background.objectId, learning.loaded {
			DeletedObjectView(title: "Кейс удалён", id: id)
		} else {
			LearningEmptyState("Выберите кейс", systemImage: "tray.full", message: "Слева — кейсы, самые свежие сверху.")
		}
	}
}

/// Строка списка: заголовок, цели-типы чипами, сессии, плейбук и дата.
private struct CaseRow: View {
	@Environment(AppModel.self) private var model
	var item: CaseView
	var selected: Bool
	var action: () -> Void
	@State private var hover = false

	var body: some View {
		Button(action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				HStack(spacing: DS.Metrics.s2) {
					Text(model.title(ofCase: item)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					Spacer(minLength: 0)
					if item.status != .ready { LearningChip(LearningText.caseStatus(item.status), tint: item.status == .error ? DS.Palette.danger : DS.Palette.textSecondary) }
				}
				let types = item.goals.map(\.type).filter { !$0.isEmpty }
				if !types.isEmpty {
					FlowLayout(spacing: DS.Metrics.s1) { ForEach(Array(types.enumerated()), id: \.offset) { _, t in LearningChip(t) } }
				}
				Text(model.sessionTitles(of: item).joined(separator: ", ")).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
				HStack(spacing: DS.Metrics.s2) {
					if let p = item.playbook { Text(p).font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1) }
					Spacer(minLength: 0)
					if let d = ISO.parse(item.updatedAt) { Text(d.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
				}
			}
			.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(selected ? DS.Palette.selection : (hover ? DS.Palette.hover : .clear), in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.onHover { hover = $0 }
	}
}
