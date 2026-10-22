import SwiftUI
import NessyKit

/// Раздел «Кейсы»: карточки обработанных сессий с поиском; клик открывает справа описание (только чтение).
struct CasesSection: View {
	@Environment(AppModel.self) private var model
	@State private var query = ""

	private var learning: LearningStore { model.store.learning }
	private var selected: CaseView? { model.background.objectId.flatMap { learning.caseView($0) } }

	var body: some View {
		BackgroundSplit(open: selected != nil) { cards } panel: {
			if let c = selected { CaseCard(item: c).id(c.id) }
		}
	}

	private var shown: [CaseView] {
		BackgroundLogic.cases(learning.cases, query: query, titleOf: { model.title(ofCase: $0) }, sessionTitlesOf: { model.sessionTitles(of: $0) })
	}

	@ViewBuilder private var cards: some View {
		if !learning.cases.contains(where: { $0.status == .ready }) {
			LearningEmptyState("Нет кейсов").frame(maxHeight: .infinity)
		} else {
			VStack(spacing: 0) {
				SearchField(text: $query)
					.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
				let items = shown
				if items.isEmpty {
					LearningEmptyState("Ничего не найдено").frame(maxHeight: .infinity)
				} else {
					ScrollView {
						CardGrid(items: items) { c in
							CaseTile(item: c, selected: model.background.objectId == c.id) { model.background.toggle(.cases, id: c.id) }
						}
						.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s4)
					}
				}
			}
		}
	}
}

/// Карточка кейса: название сессии, типы целей и дата.
private struct CaseTile: View {
	@Environment(AppModel.self) private var model
	var item: CaseView
	var selected: Bool
	var action: () -> Void

	var body: some View {
		CardButton(selected: selected, action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				Text(model.title(ofCase: item)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(2).multilineTextAlignment(.leading)
				Spacer(minLength: 0)
				HStack(spacing: DS.Metrics.s1) {
					ForEach(Array(Set(item.goals.map(\.type).filter { !$0.isEmpty })).sorted().prefix(2), id: \.self) { LearningChip($0) }
					Spacer(minLength: DS.Metrics.s1)
					if let d = ISO.parse(item.updatedAt) { Text(d.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).lineLimit(1) }
				}
				.lineLimit(1)
			}
		}
	}
}
