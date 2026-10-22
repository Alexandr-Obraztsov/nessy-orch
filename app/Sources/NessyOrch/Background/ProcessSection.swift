import SwiftUI
import NessyKit

/// Раздел «В процессе»: слева сессии «Ждут обработки» и «Обрабатываются», справа — агент обрабатываемой (чат и промежуточный результат).
struct ProcessSection: View {
	@Environment(AppModel.self) private var model

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		let waiting = BackgroundLogic.waiting(learning.jobs), processing = BackgroundLogic.processing(learning.jobs)
		if waiting.isEmpty && processing.isEmpty && model.background.objectId == nil {
			LearningEmptyState("Сейчас ничего не обрабатывается", systemImage: "tray",
				message: learning.loaded ? "Сессии описываются сами, пока вы работаете." : "Данные появятся, как только приложение свяжется с оркестратором.")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else {
			HStack(spacing: 0) {
				list(waiting, processing).frame(width: 300)
				DSVerticalSeparator()
				detail(waiting, processing).frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
	}

	private func title(_ j: JobView) -> String {
		BackgroundLogic.jobTitle(j, fallback: learning.caseView(j.caseId).map { model.title(ofCase: $0) } ?? "Сессия")
	}

	private func list(_ waiting: [JobView], _ processing: [JobView]) -> some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s4) {
				group("Обрабатываются", processing)
				group("Ждут обработки", waiting)
			}
			.padding(.horizontal, DS.Metrics.s2).padding(.vertical, DS.Metrics.s3)
		}
	}

	@ViewBuilder private func group(_ name: String, _ jobs: [JobView]) -> some View {
		if !jobs.isEmpty {
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				DSGroupHeader(title: name, count: jobs.count)
				ForEach(jobs) { j in
					ListRowButton(selected: model.background.objectId == j.id) { model.background.go(.work, id: j.id) } content: {
						HStack(spacing: DS.Metrics.s2) {
							if j.status == .running { ProgressView().controlSize(.small) }
							Text(title(j)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
							Spacer(minLength: 0)
						}
					}
				}
			}
		}
	}

	@ViewBuilder private func detail(_ waiting: [JobView], _ processing: [JobView]) -> some View {
		if let id = model.background.objectId, let j = (processing + waiting).first(where: { $0.id == id }) {
			if j.status == .running {
				ProcessCard(job: j, title: title(j)).id(j.id)
			} else {
				LearningEmptyState(title(j), systemImage: "hourglass", message: "Ждёт обработки.")
			}
		} else if let id = model.background.objectId, let j = learning.jobs.first(where: { $0.id == id }), j.status == .done {
			finished(j)
		} else if model.background.objectId != nil, learning.loaded {
			LearningEmptyState("Сессия обработана", systemImage: "checkmark.circle", message: "Её больше нет в очереди.")
		} else {
			LearningEmptyState("Выберите сессию", systemImage: "tray", message: "Слева — сессии, которые описывает фон.")
		}
	}

	/// Задание закончилось, пока карточка была открыта: кейс уже в «Кейсах».
	private func finished(_ j: JobView) -> some View {
		VStack(spacing: DS.Metrics.s3) {
			LearningEmptyState("Сессия обработана", systemImage: "checkmark.circle", message: title(j))
			if learning.caseView(j.caseId) != nil {
				Button("Открыть кейс") { model.background.go(.cases, id: j.caseId) }.buttonStyle(SettingsButtonStyle())
			}
		}
		.frame(maxWidth: .infinity)
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
			HStack(spacing: DS.Metrics.s3) {
				Text(title).font(DS.Typography.panelTitle).lineLimit(1)
				Spacer(minLength: DS.Metrics.s2)
				Picker("Вкладка", selection: $tab) {
					ForEach(ProcessTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
				}
				.pickerStyle(.segmented).labelsHidden().fixedSize()
			}
			.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
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
					LearningEmptyState("Агент запускается", systemImage: "hourglass")
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
			GeometryReader { geo in
				ZStack(alignment: .leading) {
					Capsule().fill(DS.Palette.separator)
					Capsule().fill(DS.Palette.textSecondary).frame(width: max(DS.Metrics.progressSize.height, geo.size.width * BackgroundLogic.progressFraction(progress)))
				}
			}
			.frame(height: DS.Metrics.progressSize.height)
			.animation(DS.Motion.progress, value: BackgroundLogic.progressFraction(progress))
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
					Text("Агент ещё ничего не сохранил").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
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
