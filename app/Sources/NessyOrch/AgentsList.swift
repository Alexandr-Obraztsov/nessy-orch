import SwiftUI
import NessyKit

/// Сессия: три вкладки в тулбаре. Заголовок — только в тулбаре, в контенте его нет.
struct SessionScreen: View {
	@Environment(AppModel.self) private var model
	var session: SessionView

	var body: some View {
		let agents = model.store.agents(inSession: session.id)
		ZStack {
			switch model.tab {
			case .agents: AgentsTab(agents: agents)
			case .sources: SourcesTab(session: session)
			case .stats: StatsTab(agents: agents)
			}
		}
		.animation(DS.Motion.fade, value: model.tab)
	}
}

// MARK: - Вкладка «Агенты»

/// Агенты по смыслу: Нужны вы → В работе → Готово → Ждут поручения. Если секция одна — без заголовка.
struct AgentsTab: View {
	@Environment(AppModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	var agents: [AgentView]
	@State private var doneExpanded: Bool?
	@FocusState private var listFocused: Bool

	var body: some View {
		let sections = AgentGrouping.sections(agents)
		// заливка — одна на экран: у окна агента, если оно открыто на ждущем, иначе у первого запроса в списке
		let panelHasDecision = model.openAgent.map { !$0.pendingPermissions.isEmpty } ?? false
		let firstPermission = panelHasDecision ? nil : sections.first { $0.group == .needsYou }?.agents.first { !$0.pendingPermissions.isEmpty }?.pendingPermissions.first?.requestId
		let ids = visibleIds(sections)
		if agents.isEmpty {
			ContentUnavailableView {
				Label("Агентов пока нет", systemImage: "person.2")
			} description: {
				Text("Их запускает Claude.")
			}
		} else {
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s5) {
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
										AgentRow(agent: a, prominentRequest: firstPermission)
									}
								}
								.dsGroup()
								// уходящая группа гаснет быстро, чтобы не наслаиваться на переехавшие строки
								.transition(.asymmetric(insertion: DS.Motion.rowTransition(reduceMotion: reduceMotion),
														removal: .opacity.animation(.easeOut(duration: 0.12))))
							}
						}
						.transition(.asymmetric(insertion: .opacity, removal: .opacity.animation(.easeOut(duration: 0.12))))
					}
				}
				.padding(.horizontal, DS.Metrics.contentInset)
				.padding(.top, DS.Metrics.s4).padding(.bottom, DS.Metrics.s6)
				.animation(DS.Motion.pick(DS.Motion.layout, reduceMotion: reduceMotion), value: sections.map { "\($0.group.rawValue):\($0.agents.map(\.id))" })
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
			.background {
				// клик по пустому месту закрывает окно агента
				Color.clear.contentShape(Rectangle()).onTapGesture { model.open(agent: nil) }
			}
			.focusable()
			.focused($listFocused)
			.focusEffectDisabled()
			.onAppear { listFocused = true }
			.onChange(of: model.selectedAgentId) { _, _ in listFocused = true }
			// ↑/↓ и J/K двигают курсор, ↩ открывает; в поле ввода эти клавиши не перехватываются (фокус не здесь)
			.onKeyPress(.downArrow) { move(1, ids); return .handled }
			.onKeyPress(.upArrow) { move(-1, ids); return .handled }
			.onKeyPress("j") { move(1, ids); return .handled }
			.onKeyPress("k") { move(-1, ids); return .handled }
			.onKeyPress(.return) {
				guard let id = model.selectedAgentId, ids.contains(id) else { return .ignored }
				model.open(agent: id); return .handled
			}
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

	private func move(_ d: Int, _ ids: [String]) {
		guard !ids.isEmpty else { return }
		let i = model.selectedAgentId.flatMap { ids.firstIndex(of: $0) }
		let next = i.map { min(max(0, $0 + d), ids.count - 1) } ?? (d > 0 ? 0 : ids.count - 1)
		model.select(agent: ids[next])
	}
}

