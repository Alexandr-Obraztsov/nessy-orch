import SwiftUI
import NessyKit

/// Отчёт ревью: шесть ступеней с вердиктом, critical и замечаниями. Тот же вид — в «Журнале» у записей с отчётом.
struct ReviewReportView: View {
	var report: ReviewReport

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s2) {
				Image(systemName: report.passed ? "checkmark.circle.fill" : "xmark.octagon.fill")
					.foregroundStyle(report.passed ? DS.Palette.accentText : DS.Palette.danger)
				Text(report.passed ? "Ревью пройдено" : "Ревью не пройдено").font(DS.Typography.agentName)
				Text("v\(report.version)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary)
				if let t = ISO.parse(report.ts) { Text(t.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
				Spacer(minLength: 0)
			}
			ForEach(report.stages.sorted { $0.stage < $1.stage }) { s in stage(s) }
		}
	}

	private func stage(_ s: StageReport) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(spacing: DS.Metrics.s2) {
				Image(systemName: icon(s.verdict)).foregroundStyle(s.verdict == .fail ? DS.Palette.danger : DS.Palette.textSecondary).frame(width: 16)
				Text("\(s.stage). \(PlaybookEditing.reviewStage(s.stage))").font(DS.Typography.secondary.weight(.semibold))
				Text(PlaybookEditing.verdict(s.verdict)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: 0)
			}
			ForEach(Array(s.critical.enumerated()), id: \.offset) { _, c in
				Label(c, systemImage: "exclamationmark.triangle.fill").font(DS.Typography.caption).foregroundStyle(DS.Palette.danger)
					.textSelection(.enabled).padding(.leading, 24)
			}
			ForEach(Array(s.notes.enumerated()), id: \.offset) { _, n in
				Text("· " + n).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled).padding(.leading, 24)
			}
		}
	}

	private func icon(_ v: StageVerdict) -> String {
		switch v {
		case .pass: "checkmark.circle"
		case .fail: "xmark.circle"
		case .skip: "minus.circle"
		case .unknown: "questionmark.circle"
		}
	}
}

/// Вкладка «Ревью»: решение по плейбуку на ревью, правки улучшателя «было → стало», последний отчёт и запуск ревью.
struct PlaybookReviewTab: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView
	var detail: PlaybookDetail?
	@State private var askApprove = false
	@State private var rejecting = false
	@State private var reason = ""

	private var learning: LearningStore { model.store.learning }
	private var reviewing: Bool { learning.jobs.contains { $0.kind == .review && $0.subject == playbook.id && ($0.status == .queued || $0.status == .running) } }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			if playbook.status == .review { decision }
			if !playbook.pendingEdits.isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					DSGroupHeader(title: "Правки ждут решения", count: playbook.pendingEdits.count)
					ForEach(playbook.pendingEdits) { EditCard(playbookId: playbook.id, edit: $0) }
				}
			}
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				HStack {
					DSGroupHeader(title: "Последнее ревью")
					Button(reviewing ? "Ревью идёт…" : "Запустить ревью") { run() }
						.buttonStyle(SettingsButtonStyle()).disabled(reviewing || model.isOffline)
				}
				if let r = PlaybookEditing.latestReview(detail?.reviews ?? []) {
					ReviewReportView(report: r).padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
				} else {
					Text(detail == nil ? "Загружаю…" : "Ревью ещё не было.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
			}
		}
	}

	private var decision: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			Label("Плейбук ждёт вашего решения", systemImage: "hourglass").font(DS.Typography.agentName)
			Text("Авто-ревью выключено или не пройдено: одобрите плейбук, чтобы он стал пробным, или отклоните с причиной.")
				.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
			if rejecting {
				TextField("Причина (необязательно)", text: $reason, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
			}
			HStack(spacing: DS.Metrics.s2) {
				if rejecting {
					Button("Отклонить") {
						let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
						Task { await model.run("Плейбук не отклонён") { _ = try await model.store.client.rejectPlaybook(playbook.id, reason: r.isEmpty ? nil : r) } }
						rejecting = false; reason = ""
					}
					Button("Отмена") { rejecting = false; reason = "" }
				} else {
					Button("Одобрить") { askApprove = true }
					Button("Отклонить с причиной") { rejecting = true }
				}
			}
			.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline)
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
		.confirmationDialog("Одобрить плейбук?", isPresented: $askApprove) {
			Button("Одобрить") { Task { await model.run("Плейбук не одобрен") { _ = try await model.store.client.approvePlaybook(playbook.id) } } }
		} message: { Text(PlaybookEditing.approveConfirm(playbook)) }
	}

	private func run() {
		Task {
			await model.run("Ревью не запущено") { _ = try await model.store.client.reviewPlaybook(playbook.id) }
			await learning.refresh()
		}
	}
}

/// Правка улучшателя: файл, кейс-источник с якорем, «было → стало», «Принять» и «Отклонить».
private struct EditCard: View {
	@Environment(AppModel.self) private var model
	var playbookId: String
	var edit: PendingEdit

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(spacing: DS.Metrics.s2) {
				LearningChip(PlaybookEditing.editTarget(edit.file), systemImage: "doc.text", mono: true)
				if !edit.caseId.isEmpty {
					Button { model.background.go(.cases, id: edit.caseId) } label: { LearningChip(caseName, systemImage: "tray.full") }
						.buttonStyle(.plain).help("Открыть кейс-источник")
					if let a = AnchorButton(caseId: edit.caseId, anchor: edit.anchor) { a }
				}
				Spacer(minLength: 0)
				if let t = ISO.parse(edit.createdAt) { Text(t.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
			}
			block("было", edit.before, tint: DS.Palette.textSecondary)
			block("стало", edit.after, tint: DS.Palette.textPrimary)
			HStack(spacing: DS.Metrics.s2) {
				Button("Принять") { Task { await model.run("Правка не принята") { _ = try await model.store.client.acceptEdit(playbookId, hash: edit.hash) } } }
				Button("Отклонить") { Task { await model.run("Правка не отклонена") { _ = try await model.store.client.rejectEdit(playbookId, hash: edit.hash) } } }
				Spacer(minLength: 0)
			}
			.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline)
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}

	private var caseName: String { model.store.learning.caseView(edit.caseId).map { model.title(ofCase: $0) } ?? edit.caseId }

	private func block(_ label: String, _ text: String, tint: Color) -> some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(label).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
			Text(text.isEmpty ? "(пусто)" : text).font(DS.Typography.mono).foregroundStyle(tint).textSelection(.enabled)
				.padding(DS.Metrics.s2).frame(maxWidth: .infinity, alignment: .leading)
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s1 + 2, style: .continuous))
		}
	}
}
