import SwiftUI
import NessyKit

/// Раздел «Плейбуки»: карточки (готовые, ниже «В процессе») с поиском; клик открывает справа весь плейбук.
struct PlaybooksSection: View {
	@Environment(AppModel.self) private var model
	@State private var query = ""

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		let open = model.background.objectId.map { learning.playbook($0) != nil } ?? false
		BackgroundSplit(open: open) { cards } panel: {
			if let id = model.background.objectId, open { PlaybookCard(id: id).id(id) }
		}
	}

	@ViewBuilder private var cards: some View {
		if learning.playbooks.isEmpty {
			LearningEmptyState("Нет плейбуков").frame(maxHeight: .infinity)
		} else {
			let g = BackgroundLogic.playbooks(learning.playbooks, jobs: learning.jobs, query: query)
			VStack(spacing: 0) {
				TextField("Поиск", text: $query).textFieldStyle(.roundedBorder)
					.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
				if g.ready.isEmpty && g.inProgress.isEmpty {
					LearningEmptyState("Ничего не найдено").frame(maxHeight: .infinity)
				} else {
					ScrollView {
						VStack(alignment: .leading, spacing: DS.Metrics.s5) {
							group("Готовые", g.ready)
							group("В процессе", g.inProgress)
						}
						.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s4)
					}
				}
			}
		}
	}

	private func group(_ title: String, _ items: [PlaybookView]) -> some View {
		CardGroup(title: title, items: items) { p in
			PlaybookTile(item: p, busy: BackgroundLogic.isBusy(p, jobs: learning.jobs), selected: model.background.objectId == p.id) {
				model.background.toggle(.playbooks, id: p.id)
			}
		}
	}
}

/// Карточка плейбука: название, тип задачи, версия и число кейсов; у ждущего решения — метка, у собирающегося — крутилка.
private struct PlaybookTile: View {
	var item: PlaybookView
	var busy: Bool
	var selected: Bool
	var action: () -> Void

	var body: some View {
		CardButton(selected: selected, action: action) {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				HStack(alignment: .top, spacing: DS.Metrics.s2) {
					Text(item.title).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(2).multilineTextAlignment(.leading)
					Spacer(minLength: 0)
					if busy { ProgressView().controlSize(.small) }
				}
				Spacer(minLength: 0)
				HStack(spacing: DS.Metrics.s1) {
					if !item.taskType.isEmpty { LearningChip(item.taskType, mono: true) }
					if item.status == .review { LearningChip("ждёт вас", dot: DS.Palette.accent) }
					else if let t = BackgroundLogic.trialLine(item) { LearningChip("пробный: \(t)") }
					else { LearningChip(BackgroundLogic.playbookLine(item)) }
					Spacer(minLength: 0)
				}
				.lineLimit(1)
			}
		}
	}
}
