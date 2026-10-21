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
	/// агенты вкладки без скрытых (в архиве)
	var agents: [AgentView] { currentSessionId.map { app.store.agents(inSession: $0).filter { !$0.archived } } ?? [] }
	/// карточка открытого агента — только если он в показываемой сессии (после /resume или /clear панель возвращается к списку)
	var openAgent: AgentView? { openAgentId.flatMap { app.store.agents[$0] }.flatMap { $0.session == currentSessionId ? $0 : nil } }
	var targetAgent: AgentView? { openAgent ?? selectedAgentId.flatMap { app.store.agents[$0] }.flatMap { $0.session == currentSessionId ? $0 : nil } }
	var terminal: TerminalTab? { app.terminals.tab(for: key) }

	/// Терминал-блок (оболочки в папке проекта): по умолчанию закрыт, открывается кнопкой в шапке. В нём можно держать несколько терминалов
	/// (вкладки «Терминал 1», «Терминал 2»…); закрытие блока оболочки не убивает — они живут, пока жив проект или пока их не закрыли.
	var shellOpen = false
	/// блок развёрнут на всё окно
	var shellExpanded = false
	struct ShellTabInfo: Identifiable, Equatable { var id: Int; var title: String }
	private(set) var shellTabs: [ShellTabInfo] = []
	var activeShellId: Int?
	private var shellCounter = 0

	func shellKey(_ id: Int) -> String { key + "#shell\(id)" }
	var shell: TerminalTab? { activeShellId.flatMap { app.terminals.tab(for: shellKey($0)) } }

	func toggleShell() {
		if !shellOpen, shellTabs.isEmpty { addShellTab(open: false) }
		withAnimation(dsAnimation(DS.Motion.panel)) {
			shellOpen.toggle()
			if !shellOpen { shellExpanded = false }
		}
		if !shellOpen { focusMainTerminal() }
	}

	/// Новый терминал в блоке (блок открывается, если закрыт). Оболочка стартует до показа: к первому кадру вид терминала уже есть.
	func addShellTab(open: Bool = true) {
		shellCounter += 1
		let info = ShellTabInfo(id: shellCounter, title: "Терминал \(shellCounter)")
		shellTabs.append(info)
		activeShellId = info.id
		app.startShell(for: self, tab: info.id)
		if open, !shellOpen { withAnimation(dsAnimation(DS.Motion.panel)) { shellOpen = true } }
	}

	func selectShellTab(_ id: Int) { if shellTabs.contains(where: { $0.id == id }) { activeShellId = id } }

	/// Соседний терминал по кругу (+1 / −1).
	func cycleShellTab(_ delta: Int) {
		guard shellTabs.count > 1, let i = shellTabs.firstIndex(where: { $0.id == activeShellId }) else { return }
		activeShellId = shellTabs[(i + delta + shellTabs.count) % shellTabs.count].id
	}

	/// Закрыть терминал блока; последний закрыт — закрывается и блок.
	func closeShellTab(_ id: Int) {
		guard let i = shellTabs.firstIndex(where: { $0.id == id }) else { return }
		app.terminals.close(key: shellKey(id))
		shellTabs.remove(at: i)
		if activeShellId == id { activeShellId = shellTabs.isEmpty ? nil : shellTabs[min(i, shellTabs.count - 1)].id }
		if shellTabs.isEmpty {
			withAnimation(dsAnimation(DS.Motion.panel)) { shellOpen = false; shellExpanded = false }
			focusMainTerminal()
		}
	}

	func closeAllShellTabs() { for t in shellTabs { closeShellTab(t.id) } }

	/// Фокус возвращается главному терминалу.
	private func focusMainTerminal() {
		DispatchQueue.main.async { [weak self] in
			guard let c = self?.terminal?.container else { return }
			c.window?.makeFirstResponder(c.terminal)
		}
	}

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
	/// сессия, которой отправлено название: после /clear или /resume сессия другая, и то же название надо отправить ей
	private var pushedSession: String?
	@ObservationIgnored private var titleTask: Task<Void, Never>?

	/// Название чата из заголовка окна Claude: становится названием текущей сессии (через паузу, чтобы не писать на каждое изменение).
	func noteChatTitle(_ osc: String) {
		guard let title = ChatTitle.clean(osc), title != pushedTitle || pushedSession != currentSessionId else { return }
		titleTask?.cancel()
		titleTask = Task { [weak self] in
			try? await Task.sleep(for: .seconds(2))
			guard !Task.isCancelled, let self, let id = self.currentSessionId, self.app.store.session(id)?.title != title else { return }
			self.pushedTitle = title
			self.pushedSession = id
			try? await self.app.store.client.renameSession(id, title: title)
		}
	}

	/// Окно закрыто: терминал завершается; пустая сессия (ни одного агента) удаляется.
	func closed() {
		app.terminals.close(key: key)
		for t in shellTabs { app.terminals.close(key: shellKey(t.id)) }
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
			// центральный терминал забирает то, что осталось от колонок и нижней полосы; плитки блоков лежат поверх своим слоем
			let g = model.dockGeometry()
			CenterView()
				.padding(.leading, g.leftSlot).padding(.trailing, g.rightSlot).padding(.bottom, g.bottomSlot)
			if model.activeWindow != nil { DockLayer() }
			WindowBar()
		}
		.onGeometryChange(for: CGSize.self) { $0.size } action: { model.windowSize = $0 }
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

