import SwiftUI
import NessyKit

/// Значение окна-терминала (аргумент `WindowGroup`): одинаковые значения — одно и то же окно (поднимается, а не дублируется).
struct TerminalWindowValue: Codable, Hashable {
	/// ключ окна: случайный для нового окна, `s-<id сессии>` для повторного открытия сессии
	var key: String
	/// рабочая папка терминала
	var dir: String
	/// уже существующая сессия оркестратора (nil — окно создаст свою)
	var session: String?
	/// чат главного агента, который нужно продолжить (`--resume`); nil — новый чат
	var chat: String?

	static func fresh(dir: String) -> Self { .init(key: UUID().uuidString, dir: dir, session: nil, chat: nil) }
	static func reopen(session: String, dir: String, chat: String?) -> Self { .init(key: "s-" + session, dir: dir, session: session, chat: chat) }
}

struct LaunchFailure: Equatable {
	var command: String
	var code: Int32?
}

/// Состояние окна-терминала: папка, сессия оркестратора, терминал, карточка агента в боковой панели.
/// Окон несколько (одно окно — один терминал и одна сессия), поэтому это не часть `AppModel`.
@MainActor
@Observable
final class SessionWindowModel {
	let app: AppModel
	let value: TerminalWindowValue
	var key: String { value.key }
	var dir: String { value.dir }
	/// сессия оркестратора этого проекта: одна на вкладку. Создаётся при запуске (`POST /sessions {cwd, chatId}`) или берётся у
	/// повторно открытой сессии; `/clear` и `/resume` внутри Claude её не меняют (чат обновляет хук Stop)
	private(set) var sessionId: String?
	/// агент, чья карточка открыта в панели (nil — виден список агентов)
	private(set) var openAgentId: String?
	/// выбранная строка списка (курсор ↑/↓); открыть её — ↩
	var selectedAgentId: String?
	/// Esc в поле ввода просит список агентов забрать фокус (↑/↓ и J/K снова работают)
	var listFocusTick = 0
	var panelWidth: CGFloat { get { app.panelWidth } set { app.panelWidth = newValue } }
	var isFullScreen: Bool { app.isFullScreen }
	/// общая линия шапки: центр светофора, кнопок справа и заголовка панели — на этой высоте от верха окна
	static let barCenter: CGFloat = 26
	/// отступ плитки панели от краёв окна
	static let panelMargin: CGFloat = 8
	/// высота верхней строки панели (заголовок и кнопки), центр строки = barCenter
	static var rowHeight: CGFloat { 2 * (barCenter - panelMargin) }
	/// терминал начинается под шапкой
	var barHeight: CGFloat { 2 * Self.barCenter - 4 }
	private var started = false
	/// агент не запустился (команда не найдена, мгновенный выход с ошибкой): окно остаётся и показывает причину
	var launchFailure: LaunchFailure?

	init(app: AppModel, value: TerminalWindowValue) {
		self.app = app
		self.value = value
		sessionId = value.session
	}

	/// Цепочка сессий вкладки: после `/clear` и `/resume` Claude начинает другой чат, а сессия привязана к чату всегда, поэтому у прежней
	/// сессии появляется `successor`. Вкладка идёт по цепочке до последней.
	var sessionChain: [String] {
		guard let start = sessionId else { return [] }
		var out = [start]
		var cur = start
		while let next = app.store.session(cur)?.successor, !out.contains(next), out.count < 32 {
			out.append(next)
			cur = next
		}
		return out
	}
	/// текущая сессия вкладки — последняя в цепочке (сессия нового чата после `/clear`)
	var currentSessionId: String? { sessionChain.last.flatMap { app.store.session($0) == nil ? nil : $0 } }
	/// сессия относится к этому проекту (текущая или одна из прежних чатов вкладки)
	func owns(_ id: String) -> Bool { sessionChain.contains(id) }

	var session: SessionView? { currentSessionId.flatMap { app.store.session($0) } }
	var agents: [AgentView] { currentSessionId.map { app.store.agents(inSession: $0) } ?? [] }
	/// карточка открытого агента — только если он в показываемой сессии (после /resume или /clear панель возвращается к списку)
	var openAgent: AgentView? { openAgentId.flatMap { app.store.agents[$0] }.flatMap { $0.session == currentSessionId ? $0 : nil } }
	var targetAgent: AgentView? { openAgent ?? selectedAgentId.flatMap { app.store.agents[$0] }.flatMap { $0.session == currentSessionId ? $0 : nil } }
	var terminal: TerminalTab? { app.terminals.tab(for: key) }

