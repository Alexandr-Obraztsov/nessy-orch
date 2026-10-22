import SwiftUI
import NessyKit

/// Раздел «Журнал»: что фон решил и поменял — плоская лента по дням.
struct JournalSection: View {
	@Environment(AppModel.self) private var model

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		let days = JournalLogic.days(learning.journal)
		ScrollView {
			LazyVStack(alignment: .leading, spacing: DS.Metrics.s5) {
				if days.isEmpty {
					LearningEmptyState("Журнал пуст")
				}
				ForEach(days) { day in
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						DSGroupHeader(title: JournalLogic.dayTitle(day.start), count: day.entries.count)
						LazyVStack(spacing: 0) {
							ForEach(Array(day.entries.enumerated()), id: \.element.id) { i, e in
								if i > 0 { DSSeparator(leading: DS.Metrics.s4) }
								JournalRow(entry: e)
							}
						}
						.dsGroup()
					}
				}
			}
			.padding(DS.Metrics.s5)
			.frame(maxWidth: 820, alignment: .leading)
			.frame(maxWidth: .infinity)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
	}
}

/// Строка: время, вид, объект названием (ссылка) и краткое описание.
private struct JournalRow: View {
	@Environment(AppModel.self) private var model
	var entry: JournalEntry

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			Text(ISO.parse(entry.ts)?.formatted(date: .omitted, time: .shortened) ?? "—")
				.font(DS.Typography.timer).foregroundStyle(DS.Palette.textTertiary).frame(width: 44, alignment: .leading)
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: DS.Metrics.s2) {
					Text(LearningText.journalKind(entry.kind)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary)
					subject
				}
				if !entry.summary.isEmpty {
					Text(entry.summary).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// Объект записи: название плейбука или кейса, нажатие открывает его; удалённого нет — подписи нет.
	@ViewBuilder private var subject: some View {
		let l = model.store.learning
		switch JournalLogic.target(entry) {
		case .playbook(let id)?:
			if let p = l.playbook(id) {
				Button { model.background.go(.playbooks, id: id) } label: { LearningChip(p.title, systemImage: "book.closed", tint: DS.Palette.accentText) }
					.buttonStyle(.plain).help("Открыть плейбук")
			}
		case .caseView(let id)?:
			if let c = l.caseView(id) {
				Button { model.background.go(.cases, id: id) } label: { LearningChip(model.title(ofCase: c), systemImage: "tray.full", tint: DS.Palette.accentText) }
					.buttonStyle(.plain).help("Открыть кейс")
			}
		case nil: EmptyView()
		}
	}
}
