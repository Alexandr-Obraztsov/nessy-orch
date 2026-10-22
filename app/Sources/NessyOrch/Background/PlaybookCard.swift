import SwiftUI
import NessyKit

/// Плейбук целиком, только чтение: описание под шапкой, дальше разделы прямо на поверхности панели (правила, этапы, параметры,
/// источники, файлы; кандидаты, архив, инструменты и скилл свёрнуты). Для плейбука на ревью — «Одобрить» и «Отклонить»; «Удалить…» в «⋯».
struct PlaybookCard: View {
	@Environment(AppModel.self) private var model
	var id: String
	@State private var detail: PlaybookDetail?
	@State private var askDelete = false
	@State private var askApprove = false
	@State private var token = RequestToken()

	private var learning: LearningStore { model.store.learning }
	private var playbook: PlaybookView? { learning.playbook(id) }

	var body: some View {
		if let p = playbook {
			VStack(spacing: 0) {
				header(p)
				ScrollView {
					VStack(alignment: .leading, spacing: 0) {
						description(p)
						rules(p)
						stages(p)
						materials(p)
						tools(p)
						skill
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
				.scrollEdgeEffectStyle(.soft, for: .top)
			}
			.task(id: loadKey(p)) { await reload() }
			.confirmationDialog(BackgroundLogic.deletePlaybookTitle(p), isPresented: $askDelete) {
				Button("Удалить", role: .destructive) { delete(p) }
			} message: { Text(BackgroundLogic.deletePlaybookMessage) }
			.confirmationDialog("Одобрить плейбук?", isPresented: $askApprove) {
				Button("Одобрить") { Task { await model.run("Плейбук не одобрен") { _ = try await model.store.client.approvePlaybook(p.id) } } }
			} message: { Text(BackgroundLogic.approveMessage(p)) }
		}
	}

	/// Когда перечитывать подробности: новая версия, статус, закончившееся задание.
	private func loadKey(_ p: PlaybookView) -> String {
		let done = learning.jobs.filter { $0.subject == p.id && $0.status == .done }.count
		return "\(p.id)-\(p.version)-\(p.status.rawValue)-\(p.updatedAt)-\(done)"
	}

	private func reload() async {
		let t = token.next()
		let d = try? await model.store.client.playbookDetail(id)
		if token.isCurrent(t), let d { detail = d }
	}

	private func header(_ p: PlaybookView) -> some View {
		let meta = [p.taskType, LearningText.playbookStatus(p.status), "v\(p.version)", BackgroundLogic.trialLine(p).map { "пробный: \($0)" }]
			.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
		return PanelHeader(p.title, subtitle: meta, onDelete: { askDelete = true }) {
			if p.status == .review {
				Button("Одобрить") { askApprove = true }
				Button("Отклонить") { Task { await model.run("Плейбук не отклонён") { _ = try await model.store.client.rejectPlaybook(p.id) } } }
			}
		}
	}

	private func delete(_ p: PlaybookView) {
		Task {
			await model.run("Плейбук не удалён") {
				try await model.store.client.deletePlaybook(p.id)
				await MainActor.run { model.background.close() }
			}
		}
	}

	// MARK: блоки

	private func description(_ p: PlaybookView) -> some View {
		Text(BackgroundLogic.inline(p.description.isEmpty ? "Описание не задано." : p.description))
			.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
	}

	@ViewBuilder private var skill: some View {
		if let text = detail?.files["SKILL.md"], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			Collapsible("Скилл", open: false) { MarkdownView(text: text).frame(maxWidth: .infinity, alignment: .leading) }
		}
	}

	@ViewBuilder private func rules(_ p: PlaybookView) -> some View {
		let g = BackgroundLogic.ruleGroups(p)
		if !g.active.isEmpty { Collapsible("Правила", count: g.active.count) { ruleList(g.active) } }
		if !g.candidates.isEmpty { Collapsible("Кандидаты", count: g.candidates.count, open: false) { ruleList(g.candidates) } }
		if !g.archived.isEmpty { Collapsible("Архив", count: g.archived.count, open: false) { ruleList(g.archived) } }
	}

	/// Правила строками с тонкими разделителями; голоса «▲n ▼n» — тихие моно-цифры.
	private func ruleList(_ rules: [RuleView]) -> some View {
		VStack(spacing: 0) {
			ForEach(Array(rules.enumerated()), id: \.element.id) { i, r in
				if i > 0 { DSSeparator() }
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
					Text(BackgroundLogic.inline(r.text)).font(DS.Typography.secondary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
					if r.up > 0 || r.down > 0 {
						Text("▲\(r.up) ▼\(r.down)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary).fixedSize()
					}
				}
				.padding(.vertical, DS.Metrics.s2)
			}
		}
	}

	@ViewBuilder private func stages(_ p: PlaybookView) -> some View {
		if !p.stages.isEmpty {
			Collapsible("Этапы", count: p.stages.count) {
				VStack(alignment: .leading, spacing: DS.Metrics.s3) { ForEach(p.stages) { StageRow(stage: $0) } }
			}
		}
	}

	@ViewBuilder private func materials(_ p: PlaybookView) -> some View {
		if !p.params.isEmpty {
			Collapsible("Параметры", count: p.params.count) {
				Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: DS.Metrics.s3, verticalSpacing: DS.Metrics.s1) {
					ForEach(p.params) { q in
						GridRow {
							Text(q.name).font(DS.Typography.mono)
							Text(q.description).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
						}
					}
				}
			}
		}
		if !p.sources.isEmpty { Collapsible("Источники", count: p.sources.count) { SourceChips(sources: p.sources) } }
		if !p.files.isEmpty {
			Collapsible("Файлы", count: p.files.count) {
				VStack(alignment: .leading, spacing: 2) { ForEach(p.files, id: \.self) { Text($0).font(DS.Typography.mono).textSelection(.enabled) } }
			}
		}
		if !p.behavior.isEmpty {
			Collapsible("Как себя вести") {
				VStack(alignment: .leading, spacing: DS.Metrics.s1) {
					ForEach(Array(p.behavior.enumerated()), id: \.offset) { _, b in Text(BackgroundLogic.inline("· " + b)).font(DS.Typography.secondary).textSelection(.enabled) }
				}
			}
		}
	}

	@ViewBuilder private func tools(_ p: PlaybookView) -> some View {
		if !p.tools.isEmpty {
			Collapsible("Инструменты", count: p.tools.count, open: false) {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) { ForEach(p.tools) { ToolRow(tool: $0) } }
			}
		}
	}
}

