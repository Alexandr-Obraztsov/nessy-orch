import SwiftUI
import NessyKit

/// Где показано окно агента: плавающая стеклянная панель справа, на весь контент (узкое окно) или отдельное окно macOS.
enum PanelMode { case floating, full, window }

/// Окно агента без вкладок: шапка → цель → план → (запрос прав) → чат или итог → поле ввода.
/// Тянется на всю высоту; поверхность — Liquid Glass, как у сайдбара.
struct AgentPanel: View {
	@Environment(AppModel.self) private var model
	var agentId: String
	var mode: PanelMode = .floating
	@State private var chat: ChatModel?

	private var agent: AgentView? { model.store.agents[agentId] }

	var body: some View {
		GeometryReader { geo in
			Group {
				if let a = agent {
					VStack(spacing: 0) {
						PanelHeader(agent: a, mode: mode)
						// закреплённый верх: цель, план, запрос прав; не выше половины окна, дальше прокручивается
						ViewThatFits(in: .vertical) {
							pinned(a)
							ScrollView { pinned(a) }.scrollEdgeEffectStyle(.soft, for: .bottom)
						}
						.frame(maxHeight: geo.size.height * 0.5, alignment: .top)
						DSSeparator()
						ZStack {
							if a.isFinished {
								ResultContent(agent: a, chat: chat)
							} else {
								ChatContent(agent: a, chat: chat, goal: goalText(a))
							}
						}
						.frame(maxWidth: .infinity, maxHeight: .infinity)
						.animation(DS.Motion.fade, value: a.isFinished)
						AgentComposer(agent: a)
					}
					.id(a.id)
					.transition(.opacity)
				} else {
					ContentUnavailableView("Агент удалён", systemImage: "person.crop.circle.badge.xmark")
				}
			}
			.frame(width: geo.size.width, height: geo.size.height, alignment: .top)
		}
		.animation(DS.Motion.fade, value: agentId)
		.modifier(PanelSurface(mode: mode))
		.task(id: agentId) {
			chat?.stop()
			let c = ChatModel(ref: agentId)
			c.start(client: model.store.client)
			chat = c
		}
		.onDisappear { chat?.stop() }
		.onChange(of: agent?.lastReply?.msgId) { _, _ in if let a = agent { model.store.markSeen(agent: a) } }
	}

	@ViewBuilder private func pinned(_ a: AgentView) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			if !goalText(a).isEmpty { GoalBlock(text: goalText(a)).id(a.id) }
			PlanBlock(agent: a)
			ForEach(Array(a.pendingPermissions.enumerated()), id: \.element.id) { i, p in
				DecisionBlock(agent: a, permission: p, prominent: i == 0)
			}
		}
		.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// Поручение: текст первого сообщения агенту.
	private func goalText(_ a: AgentView) -> String {
		let first = Brief.firstMessages(model.store.messages)
		guard first[a.id] != nil else { return "" }
		return Brief.of(a, first: first)
	}
}

private struct PanelSurface: ViewModifier {
	var mode: PanelMode
	func body(content: Content) -> some View {
		switch mode {
		case .window: content.background(DS.Palette.panel)
		case .floating, .full: content.dsGlassPanel()
		}
	}
}

