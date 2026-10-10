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

	static func fresh(dir: String) -> Self { .init(key: UUID().uuidString, dir: dir, session: nil) }
	static func reopen(session: String, dir: String) -> Self { .init(key: "s-" + session, dir: dir, session: session) }
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
	/// первая сессия окна (id стабилен); чаты Claude, начатые в этом окне, получают свои сессии с `origin` = она
	private(set) var sessionId: String?
	/// агент, чья карточка открыта в панели (nil — виден список агентов)
	private(set) var openAgentId: String?
	/// выбранная строка списка (курсор ↑/↓); открыть её — ↩
	var selectedAgentId: String?
	/// Esc в поле ввода просит список агентов забрать фокус (↑/↓ и J/K снова работают)
	var listFocusTick = 0
	/// боковая панель с агентами
	var columnVisibility: NavigationSplitViewVisibility = .all
	var panelHidden: Bool { columnVisibility == .detailOnly }
	/// полноэкранный режим: шапка системная и прячется вместе с меню; терминалу нужен минимальный отступ
	var isFullScreen = false
	/// ширина боковой панели: тянется за правый край, запоминается для всех окон
	var panelWidth: CGFloat = {
		let v = UserDefaults.standard.double(forKey: "sidePanelWidth")
		return v > 0 ? min(max(CGFloat(v), DS.Metrics.sidePanelWidth.min), DS.Metrics.sidePanelWidth.max) : DS.Metrics.sidePanelWidth.ideal
	}()
	/// центр светофора от верха окна: по нему подбирается высота шапки
	var lightsCenter: CGFloat = 0
	/// высота шапки: светофор, кнопка панели и «⋯» стоят на одной линии
	var barHeight: CGFloat { max(40, lightsCenter * 2) }
	private var started = false
	/// сессию создало это окно (а не открыло уже существующую)
	private var createdSession = false

	init(app: AppModel, value: TerminalWindowValue) {
		self.app = app
		self.value = value
		sessionId = value.session
		// для снимков: `-debug.panel hidden` — боковая панель свёрнута с самого начала
		if UserDefaults.standard.string(forKey: "debug.panel") == "hidden" { columnVisibility = .detailOnly }
	}

	/// сессия текущего чата Claude этого окна: самая недавно активная среди сессий окна (один чат = одна сессия)
	var currentSessionId: String? {
		guard let origin = sessionId else { return nil }
		let mine = app.store.sessions.filter { $0.id == origin || $0.origin == origin }
		let best = mine.max { ($0.claude?.at ?? $0.updatedAt) < ($1.claude?.at ?? $1.updatedAt) }
		return best?.id ?? origin
	}
	/// сессия относится к этому окну (его первая сессия или чат, начатый в нём)
	func owns(_ id: String) -> Bool { id == sessionId || app.store.session(id)?.origin == sessionId }

	var session: SessionView? { currentSessionId.flatMap { app.store.session($0) } }
	var agents: [AgentView] { currentSessionId.map { app.store.agents(inSession: $0) } ?? [] }
	var openAgent: AgentView? { openAgentId.flatMap { app.store.agents[$0] } }
	var targetAgent: AgentView? { openAgent ?? selectedAgentId.flatMap { app.store.agents[$0] } }
	var terminal: TerminalTab? { app.terminals.tab(for: key) }

	/// Открыть карточку агента в панели (id) или вернуться к списку (nil). Пружина прерываема.
	func open(agent id: String?) {
		withAnimation(dsAnimation(DS.Motion.panel)) {
			openAgentId = id
			if let id { selectedAgentId = id; columnVisibility = .all }
		}
		if let id, let a = app.store.agents[id] { app.store.markSeen(agent: a) }
	}

	func toggleAgents() { withAnimation(dsAnimation(DS.Motion.panel)) { columnVisibility = panelHidden ? .all : .detailOnly } }

	/// Первый показ окна: сессия оркестратора (если нет) и терминал в папке. Без связи терминал всё равно запускается.
	func bootstrap() async {
		guard !started else { return }
		started = true
		if sessionId == nil {
			do {
				let s = try await app.store.client.createSession(title: TerminalLaunch.sessionTitle(directory: dir))
				app.store.apply(.session(s))
				sessionId = s.id
				createdSession = true
				app.rememberDirectory(dir, session: s.id)
			} catch {
				app.flash("Сессия не создана: \(error.localizedDescription)", error: true)
			}
		}
		app.startTerminal(for: self)
	}

	/// Окно закрыто: терминал завершается; пустая сессия (ни агентов, ни состояния Claude) удаляется.
	func closed() {
		app.terminals.close(key: key)
		// пустые сессии окна (ни агентов, ни чата Claude) удаляются; сессия с чатом остаётся — её можно продолжить через /resume
		for s in app.store.sessions where owns(s.id) && s.claudeId == nil && s.claude == nil && app.store.agents(inSession: s.id).isEmpty {
			let id = s.id
			Task { try? await app.store.client.deleteSession(id) }
		}
		app.forget(window: self)
	}
}

