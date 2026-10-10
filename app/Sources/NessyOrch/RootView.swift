import SwiftUI
import NessyKit

/// Главное окно: сайдбар сессий → сессия (вкладки в тулбаре) → окно агента справа.
struct RootView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		@Bindable var m = model
		NavigationSplitView(columnVisibility: $m.columnVisibility) {
			SidebarView()
				.navigationSplitViewColumnWidth(min: DS.Metrics.sidebarWidth.min, ideal: DS.Metrics.sidebarWidth.ideal, max: DS.Metrics.sidebarWidth.max)
		} detail: {
			DetailContainer()
		}
		.sheet(isPresented: $m.showPalette) { PaletteView() }
		.sheet(isPresented: $m.showShortcuts) { ShortcutsView() }
		.navigationTitle(model.currentSession?.title ?? "nessy")
		.toolbar { RootToolbar() }
		// без плоской полосы: группы кнопок — стеклянные капсулы над контентом
		.toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
		.frame(minWidth: 640, minHeight: 420)
		.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { w in autoCollapse(windowWidth: w) }
		.onAppear {
			model.openAgentWindow = { id in openWindow(id: "agent", value: id) }
			if model.route == nil || model.currentSession == nil, let s = model.store.activeSessions.first { model.route = .session(s.id) }
		}
		.onChange(of: model.store.sessions.map(\.id)) { _, _ in
			if model.currentSession == nil, let s = model.store.activeSessions.first ?? model.store.doneSessions.first { model.route = .session(s.id) }
		}
	}

	/// Сайдбар сворачивается сам, когда окно уже 760 (screens.md §2).
	private func autoCollapse(windowWidth w: CGFloat) {
		model.windowWidth = w
		if w < 760, model.columnVisibility != .detailOnly { model.columnVisibility = .detailOnly }
	}
}

struct RootToolbar: ToolbarContent {
	@Environment(AppModel.self) private var model

	var body: some ToolbarContent {
		if let s = model.currentSession {
			// вкладки справа от заголовка, а не по центру: заголовку сессии нужнее ширина
			ToolbarItem(placement: .primaryAction) {
				@Bindable var m = model
				// узкое окно: вкладки — значками, чтобы капсула не уходила в «»»
				Picker("Раздел", selection: $m.tab) {
					ForEach(SessionTab.allCases) { t in
						if model.windowWidth < 760 { Image(systemName: t.symbol).help(t.rawValue).tag(t) }
						else { Text(t.rawValue).tag(t) }
					}
				}
				.pickerStyle(.segmented).labelsHidden().fixedSize()
			}
			ToolbarItem(placement: .primaryAction) {
				Menu {
					if s.status == .active { Button("Завершить сессию") { model.closeSession(s.id) } }
					else { Button("Вернуть в работу") { model.reopenSession(s.id) } }
					Button("Скопировать ссылку") { Pasteboard.copy("nessy-orch://session/\(s.id)") }
				} label: { Label("Ещё", systemImage: "ellipsis") }
				.menuIndicator(.hidden)
				.tint(nil as Color?)
				.help("Действия с сессией")
			}
		}
	}
}

/// Центральная область: сессия и окно агента рядом. Список не перекрывается — сужается (screens.md §5).
struct DetailContainer: View {
	@Environment(AppModel.self) private var model
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		VStack(spacing: 0) {
			if model.isOffline, !model.store.sessions.isEmpty { OfflineBanner() }
			GeometryReader { geo in
				let panelW = min(model.panelWidth, geo.size.width - 2 * DS.Metrics.panelInset)
				// узко: окну агента и списку вместе не хватает места — окно агента занимает весь контент
				let full = geo.size.width - panelW - 2 * DS.Metrics.panelInset < 300
				HStack(spacing: 0) {
					if !(full && model.openAgent != nil) {
						content
							.frame(maxWidth: .infinity, maxHeight: .infinity)
							.opacity(model.isOffline ? 0.6 : 1)
					}
					if let a = model.openAgent {
						AgentPanel(agentId: a.id, mode: full ? .full : .floating)
							.frame(width: full ? geo.size.width - 2 * DS.Metrics.panelInset : panelW)
							.frame(maxHeight: .infinity)
							.overlay(alignment: .leading) { if !full { PanelResizeHandle() } }
							.padding(DS.Metrics.panelInset)
							.transition(DS.Motion.panelTransition(reduceMotion: reduceMotion))
					}
				}
				.onChange(of: geo.size.width, initial: true) { _, w in model.detailWidth = w }
			}
		}
		.background(DS.Palette.windowBackground)
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.onExitCommand { model.open(agent: nil) }
	}

	@ViewBuilder private var content: some View {
		if let s = model.currentSession {
			SessionScreen(session: s)
		} else if model.isOffline {
			OfflineEmpty()
		} else {
			ContentUnavailableView {
				Label("Сессий пока нет", systemImage: "rectangle.stack")
			} description: {
				Text("Они появятся, когда Claude Code запустит агентов через nessy.")
			}
		}
	}
}

/// Левый край окна агента тянется: 360…480.
private struct PanelResizeHandle: View {
	@Environment(AppModel.self) private var model
	@State private var start: CGFloat?
	var body: some View {
		Color.clear
			.frame(width: DS.Metrics.s2)
			.contentShape(Rectangle())
			.pointerStyle(.frameResize(position: .leading))
			.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
				.onChanged { v in
					let s = start ?? model.panelWidth
					start = s
					model.panelWidth = min(DS.Metrics.agentPanelWidth.max, max(DS.Metrics.agentPanelWidth.min, s - v.translation.width))
				}
				.onEnded { _ in start = nil })
			.offset(x: -DS.Metrics.s1)
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
			Spacer(minLength: DS.Metrics.s2)
			Button(starting ? "Запускаю…" : "Запустить") { start() }.buttonStyle(.bordered).disabled(starting)
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
			Text("Служба nessy-orch не отвечает.")
		} actions: {
			Button(starting ? "Запускаю…" : "Запустить") {
				starting = true
				Task {
					if !(await Daemon.kickstart()) { model.flash("Не удалось запустить. В терминале: bin/nessy-orch install", error: true) }
					try? await Task.sleep(for: .seconds(2))
					await model.store.refreshStatus()
					starting = false
				}
			}
			.disabled(starting)
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
					if let id = t.agentId {
						Button("Показать") {
							model.reveal(agent: id)
							withAnimation(dsAnimation(DS.Motion.panel)) { model.toast = nil }
						}
						.buttonStyle(.borderless)
					}
				}
				.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
				.frame(maxWidth: 480)
				.glassEffect(.regular, in: Capsule())
				.glassEffectTransition(.materialize)
				.onHover { model.toastHovered = $0 }
				.transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
				.id(t.id)
			}
		}
		.frame(maxWidth: .infinity)
	}
}