/// Шапка: имя, мелко состояние и таймер; справа компактные «остановить», «в окно», «закрыть».
struct PanelHeader: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var mode: PanelMode

	var body: some View {
		HStack(alignment: .top, spacing: DS.Metrics.s3) {
			DSStateGlyph(state: agent.ds, size: DS.Metrics.glyphHeader).padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				Text(agent.name).font(DS.Typography.panelTitle).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
				subtitle
			}
			Spacer(minLength: DS.Metrics.s2)
			HStack(spacing: DS.Metrics.s1) {
				if agent.canStop {
					icon("stop.fill", help: model.isOffline ? "Нет связи" : "Остановить ход (⌘.)") { model.stop(agent) }.disabled(model.isOffline)
				}
				if mode != .window {
					icon("macwindow", help: "Открыть в окне (⌘O)") { model.openAgentWindow?(agent.id); model.open(agent: nil) }
					icon(mode == .full ? "chevron.left" : "xmark", help: "Закрыть (Esc)") { model.open(agent: nil) }
				}
			}
		}
		.padding(.horizontal, DS.Metrics.s4).padding(.top, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
		.contentShape(Rectangle())
		.onTapGesture(count: 2) { if mode != .window { model.openAgentWindow?(agent.id); model.open(agent: nil) } }
	}

	private func icon(_ name: String, help: String, action: @escaping () -> Void) -> some View {
		Button(action: action) {
			Image(systemName: name).font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24).contentShape(Circle())
		}
		.buttonStyle(.borderless).foregroundStyle(DS.Palette.textSecondary).help(help)
	}

	/// «Работает · исполнитель · 1:14»
	private var subtitle: some View {
		HStack(spacing: DS.Metrics.s1) {
			Text(parts.joined(separator: " · "))
			if agent.state != .idle, agent.state != .wait {
				Text("·")
				DSTimer(agent: agent, frozenAt: model.frozenAt)
			}
		}
		.font(DS.Typography.caption)
		.foregroundStyle(DS.Palette.textSecondary)
		.lineLimit(1)
	}

	private var parts: [String] {
		var p = [agent.stateWord]
		if let r = agent.role { p.append((model.store.role(r)?.name ?? r).lowercased()) }
		return p
	}
}

// MARK: - Цель

/// Поручение агента: 3 строки, дальше «Ещё / Свернуть».
struct GoalBlock: View {
	var text: String
	@State private var expanded = false
	@State private var overflow = false
	@State private var fullH: CGFloat = 0
	@State private var shownH: CGFloat = 0

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text("Цель").font(DS.Typography.caption.weight(.medium)).foregroundStyle(DS.Palette.textSecondary)
			Text(text)
				.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
				.lineLimit(expanded ? nil : 3)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
				.fixedSize(horizontal: false, vertical: true)
				.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { shownH = $0; measure() }
				.background {
					Text(text).font(DS.Typography.secondary).fixedSize(horizontal: false, vertical: true).hidden()
						.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullH = $0; measure() }
				}
			if overflow {
				Button(expanded ? "Свернуть" : "Ещё") { withAnimation(dsAnimation(DS.Motion.disclosure)) { expanded.toggle() } }
					.buttonStyle(.borderless).font(DS.Typography.caption)
			}
		}
	}

	private func measure() { if !expanded { overflow = fullH > shownH + 1 } }
}

// MARK: - План

/// План чеклистом: текущий шаг крутится, выполненные с галочкой, будущие тусклые. Без плана — строка этапа.
struct PlanBlock: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	@State private var all = false

	var body: some View {
		if let plan = agent.plan, !plan.entries.isEmpty {
			if agent.isFinished { finished(plan) } else { checklist(plan) }
		} else if agent.status == .working || agent.status == .starting {
			StageLine(agent: agent)
		}
	}

	private func checklist(_ plan: AgentPlan) -> some View {
		let cur = PlanWindowing.current(plan.entries)
		let w = all ? PlanWindow(range: 0..<plan.entries.count, before: 0, after: 0)
			: PlanWindowing.window(count: plan.entries.count, current: cur)
		return VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			if w.before > 0 { more(w.before, up: true) }
			ForEach(Array(w.range), id: \.self) { i in
				PlanRow(entry: plan.entries[i], current: i == cur, spinning: agent.canStop)
			}
			if w.after > 0 { more(w.after, up: false) }
			if all, plan.entries.count > 5 { Button("Свернуть") { toggle() }.buttonStyle(.borderless).font(DS.Typography.caption) }
			StageSilence(agent: agent)
		}
	}

	private func more(_ n: Int, up: Bool) -> some View {
		Button { toggle() } label: {
			HStack(spacing: DS.Metrics.s2) {
				Image(systemName: up ? "chevron.up" : "chevron.down").font(DS.Typography.caption.weight(.semibold)).frame(width: DS.Metrics.glyphRow)
				Text("ещё \(n)")
			}
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).contentShape(Rectangle())
		}
		.buttonStyle(.plain)
	}

	private func toggle() { withAnimation(dsAnimation(DS.Motion.disclosure)) { all.toggle() } }

	/// У закончившего агента — свёрнутая строка «План выполнен · 4 из 4 ›».
	private func finished(_ plan: AgentPlan) -> some View {
		let done = plan.entries.filter { $0.status == .completed }.count
		return VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Button { toggle() } label: {
				HStack(spacing: DS.Metrics.s1) {
					Text(done == plan.entries.count ? "План выполнен · \(done) из \(done)" : "План · \(done) из \(plan.entries.count)")
					Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).rotationEffect(.degrees(all ? 90 : 0))
					Spacer(minLength: 0)
				}
				.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if all {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					ForEach(Array(plan.entries.enumerated()), id: \.offset) { _, e in PlanRow(entry: e, current: false, spinning: false) }
				}.transition(.opacity)
			}
		}
	}
}