extension EnvironmentValues {
	/// Окно-терминал, в котором лежит вид (nil — вне такого окна, например в menu bar).
	@Entry var sessionWindow: SessionWindowModel? = nil
}

/// Окно-терминал: слева системная панель агентов (парящее стекло), в центре терминал. Шапка прозрачная, того же цвета, что терминал;
/// терминал всегда начинается под ней, поэтому открытие и закрытие панели меняет только его ширину.
struct SessionWindowView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow
	var value: TerminalWindowValue

	var body: some View {
		let win = model.window(for: value)
		SessionWindowBody(win: win)
			.environment(\.sessionWindow, win)
			.onAppear { model.registerWindowOpeners(openWindow) }
			.task { await win.bootstrap() }
	}
}

private struct SessionWindowBody: View {
	@Environment(AppModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@Bindable var win: SessionWindowModel

	var body: some View {
		ZStack(alignment: .topLeading) {
			DS.Palette.terminalBackground
			HStack(spacing: 0) {
				SidePanel(win: win)
				CenterView()
			}
			WindowBar(win: win)
		}
		.ignoresSafeArea()
		.navigationTitle(Projects.name(ofPath: win.dir))
		.background { WindowConfigurator(window: win) { model.activeWindow = win } }
		// листы показывает только окно в фокусе
		.sheet(isPresented: Binding(get: { model.showPalette && model.activeWindow === win }, set: { model.showPalette = $0 })) { PaletteView() }
		.sheet(isPresented: Binding(get: { model.showShortcuts && model.activeWindow === win }, set: { model.showShortcuts = $0 })) { ShortcutsView() }
		.frame(minWidth: 760, minHeight: 440)
		.onAppear {
			model.activeWindow = win
			// для снимков: `-debug.togglePanel YES` — через 9 с панель сворачивается или разворачивается
			if UserDefaults.standard.bool(forKey: "debug.togglePanel") { DispatchQueue.main.asyncAfter(deadline: .now() + 9) { win.toggleAgents() } }
			// для снимков: `-debug.openAgent <id>` открывает карточку агента через 9 с после запуска
			if let id = UserDefaults.standard.string(forKey: "debug.openAgent") {
				DispatchQueue.main.asyncAfter(deadline: .now() + 9) { if model.store.agents[id]?.session == win.sessionId { win.open(agent: id) } }
			}
		}
	}
}

/// Своя боковая панель: колонка на всю высоту окна того же тёмного тона, что терминал, справа тонкая линия. Ширину можно менять,
/// потянув за правый край (двойной щелчок — вернуть обычную); светофор и кнопка панели лежат на её верхней строке.
private struct SidePanel: View {
	@Bindable var win: SessionWindowModel
	@State private var dragStart: CGFloat?
	@State private var hovering = false

	var body: some View {
		let w = win.panelWidth
		AgentsPanel()
			.padding(.top, win.barHeight)
			.frame(width: w)
			.background(DS.Palette.sidebarSurface)
			.overlay(alignment: .trailing) { Rectangle().fill(hovering || dragStart != nil ? DS.Palette.accent.opacity(0.7) : DS.Palette.separator).frame(width: dragStart != nil ? 2 : DS.Metrics.hairline) }
			.overlay(alignment: .trailing) { handle }
			.frame(width: win.panelHidden ? 0 : w, alignment: .leading)
			.clipped()
			.opacity(win.panelHidden ? 0 : 1)
			.allowsHitTesting(!win.panelHidden)
			.accessibilityHidden(win.panelHidden)
	}

