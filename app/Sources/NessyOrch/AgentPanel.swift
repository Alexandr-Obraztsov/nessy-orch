import SwiftUI
import NessyKit

/// Где показана карточка агента: внутри правой панели (стекло даёт инспектор) или отдельным окном macOS.
enum PanelMode { case embedded, window }

/// Окно агента без вкладок. Под всем — одна область чата (или итога) на всю высоту панели.
/// Сверху шапка агента и «План», снизу поле ввода — это safeAreaBar: система отодвигает чат на их фактическую высоту, поэтому
/// карточки ничего не закрывают. Раскрытая карточка (цель, статистика) растёт, а чат уходит вниз вместе с ней.
struct AgentPanel: View {
	@Environment(AppModel.self) private var model
	var agentId: String
	var mode: PanelMode = .embedded
	@State private var chat: ChatModel?
	@State private var goalOpen = false
	@State private var planOpen = false
	private var agent: AgentView? { model.store.agents[agentId] }

	var body: some View {
		GeometryReader { geo in
			Group {
				if let a = agent {
					let goal = goalText(a)
					// чат — на всю панель; карточки сверху и снизу — safeAreaBar: система сама отодвигает прокрутку
					// и гасит/размывает чат у их краёв (scrollEdgeEffectStyle .soft). Раскрытые карточки выступают за
					// свёрнутую высоту и ложатся поверх чата, не сдвигая его.
					Group {
						if a.isFinished {
							ResultContent(agent: a, chat: chat)
						} else {
							ChatContent(agent: a, chat: chat, goal: goal)
						}
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.animation(DS.Motion.fade, value: a.isFinished)
					.safeAreaBar(edge: .top, spacing: 0) {
						VStack(spacing: DS.Metrics.s2) {
							AgentHeaderCard(agent: a, mode: mode, goal: goal, expanded: $goalOpen, cap: geo.size.height * 0.3)
							PlanBlock(agent: a, expanded: $planOpen, cap: geo.size.height * 0.3)
						}
						.padding(.horizontal, DS.Metrics.s3).padding(.top, DS.Metrics.s2).padding(.bottom, DS.Metrics.s2)
						.fixedSize(horizontal: false, vertical: true)
						.zIndex(1)
					}
					.safeAreaBar(edge: .bottom, spacing: 0) {
						AgentComposer(agent: a, onEscape: collapseCards)
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
			// для снимков: `-debug.goalOpen YES`, `-debug.planOpen YES` открывают карточки сразу
			goalOpen = UserDefaults.standard.bool(forKey: "debug.goalOpen"); planOpen = UserDefaults.standard.bool(forKey: "debug.planOpen")
			chat?.stop()
			let c = ChatModel(ref: agentId)
			c.start(client: model.store.client)
			chat = c
		}
		.onDisappear { chat?.stop() }
		.onChange(of: agent?.lastReply?.msgId) { _, _ in if let a = agent { model.store.markSeen(agent: a) } }
	}

	/// Esc из поля ввода: сначала сворачивает раскрытые карточки; true — было что сворачивать.
	private func collapseCards() -> Bool {
		guard goalOpen || planOpen else { return false }
		withAnimation(dsAnimation(DS.Motion.disclosure)) { goalOpen = false; planOpen = false }
		return true
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
		case .embedded: content
		}
	}
}

/// Карточка-блок шапки агента: заголовок (слово · справа деталь и шеврон) + содержимое. Вся карточка нажимается.
/// Свёрнутая — заголовок и одна строка; раскрытая — то же, но содержимое целиком.
struct InfoCard<Trailing: View, Content: View>: View {
	var title: String
	@Binding var expanded: Bool
	var help: String
	var cap: CGFloat
	@ViewBuilder var trailing: Trailing
	@ViewBuilder var content: Content

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(spacing: DS.Metrics.s2) {
				Text(title).font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: DS.Metrics.s2)
				trailing
				Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold))
					.foregroundStyle(DS.Palette.textTertiary)
					.rotationEffect(.degrees(expanded ? 90 : 0))
			}
			if expanded {
				// раскрытое содержимое прокручивается внутри карточки; выше 30 % панели не растёт
				ScrollView { content.frame(maxWidth: .infinity, alignment: .leading) }
					.scrollBounceBehavior(.basedOnSize)
					.frame(maxHeight: cap)
					.fixedSize(horizontal: false, vertical: true)
			} else {
				content
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsFloatingCard()
		.contentShape(RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous))
		.onTapGesture { withAnimation(dsAnimation(DS.Motion.disclosure)) { expanded.toggle() } }
		.help(help)
	}
}

