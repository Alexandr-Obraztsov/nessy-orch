import SwiftUI
import NessyKit

/// Левая панель агентов (layout-v2.md, итог): список агентов сессии ⇄ карточка агента, переход пружиной без отскока.
/// Поверхность (парящее стекло, отступы, скругление, отступ под тулбаром и светофором) даёт системный сайдбар.
struct AgentsPanel: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		ZStack {
			if let a = win?.openAgent {
				AgentPanel(agentId: a.id)
					.transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
			} else {
				AgentsListView()
					.transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.clipped()
		.onExitCommand { win?.open(agent: nil) }
	}
}

/// Список агентов сессии по смыслу: Нужны вы → В работе → Готово → Ошибки. Заголовок — «Агенты · N».
struct AgentsListView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	private var doneExpanded: Bool? { get { model.doneGroupOpen } nonmutating set { model.doneGroupOpen = newValue } }
	/// «Ошибки» свёрнуты, пока человек сам не раскроет; состояние групп общее для проектов (хранится в AppModel)
	private var failedExpanded: Bool { get { model.failedGroupOpen } nonmutating set { model.failedGroupOpen = newValue } }
	@FocusState private var listFocused: Bool

	private var agents: [AgentView] { win?.agents ?? [] }

	var body: some View {
		let sections = AgentGrouping.sections(agents)
		let ids = visibleIds(sections)
		Group {
			if agents.isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s1) {
					Text("Агентов пока нет").font(DS.Typography.body).foregroundStyle(DS.Palette.textPrimary)
					Text("Их запускает главный агент.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
				.padding(.horizontal, DS.Metrics.s4).padding(.top, DS.Metrics.s2)
			} else {
				list(sections, ids)
			}
		}
		// заголовок — safeAreaBar: карточки при прокрутке уходят под него с размытием и затемнением (Liquid Glass), а не обрезаются по линии
		.safeAreaBar(edge: .top, spacing: 0) { header }
	}

	/// Заголовок списка: «Агенты · N». Кнопок здесь нет — они в тулбаре окна.
	private var header: some View {
		HStack(spacing: DS.Metrics.s2) {
			Text("Агенты").font(DS.Typography.panelTitle)
			if !agents.isEmpty { Text("·").foregroundStyle(DS.Palette.textTertiary); DSCount(value: agents.count).foregroundStyle(DS.Palette.textSecondary) }
			Spacer(minLength: 0)
		}
		.foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
		.padding(.leading, DS.Metrics.s4).padding(.trailing, 96)
		.frame(height: SessionWindowModel.rowHeight)
	}

	private func list(_ sections: [AgentSection], _ ids: [String]) -> some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s4) {
				ForEach(sections) { sec in
					let collapsible = (sec.group == .done && sections.count > 1) || sec.group == .failed
					let expanded = !collapsible || (sec.group == .failed ? failedExpanded : isDoneExpanded(sec, sections))
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						if sections.count > 1 || sec.group == .failed {
							DSGroupHeader(title: sec.group.title, count: sec.agents.count,
										  expanded: collapsible ? Binding(get: { expanded }, set: { if sec.group == .failed { failedExpanded = $0 } else { doneExpanded = $0 } }) : nil)
						}
						if expanded {
							VStack(spacing: 0) {
								ForEach(Array(sec.agents.enumerated()), id: \.element.id) { i, a in
									if i > 0 { DSSeparator(leading: DS.Metrics.rowTextX) }
									AgentRow(agent: a)
								}
							}
							.dsGroup()
							.transition(.asymmetric(insertion: DS.Motion.rowTransition(reduceMotion: reduceMotion),
													removal: .opacity.animation(.easeOut(duration: 0.12))))
						}
					}
					.transition(.asymmetric(insertion: .opacity, removal: .opacity.animation(.easeOut(duration: 0.12))))
				}
			}
			.padding(.horizontal, DS.Metrics.s3)
			.padding(.top, DS.Metrics.s1).padding(.bottom, DS.Metrics.s4)
			.animation(DS.Motion.pick(DS.Motion.layout, reduceMotion: reduceMotion), value: sections.map { "\($0.group.rawValue):\($0.agents.map(\.id))" })
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.scrollEdgeEffectStyle(.soft, for: .bottom)
		// полоса прокрутки не мигает при перестройке списка (закрытие сессии, смена группы)
		.scrollIndicators(.hidden)
		// Клавиши списка (↑/↓, J/K, ↩) работают, только когда фокус в самом списке (клик по пустому месту); терминал и поле ввода
		// получают свои клавиши как есть. Фокус сам список не забирает — иначе он отнимал бы его у терминала.
		.background { Color.clear.contentShape(Rectangle()).onTapGesture { listFocused = true } }
		.focusable()
		.focused($listFocused)
		.focusEffectDisabled()
		.onChange(of: win?.listFocusTick) { _, _ in listFocused = true }
		.onKeyPress(.downArrow) { move(1, ids); return .handled }
		.onKeyPress(.upArrow) { move(-1, ids); return .handled }
		.onKeyPress("j") { move(1, ids); return .handled }
		.onKeyPress("k") { move(-1, ids); return .handled }
		.onKeyPress(.return) {
			guard let id = win?.selectedAgentId, ids.contains(id) else { return .ignored }
			win?.open(agent: id); return .handled
		}
	}

	/// «Готово» свёрнута, когда готовых много и кто-то ещё работает или ждёт (screens.md §7).
	private func isDoneExpanded(_ sec: AgentSection, _ all: [AgentSection]) -> Bool {
		if let doneExpanded { return doneExpanded }
		let active = all.contains { $0.group == .needsYou || $0.group == .working }
		return !(active && sec.agents.count > 5)
	}

	private func visibleIds(_ sections: [AgentSection]) -> [String] {
		sections.flatMap { s in
			if s.group == .failed { return failedExpanded ? s.agents.map(\.id) : [] }
			return s.group == .done && sections.count > 1 && !isDoneExpanded(s, sections) ? [] : s.agents.map(\.id)
		}
	}

	/// ↑/↓ двигают курсор; Enter открывает карточку.
	private func move(_ d: Int, _ ids: [String]) {
		guard !ids.isEmpty else { return }
		let i = win?.selectedAgentId.flatMap { ids.firstIndex(of: $0) }
		let next = i.map { min(max(0, $0 + d), ids.count - 1) } ?? (d > 0 ? 0 : ids.count - 1)
		win?.selectedAgentId = ids[next]
	}
}

