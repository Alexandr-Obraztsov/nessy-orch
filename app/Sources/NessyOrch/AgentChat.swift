import SwiftUI
import NessyKit

// MARK: - Итог (агент закончил)

/// Итог последнего хода: причина → ответ → источники → счётчики. Пустые блоки не показываются.
struct ResultContent: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var chat: ChatModel?
	@State private var copied = false

	private var text: String? {
		if let r = agent.lastReply, r.failed == nil, let m = model.store.messagesById[r.msgId] { return m.text }
		return chat?.lastAnswer ?? agent.lastReply?.preview
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s5) {
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
							VStack(spacing: 0) { ForEach(parsed.sources) { SourceRowView(source: MergedSource(chip: $0)) } }
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
	}

	private func reason(_ word: String, _ text: String, _ color: Color) -> some View {
		Text("\(Text(word + ": ").foregroundStyle(color))\(Text(text).foregroundStyle(DS.Palette.textSecondary))")
			.font(DS.Typography.body).lineSpacing(DS.Typography.readingLineSpacing)
			.textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
	}

	/// Счётчики одной строкой серым + «Копировать ответ».
	private var counters: some View {
		HStack(spacing: DS.Metrics.s2) {
			if agent.stats.turns + agent.stats.toolCalls > 0 {
				Text(Numbers.statsLine(agent.stats)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).monospacedDigit()
			}
			Spacer(minLength: DS.Metrics.s2)
			if let text {
				Button {
					Pasteboard.copy(ReplyParser.parse(text).body)
					copied = true
					Task { try? await Task.sleep(for: .seconds(1.4)); copied = false }
				} label: { Image(systemName: copied ? "checkmark" : "doc.on.doc").contentTransition(.symbolEffect(.replace)) }
					.buttonStyle(.borderless).foregroundStyle(DS.Palette.textSecondary).help("Копировать ответ")
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
	@State private var unread = 0

	var body: some View {
		if let chat {
			let entries = ChatEntries.build(chat.items, goal: goal)
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s4) {
					if !chat.replayDone && chat.items.isEmpty {
						ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(DS.Metrics.s6)
					}
					ForEach(entries) { LogEntryView(entry: $0) }
				}
				.padding(DS.Metrics.s4)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.scrollPosition($position)
			.defaultScrollAnchor(.bottom)
			.scrollEdgeEffectStyle(.soft, for: .top)
			.onScrollGeometryChange(for: Bool.self) { g in g.contentOffset.y + g.containerSize.height >= g.contentSize.height - 40 } action: { _, now in
				atBottom = now
				if now { unread = 0 }
			}
			.onChange(of: chat.items.count) { old, new in
				if atBottom { position.scrollTo(edge: .bottom) } else if new > old { unread += new - old }
			}
			.overlay(alignment: .bottom) {
				if !atBottom, unread > 0 {
					Button { withAnimation(dsAnimation(DS.Motion.panel)) { position.scrollTo(edge: .bottom) } } label: {
						Label("Новое · \(unread)", systemImage: "arrow.down")
					}
					.buttonStyle(.glass).padding(.bottom, DS.Metrics.s3).transition(.opacity)
				}
			}
		} else {
			ProgressView().controlSize(.small)
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
					if !skippedGoal { skippedGoal = true; if p == goal { continue } }
					out.append(LogEntry(id: row.id, label: u.from == "you" ? "" : "Сообщение от \(u.from)", body: u.from == "you" ? .mine(p) : .other(p)))
				case .text(let t):
					let s = t.text.trimmingCharacters(in: .whitespacesAndNewlines)
					if !s.isEmpty { out.append(LogEntry(id: row.id, label: "", body: .answer(s))) }
				case .thought(let t): out.append(LogEntry(id: row.id, label: "Размышления", body: .thought(t.text)))
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
			Text(t).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
				.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
				.frame(maxWidth: .infinity, alignment: .trailing)
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

/// Многострочное поле: растёт до 6 строк, ↩ — отправить, ⇧↩ — перенос. Черновик хранится на агента.
struct AgentComposer: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	@FocusState private var focused: Bool

	private var draft: Binding<String> {
		Binding(get: { model.drafts[agent.id] ?? "" }, set: { model.drafts[agent.id] = $0 })
	}
	private var canSend: Bool { !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isOffline }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(alignment: .bottom, spacing: DS.Metrics.s2) {
				TextField("Написать \(agent.name)…", text: draft, axis: .vertical)
					.textFieldStyle(.plain)
					.font(DS.Typography.body)
					.lineLimit(1...6)
					.focused($focused)
					.onKeyPress(.return, phases: .down) { press in
						if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { draft.wrappedValue += "\n"; return .handled }
						if press.modifiers.contains(.command) { return .ignored }
						if canSend { model.send(to: agent, text: draft.wrappedValue) }
						return .handled
					}
					.padding(.vertical, DS.Metrics.s2 - 1)
				Button { model.send(to: agent, text: draft.wrappedValue) } label: {
					Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold))
						.foregroundStyle(DS.Palette.panel)
						.frame(width: 28, height: 28)
						.background(canSend ? DS.Palette.textPrimary : DS.Palette.textTertiary.opacity(0.5), in: Circle())
				}
				.buttonStyle(.plain).disabled(!canSend)
				.help(model.isOffline ? "Нет связи" : "Отправить (↩)")
			}
			.padding(.leading, DS.Metrics.s4).padding(.trailing, DS.Metrics.s2 - 1).padding(.vertical, DS.Metrics.s1 + 1)
			.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
			.overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
			if agent.canStop {
				Text("Отправка прервёт текущий ход").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).padding(.leading, DS.Metrics.s4)
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.bottom, DS.Metrics.s3).padding(.top, DS.Metrics.s2)
		.onChange(of: focused) { _, _ in sync() }
		.onChange(of: draft.wrappedValue) { _, _ in sync() }
	}

	private func sync() { model.composerBusy = focused && !draft.wrappedValue.isEmpty }
}