struct PlanRow: View {
	var entry: PlanEntry
	var current: Bool
	var spinning: Bool

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
			Group {
				if entry.status == .completed {
					Image(systemName: "checkmark").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.quiet)
				} else if current && spinning {
					ProgressView().controlSize(.small).scaleEffect(0.7)
				} else {
					Image(systemName: "circle").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
				}
			}
			.frame(width: DS.Metrics.glyphRow, height: DS.Metrics.glyphRow)
			.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
			Text(entry.content)
				.font(DS.Typography.secondary)
				.foregroundStyle(current ? DS.Palette.textPrimary : entry.status == .completed ? DS.Palette.textSecondary : DS.Palette.textTertiary)
				.lineLimit(2)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}
}

/// Нет плана: «Работает 3:20 · Запускает команду…» / «Нет новостей 1:05 · …».
struct StageLine: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView

	var body: some View {
		TimelineView(.periodic(from: .now, by: 1)) { ctx in
			let now = model.frozenAt ?? ctx.date
			let st = agent.stage(now: now)
			let text: String = {
				guard let st else { return "Работает" }
				switch st.kind {
				case .silent, .starting: return st.text
				default:
					let ms = agent.elapsedMs(now: now).map { " " + Durations.clock($0) } ?? ""
					return "Работает" + ms + (agent.toolPhrase.map { " · " + $0.present } ?? "")
				}
			}()
			HStack(spacing: DS.Metrics.s2) {
				ProgressView().controlSize(.small).scaleEffect(0.7).frame(width: DS.Metrics.glyphRow)
				Text(text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).lineLimit(2).monospacedDigit()
			}
		}
	}
}

/// Тишина при наличии плана: одна тихая строка под чеклистом.
struct StageSilence: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var body: some View {
		TimelineView(.periodic(from: .now, by: 1)) { ctx in
			if let st = agent.stage(now: model.frozenAt ?? ctx.date), st.kind == .silent {
				Text(st.text).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(2)
			}
		}
	}
}

/// Ответ агента: markdown по-настоящему, «Итог —» срезан, первая фраза — крупнее.
struct AnswerView: View {
	var text: String
	var body: some View {
		MarkdownView(text: AnswerText.clean(text), lead: true)
	}
}

extension AnswerText {
	/// Срезать служебное «**Итог** —» в начале ответа.
	static func clean(_ s: String) -> String {
		var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
		t = t.replacingOccurrences(of: "^(?:\\*\\*|__)?\\s*(?:итог|ответ|резюме|вердикт)\\s*(?:\\*\\*|__)?\\s*[:—–-]\\s*", with: "", options: [.regularExpression, .caseInsensitive])
		return t.prefix(1).uppercased() + t.dropFirst()
	}
}


/// Подряд идущие вызовы: «▸ 4 шага · 1:12  прочитал retry.ts · …»; в подробном — каждый вызов с вводом/выводом.
struct ToolRunView: View {
	var tools: [AgentEvent.ToolEvent]
	var verbose: Bool
	@State private var open: Bool?

