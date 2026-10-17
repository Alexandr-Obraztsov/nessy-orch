import SwiftUI
import NessyKit

// MARK: - Итог (агент закончил)

/// Итог последнего хода: причина → ответ → источники → счётчики. Пустые блоки не показываются.
struct ResultContent: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var chat: ChatModel?
	var goal: String

	private var text: String? {
		if let r = agent.lastReply, r.failed == nil, let m = model.store.messagesById[r.msgId] { return m.text }
		return chat?.lastAnswer ?? agent.lastReply?.preview
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s5) {
				AgentIntro(agent: agent, goal: goal)
				if agent.state == .error { reason("Ошибка", agent.error ?? "ход завершился ошибкой", DS.Palette.danger) }
				if let text {
					let parsed = ReplyParser.parse(text)
					VStack(alignment: .leading, spacing: DS.Metrics.s3) {
						if let s = parsed.status, s.code != .done {
							reason(s.code == .doneWithConcerns ? "С оговорками" : s.code.label, s.reason.isEmpty ? "без пояснения" : s.reason,
								   s.code.needsHuman ? DS.Palette.danger : DS.Palette.textSecondary)
						}
						AnswerView(text: parsed.body.isEmpty ? text : parsed.body)
					}
					if !parsed.sources.isEmpty {
						VStack(alignment: .leading, spacing: DS.Metrics.s2) {
							Text("Источники").font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
							VStack(spacing: 0) { ForEach(parsed.sources.map(MergedSource.init(chip:)).filter { $0.kind != .command }) { SourceRowView(source: $0) } }
								.padding(.horizontal, -DS.Metrics.s3)
						}
					}
				} else if agent.state != .error {
					Text("Ответа пока нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
				counters
			}
			.padding(DS.Metrics.s4)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.scrollEdgeEffectStyle(.soft, for: .bottom)
	}

	private func reason(_ word: String, _ text: String, _ color: Color) -> some View {
		Text("\(Text(word + ": ").foregroundStyle(color))\(Text(text).foregroundStyle(DS.Palette.textSecondary))")
			.font(DS.Typography.body).lineSpacing(DS.Typography.readingLineSpacing)
			.textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
	}

	/// Счётчики одной строкой серым.
	private var counters: some View {
		HStack(spacing: DS.Metrics.s2) {
			if agent.stats.turns + agent.stats.toolCalls > 0 {
				Text(Numbers.statsLine(agent.stats)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).monospacedDigit()
			}
		}
	}
}

// MARK: - Чат (агент работает)

/// Лента в стиле Claude: сообщения вам, ответы markdown, шаги группами, размышления свёрнуты. Якорь к низу, пока вы внизу.
struct ChatContent: View {
	var agent: AgentView
	var chat: ChatModel?
	var goal: String
	@State private var position = ScrollPosition(edge: .bottom)
	@State private var atBottom = true
	@State private var geoAtBottom = true
	@State private var unread = 0

	var body: some View {
		if let chat {
			let entries = ChatEntries.build(chat.items, goal: goal)
			ScrollView {
				LazyVStack(alignment: .leading, spacing: DS.Metrics.s4) {
					AgentIntro(agent: agent, goal: goal)
					ForEach(entries) { LogEntryView(entry: $0) }
					if agent.canStop { StageLine(agent: agent) }
					Color.clear.frame(height: 1).id("chat-end")
				}
				.padding(DS.Metrics.s4)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.scrollPosition($position)
			.defaultScrollAnchor(.bottom)
			.scrollEdgeEffectStyle(.soft, for: .top)
			.scrollEdgeEffectStyle(.soft, for: .bottom)
			// «липкий» низ: пока пользователь сам не прокрутил вверх, лента остаётся у последнего сообщения,
			// даже когда содержимое растёт (повтор истории, новые сообщения)
			.onScrollGeometryChange(for: Bool.self) { g in g.visibleRect.maxY >= g.contentSize.height - 20 } action: { _, now in
				geoAtBottom = now
				if now { unread = 0 }
			}
			.onScrollPhaseChange { _, phase in
				if phase == .idle { atBottom = geoAtBottom; if atBottom { unread = 0 } }
			}
			.onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { _, _ in
				if atBottom { position.scrollTo(id: "chat-end", anchor: .bottom) }
			}
			.onChange(of: chat.items.count) { old, new in
				if atBottom { position.scrollTo(id: "chat-end", anchor: .bottom) } else if new > old { unread += new - old }
			}
			.overlay(alignment: .bottom) {
				if !atBottom, unread > 0 {
					PlainIconButton(systemImage: "arrow.down", help: "Новое: \(unread) — к концу", size: 30, filled: true) {
						withAnimation(dsAnimation(DS.Motion.panel)) { position.scrollTo(id: "chat-end", anchor: .bottom) }
					}
					.padding(.bottom, DS.Metrics.s3).transition(.opacity)
				}
			}
		} else {
			Color.clear
		}
	}
}

/// Запись ленты.
struct LogEntry: Identifiable {
	enum Body {
		case mine(String)
		case other(String)
		case answer(String)
		case tools([AgentEvent.ToolEvent])
		case thought(String)
		case permission(AgentEvent.PermissionEvent)
		case system(AgentEvent.SystemEvent)
	}
	var id: String
	var label: String
	var body: Body
}

enum ChatEntries {
	/// Поручение (первое сообщение) в ленту не попадает: оно в блоке цели.
	static func build(_ items: [AgentEvent], goal: String) -> [LogEntry] {
		var out: [LogEntry] = []
		var skippedGoal = false
		for row in ChatLayout.rows(items) {
			switch row {
			case .tools(let t): out.append(LogEntry(id: row.id, label: "", body: .tools(t)))
			case .event(let e):
				switch e {
				case .user(let u):
					let p = Brief.plain(u.text)
					let mine = u.from == "you" || u.from == "user" // оркестратор и человек: один вид, как у цели
					if !skippedGoal { skippedGoal = true; if p == goal { continue } }
					out.append(LogEntry(id: row.id, label: mine ? "" : "Сообщение от \(u.from)", body: mine ? .mine(p) : .other(p)))
				case .text(let t):
					let s = t.text.trimmingCharacters(in: .whitespacesAndNewlines)
					if !s.isEmpty { out.append(LogEntry(id: row.id, label: "", body: .answer(s))) }
				case .thought(let t): out.append(LogEntry(id: row.id, label: "", body: .thought(t.text)))
				case .permission(let p): out.append(LogEntry(id: row.id, label: "", body: .permission(p)))
				case .system(let s): if s.isError { out.append(LogEntry(id: row.id, label: "", body: .system(s))) }
				case .tool: continue
				}
			}
		}
		return out
	}
}

struct LogEntryView: View {
	var entry: LogEntry

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			if !entry.label.isEmpty { Text(entry.label).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
			content
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	@ViewBuilder private var content: some View {
		switch entry.body {
		case .mine(let t):
			MessageCard(text: t)
		case .other(let t):
			Text("«\(t)»").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).lineLimit(4).textSelection(.enabled)
		case .answer(let t):
			MarkdownView(text: AnswerText.clean(ReplyParser.parse(t).body), lead: false)
		case .tools(let t):
			ToolRunView(tools: t, verbose: false)
		case .thought(let t):
			ThoughtView(text: t)
		case .permission(let p):
			Label {
				Text("\(Text(permissionTitle(p)).foregroundStyle(DS.Palette.textSecondary))  \(Text(PermissionText.command(p.title)).font(DS.Typography.mono).foregroundStyle(DS.Palette.textPrimary))")
			} icon: {
				Image(systemName: "hand.raised").foregroundStyle(p.resolved ? DS.Palette.quiet : DS.Palette.attention)
			}
			.font(DS.Typography.secondary).lineLimit(3)
		case .system(let s):
			Text(s.text).font(DS.Typography.caption).foregroundStyle(DS.Palette.danger)
		}
	}

