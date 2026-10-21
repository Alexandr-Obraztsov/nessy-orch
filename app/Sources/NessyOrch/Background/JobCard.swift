import SwiftUI
import NessyKit

/// Карточка задания (раздел «Работа»): строка с состоянием и ходом; раскрывается на месте — поручение и ответ агента, живой чат, кнопки.
struct JobCard: View {
	@Environment(AppModel.self) private var model
	var job: JobView
	@State private var expanded = false
	@State private var detail: JobDetail?
	@State private var chat: ChatModel?

	private var learning: LearningStore { model.store.learning }
	private var agent: AgentView? { job.agentId.flatMap { model.store.agents[$0] } }
	/// агент жив: идёт его ход — показываем живой чат вместо готового ответа
	private var liveAgent: AgentView? { agent.flatMap { $0.isFinished ? nil : $0 } }
	private var caseView: CaseView? { job.caseId.isEmpty ? nil : learning.caseView(job.caseId) }
	private var sessionId: String? { caseView?.sessions.last }

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { expanded.toggle() } } label: { header }
				.buttonStyle(.plain)
			if job.status == .error, let e = job.error, !e.isEmpty {
				Text(e).font(DS.Typography.caption).foregroundStyle(DS.Palette.danger).lineLimit(expanded ? nil : 2)
					.textSelection(.enabled)
					.padding(.horizontal, DS.Metrics.s3).padding(.bottom, DS.Metrics.s2).padding(.leading, DS.Metrics.rowTextX - DS.Metrics.s3)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
			if expanded { details }
		}
		.dsGroup()
		.task(id: "\(expanded)-\(job.status)-\(job.agentId ?? "")") { await load() }
		.onDisappear { chat?.stop(); chat = nil }
	}

	// MARK: строка

	private var header: some View {
		HStack(spacing: DS.Metrics.s3) {
			DSStateGlyph(state: glyph)
			VStack(alignment: .leading, spacing: 2) {
				Text(LearningText.step(job)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary)
				Text(subtitle).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
			}
			Spacer(minLength: DS.Metrics.s2)
			trailing
			Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary)
				.rotationEffect(.degrees(expanded ? 90 : 0))
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.contentShape(Rectangle())
	}

	private var glyph: DS.AgentState {
		switch job.status {
		case .running: .working
		case .error: .error
		case .done: .done
		default: .idle
		}
	}

	/// Над чем работа: сессия кейса, плейбук или все кейсы; у очереди — пометка («ждёт пачку бэкфилла»).
	private var subtitle: String {
		var parts: [String] = []
		if let c = caseView { parts.append(model.title(ofCase: c)) }
		else if job.subject.hasPrefix("p-") { parts.append(learning.playbook(job.subject)?.title ?? job.subject) }
		else if job.subject == "all" { parts.append("по всем кейсам") }
		else if !job.caseId.isEmpty { parts.append(job.caseId) }
		if job.status == .queued, let n = LearningText.queueNote(job, among: learning.jobs) { parts.append(n) }
		if job.attempts > 1 { parts.append("попытка \(job.attempts)") }
		return parts.joined(separator: " · ")
	}

	@ViewBuilder private var trailing: some View {
		switch job.status {
		case .running:
			if let start = ISO.parse(job.startedAt) {
				TimelineView(.periodic(from: .now, by: 1)) { ctx in
					Text(LearningText.elapsed(since: start, now: model.frozenAt ?? ctx.date) ?? "").font(DS.Typography.timer).foregroundStyle(DS.Palette.textSecondary)
				}
			}
		case .done:
			if let f = ISO.parse(job.finishedAt) { Text(f.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
		case .error:
			Button("Повторить") { retry() }.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline)
		default:
			EmptyView()
		}
	}

	// MARK: раскрытое

	private var details: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			DSSeparator()
			if let a = liveAgent {
				ChatContent(agent: a, chat: chat, goal: model.store.goal(of: a))
					.frame(height: 340)
					.clipShape(RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			} else if let d = detail, !d.runs.isEmpty {
				ForEach(d.runs) { r in
					VStack(alignment: .leading, spacing: DS.Metrics.s1) {
						Text(r.name).font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary)
						LongText(r.text, lines: 8)
					}
				}
			} else if detail == nil && job.agentId != nil {
				ProgressView().controlSize(.small)
			} else {
				Text(job.status == .queued ? "Агент ещё не запущен." : "Поручения и ответа агента нет.")
					.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
			}
			actions
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.bottom, DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var actions: some View {
		HStack(spacing: DS.Metrics.s2) {
			if let a = liveAgent, a.canStop {
				Button("Остановить") { model.stop(a) }.disabled(model.isOffline)
			}
			if let s = sessionId { Button("Открыть сессию") { model.show(session: s) } }
			if !job.caseId.isEmpty, caseView != nil { Button("Открыть кейс") { model.background.go(.cases, id: job.caseId) } }
			if job.status == .error { Button("Повторить") { retry() }.disabled(model.isOffline) }
			Spacer(minLength: 0)
		}
		.buttonStyle(SettingsButtonStyle())
	}

	// MARK: загрузка и действия

	private func load() async {
		guard expanded else { chat?.stop(); chat = nil; return }
		if job.agentId != nil || job.status == .done || job.status == .error {
			detail = try? await model.store.client.job(job.id)
		}
		if let a = liveAgent, chat?.ref != a.id {
			chat?.stop()
			let c = ChatModel(ref: a.id)
			chat = c
			c.start(client: model.store.client)
		} else if liveAgent == nil { chat?.stop(); chat = nil }
	}

	private func retry() {
		Task { await model.run("Повтор задания") { try await model.store.client.retryJob(job.id) } }
	}
}
