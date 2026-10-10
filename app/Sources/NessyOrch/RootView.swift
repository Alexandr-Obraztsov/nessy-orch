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
	/// панель агентов, её ширина и полный экран — общие для всех проектов окна (хранятся в `AppModel`)
	var panelHidden: Bool { !app.showAgents }
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
	/// сессию создало это окно (а не открыло уже существующую)
	private var createdSession = false

	init(app: AppModel, value: TerminalWindowValue) {
		self.app = app
		self.value = value
		sessionId = value.session
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
			if let id { selectedAgentId = id; app.showAgents = true }
		}
		if let id, let a = app.store.agents[id] { app.store.markSeen(agent: a) }
	}

	func toggleAgents() { app.toggleAgents() }

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

/// Главное окно: сверху шапка (светофор, переключатель проектов, кнопки), слева терминал активного проекта, справа панель его агентов.
/// Проектов в окне несколько: у каждого свой терминал и своя сессия оркестратора, переключаются тогглом в шапке (⌘1…⌘9).
struct MainWindowView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		let win = model.activeWindow
		MainWindowBody()
			.environment(\.sessionWindow, win)
			.onAppear { model.registerWindowOpeners(openWindow) }
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
		.sheet(isPresented: Bindable(model).showShortcuts) { ShortcutsView() }
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

/// Переключатель проектов в шапке на Liquid Glass. Один терминал — просто название текущей командной строки; два и больше —
/// сегментный тоггл (по сегменту на проект, активный подсвечен) и «+». Контекстное меню сегмента — закрыть.
private struct ProjectSwitcher: View {
	@Environment(AppModel.self) private var model
	@Namespace private var ns

	var body: some View {
		let many = model.tabs.count > 1
		HStack(spacing: 2) {
			ForEach(model.tabs, id: \.key) { w in
				Segment(title: model.label(of: w), selected: many && w === model.activeWindow, plain: !many, ns: ns) { model.select(w) }
					.contextMenu { Button("Закрыть терминал") { model.close(w) } }
			}
			if many {
				Button { model.newWindowHere() } label: {
					Image(systemName: "plus").font(.system(size: 11, weight: .semibold)).frame(width: 24, height: 22).contentShape(Rectangle())
				}
				.buttonStyle(.plain).focusEffectDisabled().foregroundStyle(DS.Palette.textTertiary).help("Новый терминал в этой папке (\(Hotkeys.shared.display(.newTerminal)))")
			}
		}
		.padding(3)
		.glassEffect(.regular, in: Capsule())
		.animation(dsAnimation(DS.Motion.panel), value: model.activeKey)
	}

	private struct Segment: View {
		var title: String
		var selected: Bool
		var plain: Bool
		var ns: Namespace.ID
		var action: () -> Void
		@State private var hover = false
		var body: some View {
			Button(action: action) {
				Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
					.frame(maxWidth: 140)
					.padding(.horizontal, 12).frame(height: 22)
					.foregroundStyle(plain || selected || hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
					.background {
						if selected { Capsule().fill(DS.Palette.textPrimary.opacity(0.14)).matchedGeometryEffect(id: "seg", in: ns) }
					}
					.contentShape(Capsule())
			}
			.buttonStyle(.plain).focusEffectDisabled()
			.onHover { hover = $0 }
			.allowsHitTesting(!plain)
		}
	}
}

/// Шапка поверх окна: слева светофор (система, без обёртки) и переключатель проектов, справа кнопка панели и «⋯» на одной линии.
/// Пока панель открыта, кнопки лежат прямо на её фоне (своей капсулы нет); панель закрыта — они собираются в свою стеклянную капсулу.
private struct WindowBar: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		let m = SessionWindowModel.panelMargin
		HStack(spacing: 0) {
			if !model.isFullScreen { Color.clear.frame(width: 78, height: 1) }
			if !model.tabs.isEmpty { ProjectSwitcher().padding(.leading, model.isFullScreen ? 12 : 0) }
			Spacer(minLength: 0)
			HStack(spacing: 2) {
				BarIcon(systemImage: "sidebar.right", help: "Панель агентов (\(Hotkeys.shared.display(.togglePanel)))") { model.toggleAgents() }
				MoreMenu()
			}
			.padding(.horizontal, 5)
			.frame(height: 30)
			.background {
				Capsule().fill(.clear).glassEffect(.regular, in: Capsule())
					.opacity(model.showAgents && !model.tabs.isEmpty ? 0 : 1)
					.animation(dsAnimation(DS.Motion.panel), value: model.showAgents)
			}
			// правый край кнопок = правый край панели минус внутренний отступ
			.padding(.trailing, m + 8)
		}
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
