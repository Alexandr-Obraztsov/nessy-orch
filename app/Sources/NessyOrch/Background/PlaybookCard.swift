import SwiftUI
import NessyKit

/// Плейбук целиком, только чтение: блоки сворачиваются (когда применять, скилл, правила, этапы, файлы и источники, инструменты).
/// Для плейбука на ревью — «Одобрить» и «Отклонить»; «Удалить…» в меню.
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
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s5) {
					header(p)
					when(p)
					skill
					rules(p)
					stages(p)
					materials(p)
					tools(p)
				}
				.padding(DS.Metrics.s5)
				.frame(maxWidth: 820, alignment: .leading)
				.frame(maxWidth: .infinity)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
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
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			CardHeader(p.title, subtitle: [LearningText.playbookStatus(p.status), "v\(p.version)", p.taskType].filter { !$0.isEmpty }.joined(separator: " · ")) {
				if p.status == .review {
					Button("Одобрить") { askApprove = true }
					Button("Отклонить") { Task { await model.run("Плейбук не отклонён") { _ = try await model.store.client.rejectPlaybook(p.id) } } }
				}
				Menu {
					Button("Удалить…", role: .destructive) { askDelete = true }
				} label: { Image(systemName: "ellipsis") }
					.menuStyle(.button).buttonStyle(SettingsButtonStyle()).menuIndicator(.hidden).fixedSize()
			}
			if let line = BackgroundLogic.trialLine(p) {
				Text("Пробный режим: \(line)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			}
		}
		.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline)
	}

	private func delete(_ p: PlaybookView) {
		Task {
			await model.run("Плейбук не удалён") {
				try await model.store.client.deletePlaybook(p.id)
				await MainActor.run { model.background.go(.playbooks) }
			}
		}
	}

	// MARK: блоки

	private func when(_ p: PlaybookView) -> some View {
		Collapsible("Когда применять") {
			Text(BackgroundLogic.inline(p.description.isEmpty ? "Описание не задано." : p.description))
				.font(DS.Typography.secondary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	@ViewBuilder private var skill: some View {
		if let text = detail?.files["SKILL.md"], !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			Collapsible("Скилл", open: false) {
				MarkdownView(text: text).padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
			}
		}
	}

	@ViewBuilder private func rules(_ p: PlaybookView) -> some View {
		let g = BackgroundLogic.ruleGroups(p)
		if !p.rules.isEmpty {
			Collapsible("Правила", count: g.active.count) {
				VStack(alignment: .leading, spacing: DS.Metrics.s3) {
					if g.active.isEmpty { Text("Включённых правил нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary) }
					ForEach(g.active) { rule($0) }
					if !g.candidates.isEmpty { Collapsible("Кандидаты", count: g.candidates.count, open: false) { ForEach(g.candidates) { rule($0) } } }
					if !g.archived.isEmpty { Collapsible("Архив", count: g.archived.count, open: false) { ForEach(g.archived) { rule($0) } } }
				}
			}
		}
	}

	private func rule(_ r: RuleView) -> some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			Text(BackgroundLogic.inline(r.text)).font(DS.Typography.secondary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
			if r.up > 0 || r.down > 0 {
				Text("▲\(r.up) ▼\(r.down)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary).fixedSize()
			}
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}

	@ViewBuilder private func stages(_ p: PlaybookView) -> some View {
		if !p.stages.isEmpty {
			Collapsible("Этапы", count: p.stages.count) {
				VStack(spacing: DS.Metrics.s2) { ForEach(p.stages) { StageBlock(stage: $0) } }
			}
		}
	}

	@ViewBuilder private func materials(_ p: PlaybookView) -> some View {
		if !p.params.isEmpty || !p.sources.isEmpty || !p.files.isEmpty || !p.behavior.isEmpty {
			Collapsible("Файлы и источники") {
				VStack(alignment: .leading, spacing: DS.Metrics.s4) {
					if !p.params.isEmpty {
						labeled("Параметры") {
							ForEach(p.params) { q in
								HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
									Text(q.name).font(DS.Typography.mono)
									Text(q.description).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
									if !q.source.isEmpty { LearningChip(q.source) }
								}
							}
						}
					}
					if !p.sources.isEmpty { labeled("Источники") { SourceChips(sources: p.sources) } }
					if !p.files.isEmpty { labeled("Ключевые файлы") { ForEach(p.files, id: \.self) { Text($0).font(DS.Typography.mono).textSelection(.enabled) } } }
					if !p.behavior.isEmpty {
						labeled("Как себя вести") {
							ForEach(Array(p.behavior.enumerated()), id: \.offset) { _, b in Text(BackgroundLogic.inline("· " + b)).font(DS.Typography.secondary).textSelection(.enabled) }
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
	}

	private func labeled<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(title).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
			content()
		}
	}

	@ViewBuilder private func tools(_ p: PlaybookView) -> some View {
		if !p.tools.isEmpty {
			Collapsible("Инструменты", count: p.tools.count) {
				VStack(spacing: DS.Metrics.s2) { ForEach(p.tools) { ToolBlock(tool: $0) } }
			}
		}
	}
}

/// Этап: сворачивается; внутри «где», «выдаёт», «готово, когда».
private struct StageBlock: View {
	var stage: PlaybookStage
	@State private var open = true

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } } label: {
				HStack(spacing: DS.Metrics.s2) {
					Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary)
						.rotationEffect(.degrees(open ? 90 : 0))
					Text("\(stage.n). \(stage.title)").font(DS.Typography.agentName).multilineTextAlignment(.leading)
					if stage.gate { LearningChip("гейт: показать вам", systemImage: "hand.raised", tint: DS.Palette.accentText) }
					if let r = stage.role, !r.isEmpty { LearningChip(r, mono: true) }
					Spacer(minLength: 0)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if open {
				ForEach([("где", stage.where), ("выдаёт", stage.produce), ("готово, когда", stage.done)].filter { !$0.1.isEmpty }, id: \.0) { k, v in
					HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
						Text(k).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 90, alignment: .leading)
						Text(BackgroundLogic.inline(v)).font(DS.Typography.secondary).textSelection(.enabled)
					}
				}
			}
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}
}

/// Инструмент плейбука: имя, описание; содержимое скрипта моноширинным, свёрнуто.
private struct ToolBlock: View {
	var tool: PlaybookTool
	@State private var open = false

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
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
				Text(BackgroundLogic.inline(tool.description)).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
			}
			if open {
				ScrollView(.horizontal) {
					Text(tool.content).font(DS.Typography.monoCaption).textSelection(.enabled).padding(DS.Metrics.s2)
				}
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			}
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}
}