/// Верхний блок панели: шапка и «Агент» — одна карточка. Свёрнутая — глиф состояния, имя и справа чип роли, ниже «состояние · таймер».
/// Нажатие раскрывает карточку: описание роли и вся цель целиком (длинная цель прокручивается внутри, не выше `cap`).
/// Кнопка «назад» — в верхней строке панели (см. `AgentsPanel`), здесь кнопок нет.
struct AgentHeaderCard: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var mode: PanelMode
	var goal: String
	@Binding var expanded: Bool
	var cap: CGFloat

	private var text: String {
		var t = goal
		if t.lowercased().hasPrefix("цель:") { t = String(t.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines) }
		return t
	}
	private var role: (name: String, icon: String?, hue: Double, description: String)? { model.roleInfo(of: agent) }
	private var roleDescription: String { role?.description ?? "" }
	private var expandable: Bool { true }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: DS.Metrics.s3) {
					DSStateGlyph(state: agent.ds, size: DS.Metrics.glyphHeader)
					Text(agent.name).font(DS.Typography.panelTitle).foregroundStyle(DS.Palette.textPrimary).lineLimit(1).layoutPriority(1)
					Spacer(minLength: DS.Metrics.s2)
					// чип роли — у правого края; длинное название роли усекается, имя агента важнее
					if let r = role { RoleChip(name: r.name, icon: r.icon, hue: r.hue).frame(maxWidth: 150, alignment: .trailing).help(r.name) }
				}
				HStack(spacing: DS.Metrics.s1) {
					subtitle
					Spacer(minLength: 0)
					if expandable {
						Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold))
							.foregroundStyle(DS.Palette.textTertiary).rotationEffect(.degrees(expanded ? 90 : 0))
					}
				}
				.padding(.leading, DS.Metrics.glyphHeader + DS.Metrics.s3)
			}
			// нажатие по шапке раскрывает описание роли и цель
			.contentShape(Rectangle())
			.onTapGesture { if expandable { withAnimation(dsAnimation(DS.Motion.disclosure)) { expanded.toggle() } } }

			if expanded {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					if !roleDescription.isEmpty {
						Text(roleDescription).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).fixedSize(horizontal: false, vertical: true)
					}
					if !text.isEmpty {
						// вся цель сразу; очень длинная прокручивается внутри карточки
						ScrollView { goalText }
							.scrollBounceBehavior(.basedOnSize)
							.frame(maxHeight: cap)
							.fixedSize(horizontal: false, vertical: true)
					}
					AgentStatsGrid(agent: agent)
				}
				.padding(.top, DS.Metrics.s1)
				.transition(.opacity)
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsFloatingCard()
	}

	private var goalText: some View {
		Text(text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
			.textSelection(.enabled)
			.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// «Работает · 1:14»
	private var subtitle: some View {
		HStack(spacing: DS.Metrics.s1) {
			Text(agent.stateWord)
			if agent.canStop || (agent.lastTurnMs ?? 0) >= 1000 {
				Text("·")
				DSTimer(agent: agent, frozenAt: model.frozenAt)
			}
		}
		.font(DS.Typography.caption)
		.foregroundStyle(DS.Palette.textSecondary)
		.lineLimit(1)
	}
}

/// Блок «План»: свёрнут — «Шаг 2 из 4 · …» с лоадером и сегментами; раскрыт — чеклист
/// (текущий крутится, выполненные с галочкой, будущие тусклые). Без плана — строка этапа.
struct PlanBlock: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	@Binding var expanded: Bool
	var cap: CGFloat

	var body: some View {
		if let plan = agent.plan, !plan.entries.isEmpty {
			let cur = PlanWindowing.current(plan.entries)
			let n = plan.entries.count
			let done = plan.entries.filter { $0.status == .completed }.count
			InfoCard(title: "План", expanded: $expanded, help: expanded ? "Свернуть план" : "Показать весь план", cap: cap) {
				HStack(spacing: DS.Metrics.s2) {
					Text("\(done) из \(n)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).monospacedDigit()
					DSPlanSegments(steps: plan.entries.map(\.status))
				}
			} content: {
				if expanded {
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						ForEach(Array(plan.entries.enumerated()), id: \.offset) { i, e in
							PlanRow(entry: e, current: i == cur, spinning: agent.canStop)
						}
					}
				} else {
					// свёрнуто: лоадер (или галочка) и последняя команда как есть; прогресс — сегменты в заголовке
					HStack(spacing: DS.Metrics.s2) {
						Group {
							if agent.canStop { ProgressView().controlSize(.small).scaleEffect(0.7) }
							else if done == n { Image(systemName: "checkmark").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.quiet) }
							else { Image(systemName: "circle").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
						}
						.frame(width: DS.Metrics.glyphRow, height: DS.Metrics.glyphRow)
						Text(agent.toolText ?? "").font(DS.Typography.secondary)
							.foregroundStyle(agent.canStop ? DS.Palette.textPrimary : DS.Palette.textSecondary)
							.lineLimit(1).truncationMode(.middle)
							.frame(maxWidth: .infinity, alignment: .leading)
					}
				}
			}
		} else if agent.status == .working || agent.status == .starting {
			StageLine(agent: agent)
				.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
				.frame(maxWidth: .infinity, alignment: .leading)
				.dsFloatingCard()
		}
	}
}

