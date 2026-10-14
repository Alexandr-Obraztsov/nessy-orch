import SwiftUI
import NessyKit

/// Окно агента без вкладок, как в Claude: сверху заголовок (суть задачи) и кнопка «стоп», под ним «План»; в ленте первым идёт блок «Роль + поручение»,
/// дальше сам чат. Снизу поле ввода — это safeAreaBar: система отодвигает чат на их фактическую высоту, поэтому
/// карточки ничего не закрывают.
struct AgentPanel: View {
	@Environment(AppModel.self) private var model
	var agentId: String
	@State private var chat: ChatModel?
	@State private var planOpen = false
	private var agent: AgentView? { model.store.agents[agentId] }

	var body: some View {
		GeometryReader { geo in
			Group {
				if let a = agent {
					let goal = model.store.goal(of: a)
					// чат — на всю панель; карточки сверху и снизу — safeAreaBar: система сама отодвигает прокрутку
					// и гасит/размывает чат у их краёв (scrollEdgeEffectStyle .soft). Раскрытые карточки выступают за
					// свёрнутую высоту и ложатся поверх чата, не сдвигая его.
					Group {
						if a.isFinished {
							ResultContent(agent: a, chat: chat, goal: goal)
						} else {
							ChatContent(agent: a, chat: chat, goal: goal)
						}
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.animation(DS.Motion.fade, value: a.isFinished)
					.safeAreaBar(edge: .top, spacing: 0) {
						VStack(spacing: DS.Metrics.s2) {
							AgentTitleBar(agent: a, title: model.store.title(of: a))
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
		.task(id: agentId) {
			// для снимков: `-debug.planOpen YES` раскрывает план сразу
			planOpen = UserDefaults.standard.bool(forKey: "debug.planOpen")
			chat?.stop()
			let c = ChatModel(ref: agentId)
			c.start(client: model.store.client)
			chat = c
		}
		.onDisappear { chat?.stop() }
		.onChange(of: agent?.lastReply?.msgId) { _, _ in if let a = agent { model.store.markSeen(agent: a) } }
	}

	/// Esc из поля ввода: сворачивает раскрытый план; true — было что сворачивать.
	private func collapseCards() -> Bool {
		guard planOpen else { return false }
		withAnimation(dsAnimation(DS.Motion.disclosure)) { planOpen = false }
		return true
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

/// Шапка агента: состояние, заголовок (суть задачи) и кнопка «остановить» (пока агент работает). Без карточки и без имени агента:
/// удаление и открытие в окне не предусмотрены — завершённые агенты убираются сами. «Назад» — в верхней строке панели (см. `AgentsPanel`).
struct AgentTitleBar: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var title: String

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
			DSStateGlyph(state: agent.ds, size: DS.Metrics.glyphRow)
				.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 3 }
			Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(DS.Palette.textPrimary)
				.lineLimit(2).multilineTextAlignment(.leading).layoutPriority(1)
				.help(title)
			Spacer(minLength: DS.Metrics.s2)
			if agent.canStop {
				TitleButton(symbol: "stop.fill", help: "Остановить ход (⌘.)") { model.stop(agent) }.disabled(model.isOffline)
			}
		}
		.padding(.horizontal, DS.Metrics.s1)
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

/// Начало ленты: «Роль · состояние» и поручение (первое сообщение) сдержанным блоком; длинное — первые строки и «Показать ещё».
struct AgentIntro: View {
	@Environment(AppModel.self) private var model
	var agent: AgentView
	var goal: String
	@State private var open = false

	private var role: String? { model.roleInfo(of: agent)?.name }
	private var long: Bool { goal.count > 280 || goal.split(separator: "\n").count > 6 }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s1) {
				if let role {
					Text("Роль").foregroundStyle(DS.Palette.textSecondary)
					Text(role).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
				}
				Spacer(minLength: DS.Metrics.s2)
				Text(agent.stateWord).foregroundStyle(DS.Palette.textSecondary)
				if agent.canStop || (agent.lastTurnMs ?? 0) >= 1000 {
					DSTimer(agent: agent, frozenAt: model.frozenAt).foregroundStyle(DS.Palette.textSecondary)
				}
			}
			.font(DS.Typography.secondary)
			if !goal.isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					Text(goal).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
						.lineLimit(open ? nil : 6).textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.mask {
							if long && !open {
								LinearGradient(stops: [.init(color: .black, location: 0.7), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom)
							} else {
								Color.black
							}
						}
					if long {
						Button(open ? "Свернуть" : "Показать ещё") { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } }
							.buttonStyle(.plain).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					}
				}
				.padding(DS.Metrics.s3)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous))
			}
		}
	}
}

private struct TitleButton: View {
	var symbol: String
	var help: String
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: symbol).font(.system(size: 10, weight: .medium))
				.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
				.frame(width: 22, height: 22)
				.background(hover ? DS.Palette.hover : .clear, in: Circle())
				.contentShape(Circle())
		}
		.buttonStyle(.plain).focusEffectDisabled()
		.onHover { hover = $0 }
		.help(help)
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
						Text(agent.activity ?? "").font(DS.Typography.secondary)
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
					Text(ToolKind.activity(name: r.view.name)).foregroundStyle(DS.Palette.textSecondary).lineLimit(1).truncationMode(.middle)
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