	/// Открыть карточку агента в панели (id) или вернуться к списку (nil). Пружина прерываема.
	func open(agent id: String?) {
		withAnimation(dsAnimation(DS.Motion.panel)) {
			openAgentId = id
			if let id { selectedAgentId = id; app.showAgents = true }
		}
		if let id, let a = app.store.agents[id] { app.store.markSeen(agent: a) }
	}

	func toggleAgents() { app.toggleAgents() }

	/// Запустить агента заново после сбоя запуска.
	func retryLaunch() {
		launchFailure = nil
		app.startTerminal(for: self)
	}

	/// id чата Claude этой вкладки: новый (`--session-id`) или продолжаемый (`--resume`)
	private(set) var newChat: String?

	/// Первый показ: сессия оркестратора (новая или прежняя), затем терминал с Claude. Сервер не ответил — несколько повторов, и терминал
	/// всё равно запускается (без сессии агенты не получат окружения), а причина показывается тостом.
	func bootstrap() async {
		guard !started else { return }
		started = true
		if sessionId == nil {
			let chat = UUID().uuidString.lowercased()
			var failure: Error?
			for attempt in 0..<4 {
				do {
					sessionId = try await app.store.client.createSession(cwd: dir, chatId: chat).id
					newChat = chat
					failure = nil
					break
				} catch {
					failure = error
					if attempt < 3 { try? await Task.sleep(for: .seconds(1)) }
				}
			}
			if let failure { app.flash("Оркестратор недоступен: агенты в этой вкладке не получат сессию (\(failure.localizedDescription))", error: true) }
		} else if value.chat == nil {
			newChat = UUID().uuidString.lowercased() // сессия есть, чата у неё нет (создана CLI): начинаем новый чат, Stop сообщит его серверу
		}
		app.startTerminal(for: self)
	}

	private var pushedTitle: String?
	@ObservationIgnored private var titleTask: Task<Void, Never>?

	/// Название чата из заголовка окна Claude: становится названием текущей сессии (через паузу, чтобы не писать на каждое изменение).
	func noteChatTitle(_ osc: String) {
		guard let title = ChatTitle.clean(osc), title != pushedTitle else { return }
		titleTask?.cancel()
		titleTask = Task { [weak self] in
			try? await Task.sleep(for: .seconds(2))
			guard !Task.isCancelled, let self, let id = self.currentSessionId, self.app.store.session(id)?.title != title else { return }
			self.pushedTitle = title
			try? await self.app.store.client.renameSession(id, title: title)
		}
	}

	/// Окно закрыто: терминал завершается; пустая сессия (ни одного агента) удаляется.
	func closed() {
		app.terminals.close(key: key)
		// сервер останавливает работающих агентов сессии (они без хозяина жгли бы токены); сессия остаётся — её можно продолжить (`--resume`)
		let client = app.store.client
		for id in sessionChain {
			let empty = app.store.agents(inSession: id).isEmpty
			Task {
				try? await client.sessionClosed(id)
				// проект без единого агента ничего не хранит: сессия не копится
				if empty { try? await client.deleteSession(id) }
			}
		}
		app.forget(window: self)
	}
}

extension EnvironmentValues {
	/// Окно-терминал, в котором лежит вид (nil — вне такого окна, например в menu bar).
	@Entry var sessionWindow: SessionWindowModel? = nil
}

/// Главное окно: сверху шапка (светофор, переключатель проектов, кнопки), слева терминал активного проекта, справа панель его агентов.
/// Проектов в окне несколько: у каждого свой терминал и своя сессия оркестратора, переключаются тогглом в шапке (⌘1…⌘9).
struct MainWindowView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		let win = model.activeWindow
		MainWindowBody()
			.environment(\.sessionWindow, win)
			.onAppear { model.registerWindowOpeners(openWindow); model.runDebugLaunchOnce() }
	}
}