/// Терминал проекта: содержимое блока. Сверху сплошная шапка: вкладки терминалов («Терминал 1», «Терминал 2»…) и «+», справа меню «⋮»,
/// «развернуть» и «закрыть блок»; один терминал — просто заголовок «Терминал». Под шапкой терминал со своим «консольным» фоном: он
/// начинается ниже шапки, поэтому отступ не пропадает ни при `clear`, ни при прокрутке.
struct ShellBlock: View {
	var win: SessionWindowModel

	var body: some View {
		VStack(spacing: 0) {
			header
			if let tab = win.shell {
				TerminalHost(tab: tab, topInset: 0)
					.id(tab.id)
					.accessibilityLabel("Терминал проекта")
			} else {
				Spacer()
			}
		}
	}

	private var header: some View {
		HStack(spacing: DS.Metrics.s2) {
			if win.shellTabs.count > 1 {
				ScrollView(.horizontal) {
					HStack(spacing: DS.Metrics.s1) {
						ForEach(win.shellTabs) { t in ShellTabPill(win: win, tab: t) }
					}
				}
				.scrollIndicators(.hidden).fixedSize(horizontal: true, vertical: false)
			} else {
				Text("Терминал").font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary).padding(.leading, DS.Metrics.s1)
			}
			ShellIcon(symbol: "plus", help: "Новый терминал (\(Hotkeys.shared.display(.newShellTab)))") { win.addShellTab() }
			Spacer(minLength: 0)
			Menu {
				Button("Новый терминал") { win.addShellTab() }
				if let id = win.activeShellId { Button("Закрыть этот терминал") { win.closeShellTab(id) } }
				if win.shellTabs.count > 1 { Button("Закрыть все терминалы") { win.closeAllShellTabs() } }
				Divider()
				Button(win.shellExpanded ? "Свернуть блок" : "Развернуть блок") { withAnimation(dsAnimation(DS.Motion.panel)) { win.shellExpanded.toggle() } }
				Button("Скрыть блок") { win.toggleShell() }
			} label: {
				Image(systemName: "ellipsis").font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24)
			}
			.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
			.tint(DS.Palette.textSecondary)
			.rotationEffect(.degrees(90)) // вертикальное «⋮», как в остальных блоках
			.help("Ещё")
			ShellIcon(symbol: win.shellExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
					  help: (win.shellExpanded ? "Свернуть" : "Развернуть") + " (\(Hotkeys.shared.display(.expandShell)))") {
				withAnimation(dsAnimation(DS.Motion.panel)) { win.shellExpanded.toggle() }
			}
			ShellIcon(symbol: "xmark", help: "Скрыть терминал (\(Hotkeys.shared.display(.toggleShell)))") { win.toggleShell() }
		}
		.foregroundStyle(DS.Palette.textSecondary)
		.padding(.horizontal, DS.Metrics.s3).padding(.top, DS.Metrics.s1).frame(height: ShellBlock.headerHeight)
		.background(DS.Palette.terminalBackground)
	}

	static let headerHeight: CGFloat = 38
}

/// Вкладка терминала в шапке: название и «×»; активная светлее.
private struct ShellTabPill: View {
	var win: SessionWindowModel
	var tab: SessionWindowModel.ShellTabInfo
	@State private var hover = false

	var body: some View {
		let active = win.activeShellId == tab.id
		HStack(spacing: DS.Metrics.s1) {
			Text(tab.title).font(DS.Typography.secondary).lineLimit(1)
			Button { win.closeShellTab(tab.id) } label: {
				Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 16, height: 16).contentShape(Circle())
			}
			.buttonStyle(.plain).focusEffectDisabled().opacity(active || hover ? 1 : 0.5).help("Закрыть терминал")
		}
		.foregroundStyle(active ? DS.Palette.textPrimary : DS.Palette.textSecondary)
		.padding(.leading, DS.Metrics.s2).padding(.trailing, DS.Metrics.s1).frame(height: 26)
		.background(active ? DS.Palette.hover : (hover ? DS.Palette.hover.opacity(0.5) : .clear), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
		.contentShape(Rectangle())
		.onTapGesture { win.selectShellTab(tab.id) }
		.onHover { hover = $0 }
	}
}