/// Строка агента: две строки (имя · роль · время / этап), у ждущего — блок решения (design-system.md §8.4, screens.md §3b).
struct AgentRow: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var prominentRequest: String?
	var compact = false
	@State private var hovering = false

	private var a: AgentView { agent }
	private var selected: Bool { model.selectedAgentId == a.id && !compact }

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			DSStateGlyph(state: a.ds)
				.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
			VStack(alignment: .leading, spacing: DS.Metrics.s1) {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Text(a.name).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					// в menu bar вместо роли — сессия: агентов там из разных сессий
					if let r = compact ? model.store.session(a.session)?.title : roleName {
						Text(r).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
					}
					Spacer(minLength: DS.Metrics.s2)
					trailing
				}
				AgentStageLine(agent: a)
				ForEach(a.pendingPermissions) { p in
					DecisionBlock(agent: a, permission: p, prominent: p.requestId == prominentRequest, compact: compact)
						.padding(.top, DS.Metrics.s1)
				}
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
		.onTapGesture { compact ? model.reveal(agent: a.id) : model.toggle(agent: a.id) }
		.contextMenu {
			Button("Открыть") { model.open(agent: a.id) }
			Button("Открыть в окне") { model.openAgentWindow?(a.id) }
			if a.canStop { Button("Остановить") { model.stop(a) }.disabled(model.isOffline) }
			Divider()
			Button("Скопировать ссылку") { Pasteboard.copy("nessy-orch://agent/\(a.id)") }
		}
		.accessibilityElement(children: .contain)
		.accessibilityLabel("\(a.name), \(a.stateWord)")
		.accessibilityAddTraits(selected ? .isSelected : [])
	}

	/// Роль — тихо, строчными; нет роли — ничего.
	private var roleName: String? {
		guard let id = a.role else { return nil }
		return (model.store.role(id)?.name ?? id).lowercased()
	}

	/// Справа: таймер; у работающего при наведении — «Остановить» на том же месте.
	@ViewBuilder private var trailing: some View {
		HStack(spacing: DS.Metrics.s2) {
			if model.store.isNew(a) { DSNewDot() }
			if hovering, a.state == .working, !compact {
				Button("Остановить") { model.stop(a) }
					.buttonStyle(.borderless).font(DS.Typography.secondary)
					.disabled(model.isOffline)
					.help(model.isOffline ? "Нет связи" : "Остановить ход (⌘.)")
			} else if a.state == .wait || a.canStop || (a.lastTurnMs ?? 0) >= 1000 {
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
					HStack(spacing: DS.Metrics.s3) {
						Text(st?.text ?? "Работает").foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
						Spacer(minLength: 0)
						if let st, st.kind == .step || st.kind == .planDone { DSPlanSegments(steps: st.steps) }
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

// MARK: - Блок решения

/// Запрос прав: «Хочет выполнить» · команда (моно) · риск одним предложением · Отклонить / Разрешить.
/// Заливка — только у первого запроса на экране.
struct DecisionBlock: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var permission: PermissionBrief
	var prominent: Bool
	var compact = false
	@State private var expanded = false

	var body: some View {
		let command = PermissionText.command(permission.title)
		let risk = RiskAssessor.assess(command)
		let long = command.count > 160 || command.contains("\n")
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text("Хочет выполнить").font(DS.Typography.caption.weight(.medium)).foregroundStyle(DS.Palette.attention)
			Text(command)
				.font(DS.Typography.mono).foregroundStyle(DS.Palette.textPrimary)
				.lineLimit(expanded ? nil : (compact ? 1 : 4))
				.truncationMode(.middle)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
			if long, !compact {
				Button(expanded ? "Свернуть" : "Показать целиком") { withAnimation(dsAnimation(DS.Motion.panel)) { expanded.toggle() } }
					.buttonStyle(.borderless).font(DS.Typography.caption)
			}
			if let reason = risk.reasons.first {
				Label {
					Text(riskSentence(reason, risk.level))
				} icon: {
					Image(systemName: "exclamationmark.triangle")
				}
				.font(DS.Typography.caption)
				.foregroundStyle(risk.level == .danger ? DS.Palette.danger : DS.Palette.textSecondary)
				.fixedSize(horizontal: false, vertical: true)
			}
			HStack(spacing: DS.Metrics.s2) {
				Spacer(minLength: 0)
				Button("Отклонить") { model.decide(agent: agent, permission: permission, approve: false) }
					.buttonStyle(.bordered)
					.help("Отклонить (⌘⌫)")
				approve
			}
			.disabled(model.isOffline)
			.help(model.isOffline ? "Нет связи" : "")
		}
		.padding(DS.Metrics.s3)
		.background(DS.Palette.attentionTint, in: ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.s2)), isUniform: true))
		.overlay(ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.s2)), isUniform: true).stroke(DS.Palette.attentionStroke, lineWidth: DS.Metrics.hairline))
		.accessibilityElement(children: .contain)
		.accessibilityLabel("\(agent.name) хочет выполнить: \(command)")
	}

	@ViewBuilder private var approve: some View {
		let b = Button("Разрешить") { model.decide(agent: agent, permission: permission, approve: true) }
			.help("Разрешить (⌘↩)")
		if prominent { b.buttonStyle(.borderedProminent) } else { b.buttonStyle(.bordered) }
	}

	private func riskSentence(_ reason: String, _ level: Risk.Level) -> String {
		let r = reason.prefix(1).uppercased() + reason.dropFirst()
		return level == .danger ? "\(r) — проверьте команду" : String(r)
	}
}