private struct MainWindowBody: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		ZStack(alignment: .topLeading) {
			DS.Palette.terminalBackground
			// терминал стоит слева и не двигается; панель справа забирает только ширину
			HStack(spacing: 0) {
				CenterView()
				if model.activeWindow != nil { SidePanel() }
			}
			WindowBar()
		}
		.ignoresSafeArea()
		.navigationTitle(model.activeWindow.map { model.label(of: $0) } ?? "TClaude-Orch")
		.background { WindowConfigurator(app: model) }
		.sheet(isPresented: Bindable(model).showPalette) { PaletteView() }
		.frame(minWidth: 760, minHeight: 440)
		.onAppear {
			// для снимков: `-debug.togglePanel YES` — через 9 с панель сворачивается или разворачивается
			if UserDefaults.standard.bool(forKey: "debug.togglePanel") { DispatchQueue.main.asyncAfter(deadline: .now() + 9) { model.toggleAgents() } }
			// для снимков: `-debug.openAgent <id>` открывает карточку агента через 9 с после запуска
			if let id = UserDefaults.standard.string(forKey: "debug.openAgent") {
				DispatchQueue.main.asyncAfter(deadline: .now() + 9) {
					if let w = model.tabs.first(where: { $0.owns(model.store.agents[id]?.session ?? "") }) { model.select(w); w.open(agent: id) }
				}
			}
		}
	}
}

/// Панель агентов справа: плитка одного ровного цвета от верха окна до низа; в её верхней строке заголовок и кнопки (кнопки едут вместе
/// с панелью). Ширину можно менять, потянув за левый край (двойной щелчок — вернуть обычную). Слот занимает только ширину панели:
/// терминал слева не двигается и не меняет высоту. Панель показывает агентов активного проекта.
private struct SidePanel: View {
	@Environment(AppModel.self) private var model
	@State private var dragStart: CGFloat?
	@State private var hovering = false
	private let m = SessionWindowModel.panelMargin

	var body: some View {
		let w = model.panelWidth
		let hidden = !model.showAgents
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.panelRadius, style: .continuous)
		AgentsPanel()
			.id(model.activeKey)
			.frame(width: w)
			.clipShape(shape)
			.background(DS.Palette.panelSurface, in: shape)
			.overlay(shape.strokeBorder(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
			.overlay(alignment: .leading) { handle }
			.overlay(shape.strokeBorder(dragStart != nil || hovering ? DS.Palette.accent.opacity(0.55) : .clear, lineWidth: 1.5))
			.padding(.top, m).padding(.bottom, m).padding(.trailing, m).padding(.leading, m / 2)
			.frame(width: hidden ? 0 : w + m * 1.5, alignment: .trailing)
			.clipped()
			.opacity(hidden ? 0 : 1)
			.allowsHitTesting(!hidden)
			.accessibilityHidden(hidden)
	}

	/// Полоса захвата у левого края: курсор «↔», перетаскивание влево расширяет панель в пределах min…max.
	private var handle: some View {
		Color.clear.frame(width: 10).contentShape(Rectangle())
			.onHover { h in
				hovering = h
				if h { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
			}
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if dragStart == nil { dragStart = model.panelWidth }
					let r = DS.Metrics.sidePanelWidth
					model.panelWidth = min(max((dragStart ?? r.ideal) - g.translation.width, r.min), r.max)
				}
				.onEnded { _ in dragStart = nil })
			.onTapGesture(count: 2) { model.panelWidth = DS.Metrics.sidePanelWidth.ideal }
			.help("Потяните, чтобы изменить ширину; двойной щелчок — по умолчанию")
	}
}

/// Переключатель проектов в шапке на Liquid Glass: вкладка на проект (активная подсвечена), у каждой — состояние агентов проекта
/// (работают / ждут вас) и «×» по наведению; справа «+» с меню (новый терминал здесь, открыть папку, недавние). Много проектов —
/// полоса прокручивается, активный всегда виден. Один проект — просто его название и «+».
private struct ProjectSwitcher: View {
	@Environment(AppModel.self) private var model
	@State private var tabsWidth: CGFloat = 0

	var body: some View {
		HStack(spacing: 2) {
			ScrollViewReader { proxy in
				ScrollView(.horizontal) {
					HStack(spacing: 2) {
						ForEach(model.tabs, id: \.key) { w in
							Segment(window: w, title: model.label(of: w), selected: w === model.activeWindow,
									select: { model.select(w) }, close: { model.close(w) })
								.id(w.key)
						}
					}
					.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { tabsWidth = $0 }
				}
				.scrollIndicators(.hidden)
				// ширина — ровно по вкладкам (но не шире 560 pt: дальше полоса прокручивается)
				.frame(width: min(tabsWidth, 560))
				.onChange(of: model.activeKey) { _, k in withAnimation(dsAnimation(DS.Motion.panel)) { proxy.scrollTo(k) } }
			}
			AddMenu()
		}
		.padding(3)
		.glassEffect(.regular, in: Capsule())
		.animation(dsAnimation(DS.Motion.panel), value: model.activeKey)
	}