	/// Полоса захвата у правого края: курсор «↔», перетаскивание меняет ширину в пределах min…max.
	private var handle: some View {
		Color.clear.frame(width: 9).contentShape(Rectangle())
			.onHover { h in
				hovering = h
				if h { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
			}
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { g in
					if dragStart == nil { dragStart = win.panelWidth }
					let m = DS.Metrics.sidePanelWidth
					win.panelWidth = min(max((dragStart ?? m.ideal) + g.translation.width, m.min), m.max)
				}
				.onEnded { _ in
					dragStart = nil
					UserDefaults.standard.set(Double(win.panelWidth), forKey: "sidePanelWidth")
				})
			.onTapGesture(count: 2) {
				win.panelWidth = DS.Metrics.sidePanelWidth.ideal
				UserDefaults.standard.set(Double(win.panelWidth), forKey: "sidePanelWidth")
			}
			.help("Потяните, чтобы изменить ширину; двойной щелчок — по умолчанию")
	}
}

/// Шапка поверх окна: справа от светофора кнопка панели (просто иконка), справа стеклянная «⋯». Без заголовка и без плашки.
private struct WindowBar: View {
	@Bindable var win: SessionWindowModel

	var body: some View {
		HStack(spacing: DS.Metrics.s1) {
			// светофор рисует система; в полноэкранном режиме его нет
			Color.clear.frame(width: win.isFullScreen ? 0 : 74, height: 1)
			BarIcon(systemImage: "sidebar.left", help: "Панель агентов (⌥⌘B)") { win.toggleAgents() }
			Spacer(minLength: 0)
			MoreMenu(glass: true)
		}
		.padding(.horizontal, 14)
		.frame(height: win.barHeight)
		.frame(maxWidth: .infinity, alignment: .top)
	}
}

private struct BarIcon: View {
	var systemImage: String
	var help: String
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: systemImage).font(.system(size: 15, weight: .medium)).frame(width: 32, height: 28).contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
		.onHover { hover = $0 }
		.help(help).accessibilityLabel(help)
	}
}

/// Запуск без папки: окно-терминал в домашнем каталоге (если за это время не пришла ссылка или папка).
struct LauncherView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow
	@Environment(\.dismissWindow) private var dismissWindow

	var body: some View {
		Color.clear
			.frame(width: 1, height: 1)
			.task {
				model.registerWindowOpeners(openWindow)
				let d = UserDefaults.standard
				if d.string(forKey: "debug.terminalDir") != nil || d.string(forKey: "debug.openSession") != nil { model.suppressHomeWindow = true }
				// ссылка или папка приходят сразу после старта: даём им шанс открыть своё окно
				try? await Task.sleep(for: .milliseconds(600))
				if !model.hasTerminalWindows, !model.suppressHomeWindow { model.openFromLauncher() }
				model.runDebugLaunch()
				dismissWindow(id: "launcher")
			}
	}
}

/// Нет связи: полоса над контентом; список остаётся, но тускнеет, таймеры замирают (screens.md §3h).
struct OfflineBanner: View {
	@Environment(AppModel.self) private var model
	@State private var starting = false

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

	private func start() {
		starting = true
		Task {
			let ok = await Daemon.kickstart()
			if !ok { model.flash("Не удалось запустить. В терминале: bin/nessy-orch install", error: true) }
			try? await Task.sleep(for: .seconds(2))
			await model.store.refreshStatus()
			starting = false
		}
	}
}

/// Нет связи и нечего показать: символ, фраза, одно действие.
struct OfflineEmpty: View {
	@Environment(AppModel.self) private var model
	@State private var starting = false
	var body: some View {
		ContentUnavailableView {
			Label("Нет связи с оркестратором", systemImage: "bolt.slash")
		} description: {
			Text("Служба nessy-orch не отвечает. Перезапустить: меню «⋯» внизу слева.")
		}
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
