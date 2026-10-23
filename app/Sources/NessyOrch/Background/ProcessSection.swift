import SwiftUI
import NessyKit

/// Раздел «В процессе»: карточки сессий «В работе» и «В очереди»; клик по обрабатываемой открывает справа её агента
/// (чат и промежуточный результат).
struct ProcessSection: View {
	@Environment(AppModel.self) private var model

	private var learning: LearningStore { model.store.learning }

	/// Название сессии: локально найденное по кейсу, иначе от сервера.
	private func title(_ j: JobView) -> String {
		let local = learning.caseView(j.caseId).flatMap { c -> String? in
			let t = model.store.session(c.sessions.first ?? "")?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			return t.isEmpty ? nil : t
		}
		return local ?? BackgroundLogic.jobTitle(j, fallback: learning.caseView(j.caseId).map { model.title(ofCase: $0) } ?? "Сессия")
	}

	var body: some View {
		let waiting = BackgroundLogic.waiting(learning.jobs), processing = BackgroundLogic.processing(learning.jobs)
		let selected = model.background.objectId.flatMap { id in processing.first { $0.id == id } }
		BackgroundSplit(open: selected != nil) {
			if waiting.isEmpty && processing.isEmpty {
				LearningEmptyState("Нет сессий").frame(maxHeight: .infinity)
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: DS.Metrics.s5) {
						CardGroup(title: "В работе", items: processing) { j in
							JobTile(job: j, title: title(j), selected: model.background.objectId == j.id) { model.background.toggle(.work, id: j.id) }
						}
						CardGroup(title: "В очереди", items: waiting) { j in JobTile(job: j, title: title(j), selected: false, action: nil) }
					}
					.padding(DS.Metrics.s4)
				}
			}
		} panel: {
			if let j = selected { ProcessCard(job: j, title: title(j)).id(j.id) }
		}
	}
}

/// Карточка сессии: название и статус; у обрабатываемой — прогресс чтения.
private struct JobTile: View {
	var job: JobView
	var title: String
	var selected: Bool
	var action: (() -> Void)?

	var body: some View {
		let content = VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(title).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(2).multilineTextAlignment(.leading)
			Spacer(minLength: 0)
			if job.status == .running {
				Text(BackgroundLogic.progressLine(job.progress)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).monospacedDigit()
				ProgressBar(progress: job.progress)
			} else {
				LearningChip("в очереди")
			}
		}
		if let action { CardButton(selected: selected, action: action) { content } }
		else {
			content.padding(DS.Metrics.s4).frame(maxWidth: .infinity, minHeight: CardMetrics.height, maxHeight: CardMetrics.height, alignment: .topLeading)
				.background(DS.Palette.surface, in: RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous))
				.overlay(RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous).strokeBorder(DS.Palette.border, lineWidth: DS.Metrics.hairline))
		}
	}
}

// MARK: - Агент сессии

private enum ProcessTab: String, CaseIterable { case chat = "Чат", result = "Результат" }

/// Обрабатываемая сессия: две вкладки — чат агента-сборщика (внизу прогресс чтения вместо плана) и промежуточный результат.
private struct ProcessCard: View {
	@Environment(AppModel.self) private var model
	var job: JobView
	var title: String
	@State private var tab = ProcessTab.chat

	var body: some View {
		VStack(spacing: 0) {
			PanelHeader(title) { }
			// вкладки под названием: в узком блоке название не сжимается до «Оче…»
			Picker("Вкладка", selection: $tab) {
				ForEach(ProcessTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
			}
			.pickerStyle(.segmented).labelsHidden()
			.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
			DSSeparator()
			switch tab {
			case .chat: ProcessChat(job: job)
			case .result: ProcessResult(job: job)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.clipped()
	}
}

/// Чат агента по `job.agentId`: тот же `ChatContent` и поле ввода, что в блоке «Агенты»; сообщение сразу прерывает агента.
private struct ProcessChat: View {
	@Environment(AppModel.self) private var model
	var job: JobView
	@State private var chat: ChatModel?

	private var agent: AgentView? { job.agentId.flatMap { model.store.agents[$0] } }

	var body: some View {
		// размер берём у контейнера (как панель агента): иначе длинная лента чата растягивает окно за экран
		GeometryReader { geo in
			Group {
				if let a = agent {
					ChatContent(agent: a, chat: chat, goal: model.store.goal(of: a))
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.safeAreaBar(edge: .bottom, spacing: 0) {
							VStack(spacing: DS.Metrics.s2) {
								ProgressStrip(progress: job.progress).padding(.horizontal, DS.Metrics.s3)
								AgentComposer(agent: a, interrupt: true)
							}
							.fixedSize(horizontal: false, vertical: true)
						}
				} else {
					LearningEmptyState("Агент запускается")
				}
			}
			.frame(width: geo.size.width, height: geo.size.height)
			.clipped()
		}
		.task(id: job.agentId) {
			chat?.stop()
			guard let ref = job.agentId else { chat = nil; return }
			let c = ChatModel(ref: ref)
			chat = c
			c.start(client: model.store.client)
		}
		.onDisappear { chat?.stop() }
	}
}

/// «Прочитано N из M событий» и полоса; вместо плана внизу чата.
private struct ProgressStrip: View {
	var progress: JobProgress?

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(BackgroundLogic.progressLine(progress)).font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textSecondary).monospacedDigit()
			ProgressBar(progress: progress)
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsFloatingCard(tint: DS.Palette.planSurface)
	}
}

/// Промежуточный результат: черновик, который агент уже сохранил; перечитывается по событиям задания и кейса.
private struct ProcessResult: View {
	@Environment(AppModel.self) private var model
	var job: JobView
	@State private var draft: String?
	@State private var token = RequestToken()

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		ScrollView {
			Group {
				if let d = draft, !BackgroundLogic.draftText(d).isEmpty {
					MarkdownView(text: BackgroundLogic.draftText(d))
				} else {
					Text("Пока пусто").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
			}
			.padding(DS.Metrics.s5)
			.frame(maxWidth: 820, alignment: .leading)
			.frame(maxWidth: .infinity)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.task(id: key) { await load() }
	}

	/// Когда перечитывать: прогресс задания (агент сохранил блок) и обновление кейса.
	private var key: String {
		"\(job.id)|\(job.progress?.read ?? -1)|\(learning.caseView(job.caseId)?.updatedAt ?? "")"
	}

	private func load() async {
		let t = token.next()
		let d = try? await model.store.client.caseDetail(job.caseId)
		if token.isCurrent(t), let d { draft = d.draft }
	}
}