/// Этап: «n. Название», справа тихо роль; под названием одна-две строки «где · выдаёт · готово» (нажатие раскрывает целиком).
private struct StageRow: View {
	var stage: PlaybookStage
	@State private var open = false

	private var details: String {
		[("где", stage.where), ("выдаёт", stage.produce), ("готово", stage.done)].filter { !$0.1.isEmpty }.map { "\($0.0): \($0.1)" }.joined(separator: " · ")
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
				Text("\(stage.n). \(stage.title)").font(DS.Typography.agentName).multilineTextAlignment(.leading)
				if stage.gate { LearningChip("показать вам", systemImage: "hand.raised") }
				Spacer(minLength: 0)
				if let r = stage.role, !r.isEmpty { Text(r).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
			}
			if !details.isEmpty {
				Text(BackgroundLogic.inline(details)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
					.lineLimit(open ? nil : 2).frame(maxWidth: .infinity, alignment: .leading)
					.contentShape(Rectangle())
					.onTapGesture { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } }
			}
		}
		.textSelection(.enabled)
	}
}

/// Инструмент плейбука: имя и описание; содержимое скрипта моноширинным, свёрнуто.
private struct ToolRow: View {
	var tool: PlaybookTool
	@State private var open = false

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } } label: {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary)
						.rotationEffect(.degrees(open ? 90 : 0))
					Text(tool.name).font(DS.Typography.mono)
					Spacer(minLength: 0)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if !tool.description.isEmpty {
				Text(BackgroundLogic.inline(tool.description)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
			}
			if open {
				ScrollView(.horizontal) {
					Text(tool.content).font(DS.Typography.monoCaption).textSelection(.enabled).padding(DS.Metrics.s2)
				}
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}
