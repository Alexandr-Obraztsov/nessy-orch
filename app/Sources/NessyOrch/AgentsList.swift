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
									if i > 0 { DSSeparator(leading: DS.Metrics.s4) }
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
		// слева индикатора состояния нет: состояние видно по группе, в которой стоит карточка
		HStack(alignment: .firstTextBaseline, spacing: 0) {
			// карточка: 1) заголовок на всю ширину · 2) роль, токены, вызовы, статус · (итог или причина у не работающего) · 3) план, контекст, время
			VStack(alignment: .leading, spacing: 2) {
				Text(model.store.title(of: a)).font(DS.Typography.secondary.weight(.semibold)).foregroundStyle(DS.Palette.textPrimary).lineLimit(2)
				meta
				AgentStageLine(agent: a)
				footer
			}
		}
		.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2 + DS.Metrics.s1)
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
		.accessibilityElement(children: .ignore)
		.accessibilityLabel(accessibilityText)
		.accessibilityAction(named: "Открыть") { compact ? model.reveal(agent: a.id) : win?.open(agent: a.id) }
		.accessibilityAddTraits(selected ? .isSelected : [])
	}

	/// Вторая строка: «Роль · 173 тыс. токенов · 5 вызовов · Работает» (в menu bar вместо роли — сессия: агенты там из разных сессий).
	/// Статус — в конце и цветом состояния. Узкая колонка: части вытесняются по порядку (слово «токенов», «вызовов» → «выз.», роль, вызовы),
	/// статус и токены остаются; разделитель «·» стоит только между частями.
	private var metaVariants: [[String]] {
		let head: String? = compact ? model.store.session(a.session)?.title : model.roleInfo(of: a)?.name
		let t = a.stats.tokens.flatMap { $0.total > 0 ? $0.total : nil }
		let c = a.stats.toolCalls > 0 ? a.stats.toolCalls : nil
		let full = [head, t.map { "\(Numbers.compact($0)) токенов" }, c.map { Numbers.count($0, "вызов", "вызова", "вызовов") }]
		let mid = [head, t.map { Numbers.compact($0) }, c.map { "\($0)\u{00A0}выз." }]
		let short = [t.map { Numbers.compact($0) }, c.map { "\($0)\u{00A0}выз." }]
		let tiny = [t.map { Numbers.compact($0) }]
		// числа с единицами не рвутся по строкам: обычные пробелы внутри части заменены неразрывными
		return [full, mid, short, tiny].map { $0.compactMap { $0?.replacingOccurrences(of: " ", with: "\u{00A0}") } }
	}

	@ViewBuilder private var meta: some View {
		ViewThatFits(in: .horizontal) {
			ForEach(Array(metaVariants.enumerated()), id: \.offset) { _, parts in metaLine(parts).fixedSize() }
			metaLine([]).fixedSize()
		}
		.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func metaLine(_ parts: [String]) -> some View {
		HStack(spacing: 4) {
			ForEach(Array(parts.enumerated()), id: \.offset) { i, p in
				if i > 0 { Text("·") }
				Text(p).lineLimit(1)
			}
			if !parts.isEmpty { Text("·") }
			Text(a.stateWord).foregroundStyle(statusColor).lineLimit(1)
		}
	}

	/// Всё, что видно в карточке, одной фразой для VoiceOver.
	private var accessibilityText: String {
		var p = [model.store.title(of: a), a.stateWord]
		if !compact, let r = model.roleInfo(of: a)?.name { p.append("роль \(r)") }
		if let t = a.stats.tokens, t.total > 0 { p.append("\(Numbers.compact(t.total)) токенов") }
		if a.stats.toolCalls > 0 { p.append(Numbers.count(a.stats.toolCalls, "вызов", "вызова", "вызовов")) }
		if let pct = a.stats.contextPct { p.append("контекст заполнен на \(pct) процентов") }
		if let steps = a.plan?.entries, !steps.isEmpty { p.append("план: выполнено \(steps.filter { $0.status == .completed }.count) из \(steps.count)") }
		if let perm = a.pendingPermissions.first { p.append("ждёт разрешения: \(perm.title)") }
		return p.joined(separator: ", ")
	}

	private var statusColor: Color {
		if a.state == .error || a.isBlocked { return DS.Palette.danger }
		if a.state == .wait { return DS.Palette.attention }
		return DS.Palette.textSecondary
	}

	/// Последняя строка: план («▮▮▯ 3 из 5»), кольцо контекста и время. Пустая — не рисуется.
	@ViewBuilder private var footer: some View {
		// план показываем в любом состоянии, пока он есть: у ждущего — где остановился, у готового — выполненный
		let steps = a.plan?.entries.map(\.status) ?? []
		let showTimer = a.state == .wait || a.canStop || (a.lastTurnMs ?? 0) >= 1000
		if !steps.isEmpty || (a.stats.contextPct ?? 0) > 0 || showTimer || model.store.isNew(a) {
			HStack(spacing: DS.Metrics.s3) {
				if !steps.isEmpty {
					HStack(spacing: DS.Metrics.s2) {
						DSPlanSegments(steps: steps)
						Text("\(min(steps.filter { $0 == .completed }.count + (steps.contains(.inProgress) ? 1 : 0), steps.count)) из \(steps.count)").monospacedDigit()
					}
				}
				if let pct = a.stats.contextPct, pct > 0 {
					HStack(spacing: 4) {
						DSContextMeter(pct: pct, size: 11)
						Text("\(pct)\u{00A0}%").monospacedDigit()
					}
				}
				if model.store.isNew(a) { DSNewDot() }
				if showTimer { DSTimer(agent: a, frozenAt: model.frozenAt) }
			}
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.top, 2)
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
				// у работающего третьей строки нет: статус во второй, прогресс — в последней
				EmptyView()
			case .wait:
				// что именно ждёт решения
				if let p = a.pendingPermissions.first {
					reason("Разрешение", p.title + (a.pendingPermissions.count > 1 ? " +\(a.pendingPermissions.count - 1)" : ""), DS.Palette.attention)
				}
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
			.lineLimit(1).truncationMode(.tail).help(text)
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
