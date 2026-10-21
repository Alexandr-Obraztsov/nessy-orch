import SwiftUI
import NessyKit

/// Раздел «Журнал» (спека §5): что фон решил и поменял, по дням; запись раскрывается в отчёт, откатимое откатывается.
struct JournalSection: View {
	@Environment(AppModel.self) private var model

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		let days = JournalLogic.days(learning.journal)
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s5) {
				if days.isEmpty {
					LearningEmptyState("Журнал пуст", systemImage: "list.bullet.rectangle", message: "Сюда попадают сборка плейбуков, ревью, включение правил и откаты.")
				}
				ForEach(days) { day in
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						DSGroupHeader(title: JournalLogic.dayTitle(day.start), count: day.entries.count)
						VStack(spacing: 0) {
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

/// Строка журнала: время, вид, объект и краткое описание; раскрытая — отчёт и «Откатить».
private struct JournalRow: View {
	@Environment(AppModel.self) private var model
	var entry: JournalEntry
	@State private var open = false
	@State private var askRevert = false
	@State private var busy = false

	private var reverted: Bool { JournalLogic.isReverted(entry) }
	private var report: JournalLogic.Report? { JournalLogic.report(entry) }
	private var hasDetails: Bool { report != nil || JournalLogic.canRevert(entry) }

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button { if hasDetails { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } } } label: { header }
				.buttonStyle(.plain)
			if open { details.transition(.opacity) }
		}
		.opacity(reverted ? 0.55 : 1)
		.confirmationDialog("Откатить это изменение?", isPresented: $askRevert) {
			Button("Откатить", role: .destructive) { revert() }
		} message: { Text("\(LearningText.journalKind(entry.kind)): \(entry.summary)") }
	}

	private var header: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			Text(ISO.parse(entry.ts)?.formatted(date: .omitted, time: .shortened) ?? "—")
				.font(DS.Typography.timer).foregroundStyle(DS.Palette.textTertiary).frame(width: 44, alignment: .leading)
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: DS.Metrics.s2) {
					Text(LearningText.journalKind(entry.kind)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary)
					if reverted { LearningChip("откачено", systemImage: "arrow.uturn.backward") }
					subject
				}
				if !entry.summary.isEmpty {
					Text(entry.summary).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(open ? nil : 2)
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			if hasDetails {
				Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary)
					.rotationEffect(.degrees(open ? 90 : 0))
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.contentShape(Rectangle())
	}

	/// Объект записи: чип-ссылка на карточку плейбука или кейса.
	@ViewBuilder private var subject: some View {
		if let t = JournalLogic.target(entry) {
			Button {
				switch t {
				case .playbook(let id): model.background.go(.playbooks, id: id)
				case .caseView(let id): model.background.go(.cases, id: id)
				}
			} label: { LearningChip(title(t), systemImage: { if case .playbook = t { "book.closed" } else { "tray.full" } }(), tint: DS.Palette.accentText) }
				.buttonStyle(.plain).help("Открыть карточку")
		}
	}

	private func title(_ t: JournalLogic.Target) -> String {
		let l = model.store.learning
		switch t {
		case .playbook(let id): return l.playbook(id)?.title ?? id
		case .caseView(let id): return l.caseView(id).map { model.title(ofCase: $0) } ?? id
		}
	}

	private var details: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			if let r = report {
				if let p = r.prevStatus { Text("Статус до этого: \(p)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
				if let rv = r.review { reviewList(rv) }
			}
			if JournalLogic.canRevert(entry) {
				Button { askRevert = true } label: { Label("Откатить", systemImage: "arrow.uturn.backward") }
					.buttonStyle(.bordered).controlSize(.small).disabled(busy)
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.bottom, DS.Metrics.s3).padding(.leading, 44 + DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// Отчёт ревью простым списком: ступень, вердикт, замечания.
	private func reviewList(_ rv: ReviewReport) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text("Ревью версии \(rv.version): \(rv.passed ? "пройдено" : "не пройдено")").font(DS.Typography.secondary.weight(.semibold))
			ForEach(rv.stages) { s in
				VStack(alignment: .leading, spacing: 2) {
					HStack(spacing: DS.Metrics.s2) {
						Image(systemName: s.verdict == .pass ? "checkmark.circle" : s.verdict == .fail ? "xmark.circle" : "minus.circle")
							.foregroundStyle(s.verdict == .fail ? DS.Palette.danger : DS.Palette.textSecondary)
						Text("Ступень \(s.stage) — \(JournalLogic.verdict(s.verdict))").font(DS.Typography.secondary)
					}
					ForEach(Array((s.critical + s.notes).enumerated()), id: \.offset) { _, n in
						Text("· \(n)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).padding(.leading, DS.Metrics.s5)
					}
				}
			}
		}
	}

	private func revert() {
		busy = true
		Task {
			await model.run("Откат не удался") { _ = try await model.store.client.revertJournal(entry.id) }
			busy = false
			await model.store.learning.refresh()
		}
	}
}