	var body: some View {
		let isOpen = open ?? verbose
		let failed = tools.filter { $0.status == .failed }.count
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { open = !isOpen } } label: {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold))
						.rotationEffect(.degrees(isOpen ? 90 : 0))
						.foregroundStyle(DS.Palette.textSecondary)
					VStack(alignment: .leading, spacing: 2) {
						HStack(spacing: DS.Metrics.s1) {
							Text(Numbers.count(tools.count, "шаг", "шага", "шагов")).foregroundStyle(DS.Palette.textPrimary)
							if let d = span { Text("· \(Durations.clock(d * 1000))").foregroundStyle(DS.Palette.textSecondary).monospacedDigit() }
							if failed > 0 { Text("· ошибок \(failed)").foregroundStyle(DS.Palette.danger) }
							if tools.contains(where: { $0.status == .inProgress }) { DSStateGlyph(state: .working, size: DS.Metrics.s3) }
						}
						if !isOpen {
							Text(tools.map { ToolPhrases.of($0.view).past }.joined(separator: " · "))
								.foregroundStyle(DS.Palette.textSecondary).lineLimit(2)
						}
					}
					Spacer(minLength: 0)
				}
				.font(DS.Typography.secondary)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if isOpen {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					ForEach(tools, id: \.seq) { ToolCallRow(tool: $0, verbose: verbose) }
				}
				.padding(.leading, DS.Metrics.s5)
				.transition(.opacity)
			}
		}
	}

	private var span: Double? {
		guard let first = tools.first?.ts, let last = tools.compactMap(\.endedTs).max() else { return nil }
		return max(0, (last - first) / 1000)
	}
}

struct ToolCallRow: View {
	var tool: AgentEvent.ToolEvent
	var verbose: Bool
	@State private var open = false

	var body: some View {
		let phrase = ToolPhrases.of(tool.view)
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Button { if verbose { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } } } label: {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Group {
						switch tool.status {
						case .completed: Image(systemName: "checkmark").foregroundStyle(DS.Palette.quiet)
						case .failed: Image(systemName: "xmark").foregroundStyle(DS.Palette.danger)
						case .inProgress, .pending: DSStateGlyph(state: .working, size: DS.Metrics.s3)
						}
					}
					.font(DS.Typography.caption.weight(.semibold)).frame(width: DS.Metrics.s3)
					Text(phrase.present).foregroundStyle(DS.Palette.textPrimary).lineLimit(1).truncationMode(.middle)
					Spacer(minLength: DS.Metrics.s2)
					if let d = tool.duration {
						Text(String(format: "%.1f с", d).replacingOccurrences(of: ".", with: ",")).monospacedDigit().foregroundStyle(DS.Palette.textSecondary)
					}
					if verbose, tool.output != nil || !tool.input.isEmpty {
						Image(systemName: "chevron.down").font(DS.Typography.caption).rotationEffect(.degrees(open ? 180 : 0))
							.foregroundStyle(DS.Palette.textSecondary)
					}
				}
				.font(DS.Typography.secondary)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if open {
				if !tool.input.isEmpty { CodeBox(text: JSONValue.object(tool.input).pretty, label: "Ввод") }
				if let o = tool.output, !o.isEmpty { CodeBox(text: o, label: "Вывод", diff: o.contains("\n+") && o.contains("\n-")) }
			}
		}
	}
}

/// Моноширинный вывод: до 6 строк, в подробном — прокрутка 220 pt.
struct CodeBox: View {
	var text: String
	var label: String
	var diff = false
	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(label).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			ScrollView([.vertical, .horizontal]) {
				Text(Highlighter.attributed(text, lang: diff ? "diff" : ""))
					.font(DS.Typography.monoCaption)
					.textSelection(.enabled)
					.padding(DS.Metrics.s2)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
			.frame(maxHeight: 220)
			.fixedSize(horizontal: false, vertical: true)
			.background(DS.Palette.hover, in: ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.s2)), isUniform: true))
		}
	}
}

struct ThoughtView: View {
	var text: String
	@State private var open = false
	var body: some View {
		Text(text)
			.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
			.lineLimit(open ? nil : 2)
			.textSelection(.enabled)
			.contentShape(Rectangle())
			.onTapGesture { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } }
			.help(open ? "Свернуть" : "Показать целиком")
	}
}


/// Отдельное окно агента: следит за тем же агентом, не за выделением.
struct AgentWindowView: View {
	var agentId: String
	@Environment(AppModel.self) private var model
	var body: some View {
		AgentPanel(agentId: agentId, mode: .window)
			.frame(minWidth: 400, minHeight: 480)
			.navigationTitle(model.store.agents[agentId]?.name ?? "Агент")
	}
}