	/// «+»: новый терминал в папке текущего проекта, выбор папки и недавние проекты, которые ещё не открыты.
	private struct AddMenu: View {
		@Environment(AppModel.self) private var model
		private var recent: [String] {
			let open = Set(model.tabs.map(\.dir))
			return model.recentProjects.filter { !open.contains($0) && FileManager.default.fileExists(atPath: $0) }.prefix(20).map { $0 }
		}
		/// Сессия подписана названием чата (если Claude его уже придумал) и папкой.
		private func sessionButton(_ s: SessionView) -> some View {
			Button(ChatTitle.label(title: s.title, cwd: s.cwd)) { model.show(session: s.id) }.help(s.cwd ?? s.title)
		}
		private func folderButton(_ d: String) -> some View {
			Button(Projects.name(ofPath: d)) { model.openTerminal(dir: d) }.help(d)
		}
		var body: some View {
			Menu {
				if model.activeWindow != nil {
					Button("Новый терминал здесь") { model.newWindowHere() }
				}
				Button("Открыть папку…") { model.openFolderPanel() }
				let sessions = model.recentSessions(limit: 20)
				if !sessions.isEmpty {
					Divider()
					Section("Продолжить сессию") {
						ForEach(sessions.prefix(5)) { s in sessionButton(s) }
						if sessions.count > 5 {
							Menu("Ещё сессии") { ForEach(sessions.dropFirst(5)) { s in sessionButton(s) } }
						}
					}
				}
				if !recent.isEmpty {
					Divider()
					Section("Папки") {
						ForEach(recent.prefix(5), id: \.self) { d in folderButton(d) }
						if recent.count > 5 {
							Menu("Ещё папки") { ForEach(recent.dropFirst(5), id: \.self) { d in folderButton(d) } }
						}
					}
				}
			} label: {
				Image(systemName: "plus").font(.system(size: 11, weight: .semibold)).frame(width: 24, height: 22).contentShape(Rectangle())
			}
			.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).focusEffectDisabled()
			.foregroundStyle(DS.Palette.textTertiary)
			.help("Новый терминал (\(Hotkeys.shared.display(.newTerminal))) · открыть папку (\(Hotkeys.shared.display(.openFolder)))")
		}
	}

	private struct Segment: View {
		var window: SessionWindowModel
		var title: String
		var selected: Bool
		var select: () -> Void
		var close: () -> Void
		@State private var hover = false

		private var sum: SessionSummary { window.agents.summary }

		/// Боковые слоты одинаковой ширины: индикатор слева, «×» справа (по наведению), название между ними. Отступы с обеих сторон равны по построению.
		private let slot: CGFloat = 20

		var body: some View {
			Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
				.frame(maxWidth: 140)
				.padding(.horizontal, slot + 4)
				.frame(height: 22)
				.overlay(alignment: .leading) { indicator.frame(width: slot, height: 14).padding(.leading, 4) }
				.overlay(alignment: .trailing) {
					Button(action: close) {
						Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).frame(width: 14, height: 14)
							.background(DS.Palette.hover, in: Circle()).contentShape(Circle())
					}
					.buttonStyle(.plain).focusEffectDisabled().help("Закрыть проект")
					.frame(width: slot).padding(.trailing, 4)
					.opacity(hover ? 1 : 0).allowsHitTesting(hover)
				}
				.foregroundStyle(selected || hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
				// активный проект подсвечен всегда (даже единственный); цвет меняется без привязки геометрии: при появлении новой вкладки подсветка не «залипает» на прежней
				.background { Capsule().fill(selected ? DS.Palette.textPrimary.opacity(0.14) : hover ? DS.Palette.hover : .clear) }
				.animation(DS.Motion.pick(DS.Motion.layout, reduceMotion: false), value: selected)
				.contentShape(Capsule())
				.onTapGesture { select() }
				.onHover { h in withAnimation(DS.Motion.pick(DS.Motion.layout, reduceMotion: false)) { hover = h } }
				.help(window.dir)
				.contextMenu { Button("Закрыть проект") { close() } }
				.accessibilityElement(children: .combine)
				.accessibilityAddTraits(selected ? .isSelected : [])
		}

		/// Ждут вас — число на акценте; иначе работают — вращающийся глиф; иначе ничего.
		@ViewBuilder private var indicator: some View {
			if sum.needsYou > 0 {
				DSCount(value: sum.needsYou).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
					.padding(.horizontal, 5).background(DS.Palette.accent, in: Capsule())
					.help("Ждут вас: \(sum.needsYou)")
			} else if sum.working > 0 {
				DSStateGlyph(state: .working, size: 11).help("Работают: \(sum.working)")
			}
		}
	}
}