/// Строка агента: две строки (имя · роль · время / этап), у ждущего — блок решения (design-system.md §8.4, screens.md §3b).
struct AgentRow: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win
	var agent: AgentView
	var compact = false
	@State private var hovering = false

	private var a: AgentView { agent }
	private var selected: Bool { win?.selectedAgentId == a.id && !compact }

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			DSStateGlyph(state: a.ds)
				.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Text(model.store.title(of: a)).font(DS.Typography.secondary.weight(.semibold)).foregroundStyle(DS.Palette.textPrimary).lineLimit(2).layoutPriority(1)
					Spacer(minLength: DS.Metrics.s2)
					trailing
				}
				meta
				AgentStageLine(agent: a)
			}
		}
		.padding(.leading, DS.Metrics.s3).padding(.trailing, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2 + DS.Metrics.s1)
		.background {
			ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.groupRadius - DS.Metrics.rowInset)), isUniform: true)
				.fill(selected ? DS.Palette.selection : hovering ? DS.Palette.hover : .clear)
				.padding(DS.Metrics.rowInset)
		}
		.contentShape(Rectangle())
		.onHover { h in withAnimation(h ? DS.Motion.hoverIn : DS.Motion.hoverOut) { hovering = h } }
		.onTapGesture { compact ? model.reveal(agent: a.id) : win?.open(agent: a.id) }
		.contextMenu {
			Button("Открыть") { if compact { model.reveal(agent: a.id) } else { win?.open(agent: a.id) } }
			if a.canStop { Button("Остановить") { model.stop(a) }.disabled(model.isOffline) }
		}
		.accessibilityElement(children: .contain)
		.accessibilityLabel("\(model.store.title(of: a)), \(a.stateWord)")
		.accessibilityAddTraits(selected ? .isSelected : [])
	}

	/// Роль · токены · вызовы (в menu bar вместо роли — сессия: агенты там из разных сессий). Что есть, то и пишем.
	@ViewBuilder private var meta: some View {
		let parts = metaParts
		if !parts.isEmpty || a.stats.contextPct != nil {
			// кольцо контекста стоит в начале строки и читается вместе с цифрами: «◔ 54 % · Исполнитель · 12 тыс. токенов · 3 вызова»
			HStack(spacing: DS.Metrics.s1 + 2) {
				if let pct = a.stats.contextPct {
					DSContextMeter(pct: pct, size: 12)
					Text("\(pct) %").monospacedDigit()
				}
				Text(parts.joined(separator: " · ")).lineLimit(1)
			}
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
		}
	}

	private var metaParts: [String] {
		var p: [String] = []
		if compact { if let t = model.store.session(a.session)?.title { p.append(t) } }
		else if let r = model.roleInfo(of: a) { p.append(r.name) }
		if let t = a.stats.tokens, t.total > 0 { p.append("\(Numbers.compact(t.total)) токенов всего") }
		if a.stats.toolCalls > 0 { p.append(Numbers.count(a.stats.toolCalls, "вызов", "вызова", "вызовов")) }
		return p
	}

	/// Справа: таймер. Кнопок в строке нет: остановка — в контекстном меню (⌘. — с клавиатуры).
	@ViewBuilder private var trailing: some View {
		let steps = (a.state == .working || a.state == .starting) ? (a.plan?.entries.map(\.status) ?? []) : []
		VStack(alignment: .trailing, spacing: 6) {
			HStack(spacing: DS.Metrics.s2) {
				if model.store.isNew(a) { DSNewDot() }
				if a.state == .wait || a.canStop || (a.lastTurnMs ?? 0) >= 1000 {
					DSTimer(agent: a, frozenAt: model.frozenAt)
				}
			}
			// индикатор шагов плана — под таймером, чтобы не отнимать место у строки «роль · токены · вызовы»
			if !steps.isEmpty { DSPlanSegments(steps: steps) }
		}
	}
}

