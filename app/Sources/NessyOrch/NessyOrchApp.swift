import SwiftUI
import NessyKit

@main
struct NessyOrchApp: App {
	@NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
	@State private var model = AppModel.shared

	var body: some Scene {
		Window("nessy", id: "main") {
			RootView()
				.environment(model)
				.tint(DS.Palette.accent)
				.onOpenURL { model.handle(url: $0) }
		}
		.defaultSize(width: 900, height: 600)
		.windowResizability(.contentMinSize)
		.commands { AppCommands(model: model) }

		WindowGroup("Агент", id: "agent", for: String.self) { $id in
			if let id {
				AgentWindowView(agentId: id)
					.environment(model)
					.tint(DS.Palette.accent)
			}
		}
		.defaultSize(width: 440, height: 600)

		Window("Роли", id: "roles") {
			RolesView().environment(model).tint(DS.Palette.accent)
		}
		.defaultSize(width: 760, height: 520)

		MenuBarExtra {
			MenuBarPanel().environment(model).tint(DS.Palette.accent)
		} label: {
			MenuBarLabel().environment(model)
		}
		.menuBarExtraStyle(.window)

		Settings {
			SettingsView().environment(model).tint(DS.Palette.accent)
		}
	}
}

struct AppCommands: Commands {
	var model: AppModel
	@Environment(\.openWindow) private var openWindow

	private func main(_ f: () -> Void) { model.openMainWindow?(); f() }

	var body: some Commands {
		CommandGroup(replacing: .newItem) {}
		CommandGroup(replacing: .help) {
			Button("Горячие клавиши") { main { model.showShortcuts = true } }.keyboardShortcut("/")
		}
		CommandMenu("Сессия") {
			Button("Агенты") { model.tab = .agents }.keyboardShortcut("1", modifiers: [.command, .option])
			Button("Источники") { model.tab = .sources }.keyboardShortcut("2", modifiers: [.command, .option])
			Button("Статистика") { model.tab = .stats }.keyboardShortcut("3", modifiers: [.command, .option])
			Divider()
			Button("Предыдущая сессия") { model.step(session: -1) }.keyboardShortcut("[")
			Button("Следующая сессия") { model.step(session: 1) }.keyboardShortcut("]")
			Button("Перейти к…") { main { model.showPalette = true } }.keyboardShortcut("k")
			Button("Поиск по источникам") { model.tab = .sources; model.searchTick += 1 }.keyboardShortcut("f")
			Button("Роли…") { openWindow(id: "roles") }.keyboardShortcut("r", modifiers: [.command, .shift])
			Divider()
			if let s = model.currentSession {
				if s.status == .active { Button("Завершить сессию") { model.closeSession(s.id) } }
				else { Button("Вернуть в работу") { model.reopenSession(s.id) } }
			}
			Divider()
			ForEach(Array(model.store.activeSessions.prefix(9).enumerated()), id: \.element.id) { i, s in
				Button(s.title) { model.show(session: s.id) }.keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
			}
		}
		CommandMenu("Агент") {
			Button("Открыть в окне") {
				if let a = model.targetAgent { model.openAgentWindow?(a.id); model.open(agent: nil) }
			}.keyboardShortcut("o").disabled(model.targetAgent == nil)
			Button("Остановить ход") { if let a = model.targetAgent { model.stop(a) } }
				.keyboardShortcut(".").disabled(model.targetAgent?.canStop != true || model.isOffline)
			Button("Закрыть окно агента") { model.open(agent: nil) }.disabled(model.openAgent == nil)
			Divider()
			Button("Разрешить") { if let t = model.targetPermission { model.decide(agent: t.agent, permission: t.permission, approve: true) } }
				.keyboardShortcut(.return, modifiers: .command).disabled(model.targetPermission == nil || model.isOffline)
			Button("Отклонить") { if let t = model.targetPermission { model.decide(agent: t.agent, permission: t.permission, approve: false) } }
				.keyboardShortcut(.delete, modifiers: .command).disabled(model.targetPermission == nil || model.isOffline || model.composerBusy)
		}
	}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
	private var badgeTask: Task<Void, Never>?
	private var menuPreview: NSWindow?

	func applicationDidFinishLaunching(_ notification: Notification) {
		let model = AppModel.shared
		NSApp.setActivationPolicy(UserDefaults.standard.bool(forKey: "menuBarOnly") ? .accessory : .regular)
		// для снимков и проверки: `-debug.appearance light|dark` (переключателя темы в интерфейсе нет — тема системная)
		switch UserDefaults.standard.string(forKey: "debug.appearance") {
		case "light": NSApp.appearance = NSAppearance(named: .aqua)
		case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
		default: break
		}
		// для снимков: `-debug.menuPreview YES` — панель menu bar в обычном окне (открыть её без клика нельзя)
		if UserDefaults.standard.bool(forKey: "debug.menuPreview") {
			let w = NSWindow(contentRect: NSRect(x: 80, y: 120, width: 320, height: 480), styleMask: [.titled, .closable], backing: .buffered, defer: false)
			w.title = "Nessy Orch menu"
			w.contentView = NSHostingView(rootView: MenuBarPanel().environment(model).tint(DS.Palette.accent))
			w.isReleasedWhenClosed = false
			w.makeKeyAndOrderFront(nil)
			menuPreview = w
		}
		model.openMainWindow = {
			NSApp.activate()
			if let w = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true }) { w.makeKeyAndOrderFront(nil) }
		}
		// бейдж Dock = сколько агентов ждут вас (только то, что требует действия)
		badgeTask = Task { @MainActor in
			var last = -1
			while !Task.isCancelled {
				let n = model.store.attentionCount
				if n != last { last = n; NSApp.dockTile.badgeLabel = n > 0 ? "\(n)" : nil; model.notifier.setBadge(n) }
				try? await Task.sleep(for: .seconds(1))
			}
		}
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

	func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
		if !flag { AppModel.shared.openMainWindow?() }
		return true
	}
}