/// Шапка поверх окна: слева светофор (система, без обёртки) и переключатель проектов, справа кнопка панели и «⋯» на одной линии.
/// Пока панель открыта, кнопки лежат прямо на её фоне (своей капсулы нет); панель закрыта — они собираются в свою стеклянную капсулу.
private struct WindowBar: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		let m = SessionWindowModel.panelMargin
		let hasPanel = model.showAgents && !model.tabs.isEmpty
		// колонка терминала: всё окно минус плитка панели (если открыта)
		let slot = hasPanel ? model.panelWidth + m * 1.5 : 0
		// переключатель по центру колонки терминала; поля слева и справа равны, чтобы не наезжать на светофор и кнопки
		let side = max(model.isFullScreen ? 12 : model.lightsTrailing + 12, hasPanel ? 0 : 112)
		ZStack(alignment: .top) {
			HStack(spacing: 0) {
				HStack {
					if !model.tabs.isEmpty { ProjectSwitcher() }
				}
				.frame(maxWidth: .infinity)
				.padding(.horizontal, side)
				Color.clear.frame(width: slot, height: 1)
			}
			HStack(spacing: 0) {
				Spacer(minLength: 0)
				HStack(spacing: 2) {
					BarIcon(systemImage: "sidebar.right", help: "Панель агентов (\(Hotkeys.shared.display(.togglePanel)))") { model.toggleAgents() }
					SettingsButton()
				}
				.padding(.horizontal, 5)
				.frame(height: 30)
				.background {
					Capsule().fill(.clear).glassEffect(.regular, in: Capsule())
						.opacity(hasPanel ? 0 : 1)
				}
				// правый край кнопок = правый край панели минус внутренний отступ
				.padding(.trailing, m + 8)
			}
		}
		.animation(dsAnimation(DS.Motion.panel), value: hasPanel)
		.frame(height: 30)
		.padding(.top, SessionWindowModel.barCenter - 15)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
	}
}

private struct BarIcon: View {
	var systemImage: String
	var help: String
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: systemImage).font(.system(size: 14, weight: .medium)).frame(width: 30, height: 26)
				.background(hover ? DS.Palette.hover : .clear, in: Capsule())
				.contentShape(Capsule())
		}
		.buttonStyle(.plain).focusEffectDisabled()
		.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
		.onHover { hover = $0 }
		.help(help).accessibilityLabel(help)
	}
}

/// Нет связи: полоса над контентом; список остаётся, но тускнеет, таймеры замирают (screens.md §3h).
struct OfflineBanner: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		HStack(spacing: DS.Metrics.s3) {
			Image(systemName: "bolt.slash.fill").foregroundStyle(DS.Palette.danger)
			Text("\(Text("Нет связи с оркестратором").foregroundStyle(DS.Palette.textPrimary))\(Text(" · данные на \(model.store.lastEventAt.formatted(date: .omitted, time: .shortened))").foregroundStyle(DS.Palette.textSecondary))")
		}
		.font(DS.Typography.secondary)
		.lineLimit(1)
		.padding(.horizontal, DS.Metrics.contentInset).padding(.vertical, DS.Metrics.s2)
		.background(DS.Palette.surface)
		.overlay(alignment: .bottom) { DSSeparator() }
		.transition(.opacity)
	}
}

/// Тост: сверху по центру, капсула стекла, один за раз; наведение держит (design-system.md §8.10).
struct ToastView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		ZStack {
			if let t = model.toast {
				HStack(spacing: DS.Metrics.s2) {
					if let s = t.state { DSStateGlyph(state: s, size: DS.Metrics.glyphRow) }
					Text(t.text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).lineLimit(2)
					if t.agentId != nil { Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary) }
				}
				.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
				.frame(maxWidth: 480)
				.glassEffect(.regular, in: Capsule())
				.glassEffectTransition(.materialize)
				.contentShape(Capsule())
				.onTapGesture {
					guard let id = t.agentId else { return }
					model.reveal(agent: id)
					withAnimation(dsAnimation(DS.Motion.panel)) { model.toast = nil }
				}
				.help(t.agentId != nil ? "Показать агента" : "")
				.onHover { model.toastHovered = $0 }
				.transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
				.id(t.id)
			}
		}
		.frame(maxWidth: .infinity)
	}
}