struct PlanRow: View {
	var entry: PlanEntry
	var current: Bool
	var spinning: Bool
	var oneLine = false

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
				.lineLimit(oneLine ? 1 : 3)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}
}

/// Нет плана: лоадер и сырой текст текущей команды.
struct StageLine: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView

	var body: some View {
		TimelineView(.periodic(from: .now, by: 5)) { ctx in
			HStack(spacing: DS.Metrics.s2) {
				ProgressView().controlSize(.small).scaleEffect(0.7).frame(width: DS.Metrics.glyphRow)
				Text(agent.stage(now: model.frozenAt ?? ctx.date)?.text ?? "").font(DS.Typography.secondary)
					.foregroundStyle(DS.Palette.textPrimary).lineLimit(1).truncationMode(.middle)
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


/// Подряд идущие вызовы инструментов — как в чатах агентов: одна строка-сводка «Запустил 3 команды · прочитал 2 файла ›», по нажатию — список вызовов
/// со значками видов (терминал, файл, карандаш, поиск, сеть); работающий вызов показан бегущей строкой, ошибки — красным.
struct ToolRunView: View {
	var tools: [AgentEvent.ToolEvent]
	var verbose: Bool
	@State private var open: Bool?

	var body: some View {
		let isOpen = open ?? verbose
		let failed = tools.filter { $0.status == .failed }.count
		let running = tools.last { $0.status == .inProgress || $0.status == .pending }
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { open = !isOpen } } label: {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s1) {
					Text(ToolSummary.text(tools)).foregroundStyle(DS.Palette.textSecondary).lineLimit(2).multilineTextAlignment(.leading)
					if let d = span { Text("· \(Durations.clock(d * 1000))").foregroundStyle(DS.Palette.textTertiary).monospacedDigit() }
					if failed > 0 { Text("· ошибок \(failed)").foregroundStyle(DS.Palette.danger) }
					Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold))
						.rotationEffect(.degrees(isOpen ? 90 : 0))
						.foregroundStyle(DS.Palette.textTertiary)
					Spacer(minLength: 0)
				}
				.font(DS.Typography.secondary)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			// пока вызов идёт, под сводкой — что делается прямо сейчас
			if let r = running, !isOpen {
				HStack(spacing: DS.Metrics.s2) {
					DSStateGlyph(state: .working, size: DS.Metrics.s3)
					Text(ToolPhrases.of(r.view).present).foregroundStyle(DS.Palette.textSecondary).lineLimit(1).truncationMode(.middle)
				}
				.font(DS.Typography.caption)
			}
			if isOpen {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					ForEach(tools, id: \.seq) { ToolCallRow(tool: $0, verbose: verbose) }
				}
				.padding(.leading, DS.Metrics.s3)
				.transition(.opacity)
			}
		}
	}

	private var span: Double? {
		guard let first = tools.first?.ts, let last = tools.compactMap(\.endedTs).max() else { return nil }
		return max(0, (last - first) / 1000)
	}
}