	private func permissionTitle(_ p: AgentEvent.PermissionEvent) -> String {
		guard p.resolved else { return "Ждёт решения" }
		if p.auto == true { return p.approved == true ? "Разрешено автоматически" : "Отклонено автоматически" }
		return p.approved == true ? "Разрешено вами" : "Отклонено вами"
	}
}

// MARK: - Поле ввода

/// Плавающая карточка внизу панели: многострочное поле (растёт до 6 строк), справа «отправить».
/// ↩ — отправить (прерывает ход), ⇧↩ — перенос, Esc — свернуть раскрытые карточки или снять фокус. Черновик хранится на агента.
struct AgentComposer: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win
	var agent: AgentView
	var onEscape: () -> Bool = { false }
	/// сообщение отправлено (панель агента переключается на чат)
	var onSend: () -> Void = {}
	@State private var fieldH: CGFloat = 20

	private var draft: Binding<String> {
		Binding(get: { model.drafts[agent.id] ?? "" }, set: { model.drafts[agent.id] = $0 })
	}
	private var hasText: Bool { !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
	private var canSend: Bool { hasText && !model.isOffline }

	var body: some View {
		let font = NSFont.systemFont(ofSize: 13)
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(alignment: .bottom, spacing: DS.Metrics.s2) {
				ComposerTextView(text: draft, height: $fieldH, font: font, maxHeight: 6 * 17, onSubmit: submit, onEscape: {
					if onEscape() { return true }
					win?.listFocusTick += 1
					return false
				})
				.frame(height: max(fieldH, 17))
				.overlay(alignment: .topLeading) {
					if draft.wrappedValue.isEmpty {
						Text("Написать агенту…").font(.system(size: 13)).foregroundStyle(DS.Palette.textTertiary).allowsHitTesting(false)
					}
				}
				.padding(.vertical, DS.Metrics.s1)
				// поле пусто, а агент работает: вместо «отправить» кнопка «стоп» (остановить ход)
				if !hasText && agent.canStop {
					PlainIconButton(systemImage: "stop.fill", help: model.isOffline ? "Нет связи" : "Остановить ход (⌘.)", size: 28, filled: true) { model.stop(agent) }
						.disabled(model.isOffline)
				} else {
					PlainIconButton(systemImage: "arrow.up", help: model.isOffline ? "Нет связи" : "Отправить (↩)", size: 28, filled: true, action: submit)
						.disabled(!canSend)
				}
			}
			contextCaption
		}
		.padding(.leading, DS.Metrics.s3).padding(.trailing, DS.Metrics.s2).padding(.vertical, DS.Metrics.s2)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsFloatingCard()
		.padding(.horizontal, DS.Metrics.s3).padding(.bottom, DS.Metrics.s3)
	}

	/// Заполнение контекста под полем: кольцо и «Контекст: 42 % · 54 тыс. токенов».
	private var contextCaption: some View {
		HStack(spacing: DS.Metrics.s1) {
			if let pct = agent.stats.contextPct {
				DSContextMeter(pct: pct, size: 12)
				Text("Контекст заполнен на \(pct) %" + (agent.stats.contextTokens.map { " · в окне \(Numbers.compact($0)) токенов" } ?? ""))
			} else {
				Text("Контекст: нет данных")
			}
		}
		.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).monospacedDigit()
		.padding(.top, 2)
	}

	private func submit() {
		guard canSend else { return }
		model.send(to: agent, text: draft.wrappedValue)
		onSend()
	}
}