private struct ShellIcon: View {
	var symbol: String
	var help: String
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: symbol).font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24)
				.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
				.background(hover ? DS.Palette.hover : .clear, in: Circle())
				.contentShape(Circle())
		}
		.buttonStyle(.plain).focusEffectDisabled().onHover { hover = $0 }.help(help).accessibilityLabel(help)
	}
}

/// Переключатель проектов в шапке на Liquid Glass: вкладка на проект (активная подсвечена), у каждой — состояние агентов проекта
/// (работают / ждут вас) и «×» по наведению; справа «+» с меню (новая сессия здесь, открыть папку, недавние). Много проектов —
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
				.scrollDisabled(tabsWidth <= 560) // вкладки помещаются — прокрутки нет (иначе при закрытии вкладки полоса мигает)
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

	/// «+»: новая сессия в папке текущего проекта, выбор папки и недавние проекты, которые ещё не открыты.
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
					Button("Новая сессия здесь") { model.newWindowHere() }
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
			.help("Новая сессия (\(Hotkeys.shared.display(.newTerminal))) · открыть папку (\(Hotkeys.shared.display(.openFolder)))")
		}
	}

	private struct Segment: View {
		var window: SessionWindowModel
		var title: String
		var selected: Bool
		var select: () -> Void
		var close: () -> Void
		@State private var hover = false


		/// Боковые слоты одинаковой ширины: «×» справа (по наведению) и пустой слева — название стоит по центру.
		private let slot: CGFloat = 20

		var body: some View {
			Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
				.frame(maxWidth: 140)
				.padding(.horizontal, slot + 4)
				.frame(height: 22)
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
	}
}

/// Шапка поверх окна: слева светофор (система, без обёртки) и переключатель проектов, справа кнопка панели и «⋯» на одной линии.
/// Пока панель открыта, кнопки лежат прямо на её фоне (своей капсулы нет); панель закрыта — они собираются в свою стеклянную капсулу.
private struct WindowBar: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		let m = SessionWindowModel.panelMargin
		let dock = model.dockGeometry()
		let hasPanel = !model.tabs.isEmpty && dock.rightSlot > 0
		let hasLeft = !model.tabs.isEmpty && dock.leftSlot > 0
		// колонка терминала: всё окно минус колонки блоков (если открыты)
		let slot = hasPanel ? dock.rightSlot : 0
		let leftSlot = hasLeft ? dock.leftSlot : 0
		// переключатель по центру колонки терминала; поля слева и справа равны, чтобы не наезжать на светофор и кнопки
		let side = hasLeft ? 12 : max(model.isFullScreen ? 12 : model.lightsTrailing + 12, hasPanel ? 0 : 112)
		ZStack(alignment: .top) {
			HStack(spacing: 0) {
				Color.clear.frame(width: leftSlot, height: 1)
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
					if let win = model.activeWindow {
						BarIcon(systemImage: win.shellOpen ? "terminal.fill" : "terminal", help: (win.shellOpen ? "Скрыть терминал проекта" : "Терминал проекта") + " (\(Hotkeys.shared.display(.toggleShell)))") { win.toggleShell() }
					}
					BarIcon(systemImage: "person.text.rectangle", help: "Роли агентов (\(Hotkeys.shared.display(.roles)))") { openWindow(id: "roles") }
					BarIcon(systemImage: "graduationcap", help: "Фон: обучение (\(Hotkeys.shared.display(.background)))", badge: model.store.learning.badge) { model.openBackground() }
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
	/// число поверх значка (ошибки и ожидание вас); 0 — без значка
	var badge = 0
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: systemImage).font(.system(size: 14, weight: .medium)).frame(width: 30, height: 26)
				.background(hover ? DS.Palette.hover : .clear, in: Capsule())
				.contentShape(Capsule())
				.overlay(alignment: .topTrailing) {
					if badge > 0 {
						DSCount(value: badge).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
							.padding(.horizontal, 4).frame(minWidth: 14, minHeight: 14)
							.background(DS.Palette.accent, in: Capsule())
							.offset(x: 2, y: -2).allowsHitTesting(false)
					}
				}
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
			if model.setup.restarting {
				ProgressView().controlSize(.small)
				Text("Перезапускаю оркестратор…").foregroundStyle(DS.Palette.textPrimary)
			} else {
			Image(systemName: "bolt.slash.fill").foregroundStyle(DS.Palette.danger)
			Text("\(Text("Нет связи с оркестратором").foregroundStyle(DS.Palette.textPrimary))\(Text(" · данные на \(model.store.lastEventAt.formatted(date: .omitted, time: .shortened))").foregroundStyle(DS.Palette.textSecondary))")
			}
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