/// Один вызов: значок вида (терминал, файл, карандаш…), что сделано, длительность; в подробном режиме — ввод и вывод.
struct ToolCallRow: View {
	var tool: AgentEvent.ToolEvent
	var verbose: Bool
	@State private var open = false

	var body: some View {
		let phrase = ToolPhrases.of(tool.view)
		let kind = ToolKind.of(name: tool.view.name)
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Button { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } } label: {
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Group {
						switch tool.status {
						case .inProgress, .pending: DSStateGlyph(state: .working, size: DS.Metrics.s3)
						case .failed: Image(systemName: kind.symbol).foregroundStyle(DS.Palette.danger)
						case .completed: Image(systemName: kind.symbol).foregroundStyle(DS.Palette.textTertiary)
						}
					}
					.font(DS.Typography.caption).frame(width: DS.Metrics.s4)
					Text(tool.status == .inProgress || tool.status == .pending ? phrase.present : phrase.past.prefix(1).uppercased() + phrase.past.dropFirst())
						.foregroundStyle(tool.status == .failed ? DS.Palette.danger : DS.Palette.textPrimary).lineLimit(1).truncationMode(.middle)
					Spacer(minLength: DS.Metrics.s2)
					if let d = tool.duration, d >= 0.1 {
						Text(String(format: "%.1f с", d).replacingOccurrences(of: ".", with: ",")).monospacedDigit().foregroundStyle(DS.Palette.textTertiary)
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


/// Вся нужная статистика агента (в раскрытой карточке): ходы, вызовы, время, токены, пространство, возраст, план, очередь, статус ответа.
struct AgentStatsGrid: View {
	var agent: AgentView

	private var rows: [(String, String)] {
		var r: [(String, String)] = []
		let s = agent.stats
		r.append(("Ходов", "\(s.turns)"))
		r.append(("Вызовов инструментов", "\(s.toolCalls)"))
		if s.workMs >= 1000 { r.append(("Время работы", Durations.clock(s.workMs))) }
		if let t = s.tokens {
			var parts = ["вход \(Numbers.compact(t.input))", "выход \(Numbers.compact(t.output))"]
			if t.cached > 0 { parts.append("кэш \(Numbers.compact(t.cached))") }
			r.append(("Токены", "\(Numbers.compact(t.total)) (\(parts.joined(separator: " · ")))"))
		}
		if let p = agent.plan, !p.entries.isEmpty {
			r.append(("План", "\(p.entries.filter { $0.status == .completed }.count) из \(p.entries.count)"))
		}
		if agent.queued > 0 { r.append(("В очереди", "\(agent.queued)")) }
		if let st = agent.lastReply?.status { r.append(("Статус ответа", st)) }
		r.append(("Пространство", agent.space))
		if let d = ISO.parse(agent.createdAt) { r.append(("Создан", Durations.ago(d))) }
		if let d = ISO.parse(agent.lastActivityAt) { r.append(("Активность", Durations.ago(d))) }
		return r
	}

	var body: some View {
		Grid(alignment: .topLeading, horizontalSpacing: DS.Metrics.s3, verticalSpacing: 3) {
			ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
				GridRow {
					Text(row.0).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).gridColumnAlignment(.leading)
					Text(row.1).font(DS.Typography.caption).foregroundStyle(DS.Palette.textPrimary).monospacedDigit()
						.frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
				}
			}
		}
		.padding(.top, DS.Metrics.s1)
	}
}