/// Нижняя строка: у работающего пусто, причина у ошибки/блокировки, первая фраза ответа у готового.
struct AgentStageLine: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView

	var body: some View {
		let a = agent
		Group {
			switch a.state {
			case .working, .starting:
				// чем занят агент сейчас: «Ищет в коде», команда и т. п.
				if let t = a.stage(now: model.frozenAt ?? Date())?.text, !t.isEmpty {
					Text(t).foregroundStyle(DS.Palette.textSecondary).lineLimit(1).truncationMode(.middle)
				}
			case .wait:
				EmptyView()
			case .error:
				reason("Ошибка", a.error ?? "ход завершился ошибкой", DS.Palette.danger)
			case .done:
				if a.isBlocked, let c = a.replyCode {
					reason(c.label, a.replyReason.isEmpty ? answer : a.replyReason, DS.Palette.danger)
				} else if a.replyCode == .doneWithConcerns {
					reason("С оговорками", a.replyReason.isEmpty ? answer : a.replyReason, DS.Palette.textSecondary)
				} else if !answer.isEmpty {
					Text(answer).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
				}
			}
		}
		// все строки под заголовком — одного мелкого размера, как «роль · токены · вызовы»
		.font(DS.Typography.caption)
	}

	/// «Ошибка: причина» — первое слово цветом состояния, остальное вторичным.
	private func reason(_ word: String, _ text: String, _ color: Color) -> some View {
		Text("\(Text(word + ": ").foregroundStyle(color))\(Text(text).foregroundStyle(DS.Palette.textSecondary))")
			.lineLimit(2)
	}

	/// Первая фраза ответа без «Итог —» и сносок [1].
	private var answer: String {
		let text = agent.lastReply.flatMap { model.store.messagesById[$0.msgId]?.text } ?? agent.lastReply?.preview ?? ""
		return AnswerText.firstSentence(Brief.resultText(text))
	}
}

enum AnswerText {
	/// Сноски [1][2] убираем, первую букву — заглавной, обрезаем по первой точке.
	static func firstSentence(_ s: String) -> String {
		var t = s.replacingOccurrences(of: "\\s*\\[\\d+\\]", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
		if let r = t.range(of: "(?<=[.!?])\\s", options: .regularExpression) { t = String(t[..<r.lowerBound]) }
		return t.prefix(1).uppercased() + t.dropFirst()
	}
}

/// Шапка открытого агента вместо «Агенты»: «‹», состояние и цель (суть поручения). Справа остаётся место под кнопки окна.
struct AgentHeaderRow: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var back: () -> Void
	@State private var hover = false

	var body: some View {
		HStack(spacing: DS.Metrics.s2) {
			Button(action: back) {
				Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
					.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
					.frame(width: 26, height: 26)
					.background(hover ? DS.Palette.hover : .clear, in: Circle())
					.contentShape(Circle())
			}
			.buttonStyle(.plain).focusEffectDisabled()
			.onHover { hover = $0 }
			.help("К списку агентов (Esc)").accessibilityLabel("Назад к списку агентов")
			DSStateGlyph(state: agent.ds, size: DS.Metrics.glyphRow)
			Text(model.store.title(of: agent)).font(DS.Typography.panelTitle)
				.foregroundStyle(DS.Palette.textPrimary).lineLimit(1).truncationMode(.tail)
				.help(model.store.goal(of: agent))
			Spacer(minLength: 0)
		}
		.padding(.leading, DS.Metrics.s2).padding(.trailing, 96)
		.frame(height: SessionWindowModel.rowHeight)
	}
}
