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
			if let id = win?.openAgentId {
				AgentPanel(agentId: id, mode: .embedded)
					.transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
			} else {
				AgentsListView()
					.transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.clipped()
		.safeAreaInset(edge: .bottom, spacing: 0) { SidebarFooter() }
		.onExitCommand { win?.open(agent: nil) }
	}
}

/// Список агентов сессии по смыслу: Нужны вы → В работе → Готово → Ждут поручения. Заголовок — «Агенты · N».
struct AgentsListView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var doneExpanded: Bool?
	@FocusState private var listFocused: Bool

	private var agents: [AgentView] { win?.agents ?? [] }

	var body: some View {
		let sections = AgentGrouping.sections(agents)
		let ids = visibleIds(sections)
		VStack(spacing: 0) {
			header
			if agents.isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s1) {
					Text("Агентов пока нет").font(DS.Typography.body).foregroundStyle(DS.Palette.textPrimary)
					Text("Их запускает Claude.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, DS.Metrics.s4).padding(.top, DS.Metrics.s2)
				Spacer(minLength: 0)
			} else {
				list(sections, ids)
			}
		}
	}

	/// Заголовок списка: «Агенты · N». Кнопок здесь нет — они в тулбаре окна.
	private var header: some View {
		HStack(spacing: DS.Metrics.s2) {
			Text("Агенты").font(DS.Typography.panelTitle)
			if !agents.isEmpty { Text("·").foregroundStyle(DS.Palette.textTertiary); DSCount(value: agents.count).foregroundStyle(DS.Palette.textSecondary) }
			Spacer(minLength: 0)
			ClaudeStateIndicator(state: win?.session?.claude?.state)
		}
		.foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
		.padding(.horizontal, DS.Metrics.s4).padding(.top, DS.Metrics.s3).padding(.bottom, DS.Metrics.s2)
	}

	private func list(_ sections: [AgentSection], _ ids: [String]) -> some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s4) {
				ForEach(sections) { sec in
					let collapsible = sec.group == .done && sections.count > 1
					let expanded = !collapsible || isDoneExpanded(sec, sections)
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						if sections.count > 1 {
							DSGroupHeader(title: sec.group.title, count: sec.agents.count,
										  expanded: collapsible ? Binding(get: { expanded }, set: { doneExpanded = $0 }) : nil)
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
		sections.flatMap { s in s.group == .done && sections.count > 1 && !isDoneExpanded(s, sections) ? [] : s.agents.map(\.id) }
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
					Text(a.name).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1).layoutPriority(1)
					// в menu bar вместо роли — сессия: агентов там из разных сессий
					if compact {
						if let r = model.store.session(a.session)?.title { Text(r).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).lineLimit(1) }
					} else if let r = model.roleInfo(of: a) {
						RoleChip(name: r.name, icon: r.icon, hue: r.hue)
					}
					Spacer(minLength: DS.Metrics.s2)
					trailing
				}
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
		.onTapGesture(count: 2) { model.openAgentWindow?(a.id) }
		.onTapGesture { compact ? model.reveal(agent: a.id) : win?.open(agent: a.id) }
		.contextMenu {
			Button("Открыть") { if compact { model.reveal(agent: a.id) } else { win?.open(agent: a.id) } }
			Button("Открыть в окне") { model.openAgentWindow?(a.id) }
			if a.canStop { Button("Остановить") { model.stop(a) }.disabled(model.isOffline) }
		}
		.accessibilityElement(children: .contain)
		.accessibilityLabel("\(a.name), \(a.stateWord)")
		.accessibilityAddTraits(selected ? .isSelected : [])
	}

	/// Справа: таймер. Кнопок в строке нет: остановка — в контекстном меню и в «⋯» панели.
	@ViewBuilder private var trailing: some View {
		HStack(spacing: DS.Metrics.s2) {
			if model.store.isNew(a) { DSNewDot() }
			if a.state == .wait || a.canStop || (a.lastTurnMs ?? 0) >= 1000 {
				DSTimer(agent: a, frozenAt: model.frozenAt)
			}
		}
	}
}

/// Вторая строка: этап у работающего, причина у ошибки/блокировки, первая фраза ответа у готового.
struct AgentStageLine: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView

	var body: some View {
		let a = agent
		Group {
			switch a.state {
			case .working, .starting:
				TimelineView(.periodic(from: .now, by: 1)) { ctx in
					let st = a.stage(now: model.frozenAt ?? ctx.date)
					VStack(alignment: .leading, spacing: 2) {
						HStack(spacing: DS.Metrics.s3) {
							Text(st?.text ?? "").foregroundStyle(DS.Palette.textSecondary).lineLimit(1).truncationMode(.middle)
							Spacer(minLength: 0)
							if let st, st.kind == .step || st.kind == .planDone { DSPlanSegments(steps: st.steps) }
						}
						// последняя выполненная задача, как есть
						if let d = a.lastDoneText, d != st?.text {
							HStack(spacing: DS.Metrics.s1) {
								Image(systemName: "checkmark").font(DS.Typography.caption.weight(.semibold))
								Text(d).lineLimit(1).truncationMode(.middle)
							}
							.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
						}
					}
				}
			case .wait:
				EmptyView()
			case .error:
				reason("Ошибка", a.error ?? "ход завершился ошибкой", DS.Palette.danger)
			case .done, .idle:
				if a.isBlocked, let c = a.replyCode {
					reason(c.label, a.replyReason.isEmpty ? answer : a.replyReason, DS.Palette.danger)
				} else if a.replyCode == .doneWithConcerns {
					reason("С оговорками", a.replyReason.isEmpty ? answer : a.replyReason, DS.Palette.textSecondary)
				} else if a.state == .done, !answer.isEmpty {
					Text(answer).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
				} else {
					Text("Ждёт поручения").foregroundStyle(DS.Palette.textSecondary)
				}
			}
		}
		.font(DS.Typography.secondary)
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
