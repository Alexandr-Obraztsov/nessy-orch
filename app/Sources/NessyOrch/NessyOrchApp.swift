import SwiftUI
import NessyKit

@main
struct NessyOrchApp: App {
	@NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
	@State private var model = AppModel.shared

	init() {
		// окна между запусками не восстанавливаем (в том числе полноэкранный режим): каждый запуск — окно «Проект не открыт» или папка из ссылки
		UserDefaults.standard.set(true, forKey: "ApplePersistenceIgnoreState")
	}

	var body: some Scene {
		// Одно главное окно: в нём переключаются терминалы проектов и сессии оркестратора; без проектов — «Проект не открыт»
		Window("TClaude-Orch", id: "main") {
			MainWindowView()
				.environment(model)
				.tint(DS.Palette.accent)
				// ссылки и папки обрабатывает AppDelegate: SwiftUI не должен открывать для них новые окна
				.handlesExternalEvents(preferring: [], allowing: [])
		}
		.windowStyle(.hiddenTitleBar)
		.defaultLaunchBehavior(.presented)
		.defaultSize(width: 1280, height: 780)
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
	@Environment(\.openSettings) private var openSettings

	private var active: SessionWindowModel? { model.activeWindow }

	var body: some Commands {
		// ⌘N/⌘W — окна; когда фокус в терминале, остальные клавиши достаются ему (команд без ⌘ здесь нет)
		CommandGroup(replacing: .newItem) {
			Button("Новый терминал") { model.newWindowHere() }.keyboardShortcut(Hotkeys.shared.shortcut(.newTerminal))
			Button("Открыть папку…") { model.openFolderPanel() }.keyboardShortcut(Hotkeys.shared.shortcut(.openFolder))
		}
		CommandGroup(replacing: .saveItem) {
			Button("Закрыть терминал") { model.closeCurrentWindow() }.keyboardShortcut("w")
		}
		CommandGroup(after: .toolbar) {
			Button("Показать / скрыть панель агентов") { model.toggleAgents() }
				.keyboardShortcut(Hotkeys.shared.shortcut(.togglePanel))
		}
		CommandGroup(replacing: .help) {
			Button("Горячие клавиши и настройки…") { openSettings(); NSApp.activate() }.keyboardShortcut("/")
		}
		// проекты окна: ⌘1…⌘9 переключают, ⇧⌘] / ⇧⌘[ — по кругу
		CommandGroup(after: .windowArrangement) {
			Divider()
			Button("Следующий проект") { model.cycleWindow(1) }.keyboardShortcut(Hotkeys.shared.shortcut(.nextProject))
			Button("Предыдущий проект") { model.cycleWindow(-1) }.keyboardShortcut(Hotkeys.shared.shortcut(.prevProject))
			Divider()
			ForEach(Array(model.projectWindows.prefix(9).enumerated()), id: \.element.key) { i, w in
				Button(model.label(of: w)) { model.raise(w) }.keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
			}
		}
		CommandMenu("Сессия") {
			Button("Перейти к…") { model.showPalette = true }.keyboardShortcut("k")
			Button("Роли…") { openWindow(id: "roles") }.keyboardShortcut("r", modifiers: [.command, .shift])
		}
		CommandMenu("Агент") {
			Button("Открыть в окне") {
				if let a = model.targetAgent { model.openAgentWindow?(a.id); active?.open(agent: nil) }
			}.keyboardShortcut("o").disabled(model.targetAgent == nil)
			Button("Остановить ход") { if let a = model.targetAgent { model.stop(a) } }
				.keyboardShortcut(".").disabled(model.targetAgent?.canStop != true || model.isOffline)
			Button("К списку агентов") { active?.open(agent: nil) }.disabled(active?.openAgent == nil)
		}
	}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
	private var badgeTask: Task<Void, Never>?
	private var menuPreview: NSWindow?

	func applicationDidFinishLaunching(_ notification: Notification) {
		let model = AppModel.shared
		// «просто запустил приложение — всё доступно»: ссылка на встроенный CLI и, если нужно, служба оркестратора
		CLISupport.shared.autoSetup {
			await model.store.refreshStatus()
			if case .online = model.store.daemon { return true }
			return false
		}
		// мастер настройки открывается сам, только если без него не заработает (нет claude, Node.js или службы)
		if UserDefaults.standard.string(forKey: "debug.terminalCommand") == nil {
			Task { @MainActor in
				try? await Task.sleep(for: .seconds(3.5))
				if await SetupModel.problemsExist() { model.setup.start() }
			}
		}
		NSApp.setActivationPolicy(UserDefaults.standard.bool(forKey: "menuBarOnly") ? .accessory : .regular)
		// Finder: пункт «Открыть в TClaude-Orch» (служба приложения и быстрое действие) — один раз при первом запуске
		NSApp.servicesProvider = self
		NSUpdateDynamicServices()
		FinderSupport.autoInstallOnce()
		// светлой темы нет: приложение всегда тёмное
		NSApp.appearance = NSAppearance(named: .darkAqua)
		// для снимков: `-debug.menuPreview YES` — панель menu bar в обычном окне (открыть её без клика нельзя)
		if UserDefaults.standard.bool(forKey: "debug.menuPreview") {
			let w = NSWindow(contentRect: NSRect(x: 80, y: 120, width: 320, height: 480), styleMask: [.titled, .closable], backing: .buffered, defer: false)
			w.title = "TClaude-Orch menu"
			w.contentView = NSHostingView(rootView: MenuBarPanel().environment(model).tint(DS.Palette.accent))
			w.isReleasedWhenClosed = false
			w.makeKeyAndOrderFront(nil)
			menuPreview = w
		}
		// для снимков: `-debug.fullscreen YES|NO` — главное окно уходит в настоящий fullscreen или выходит из него (окно восстанавливается в прежнем режиме)
		if let flag = UserDefaults.standard.object(forKey: "debug.fullscreen") {
			let want = (flag as? Bool) ?? ((flag as? String) == "YES")
			Task { @MainActor in
				// окно появляется не сразу: пробуем раз в секунду, пока не войдёт в fullscreen
				for _ in 0..<12 {
					try? await Task.sleep(for: .seconds(1))
					guard let w = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true && $0.isVisible }) else { continue }
					if w.styleMask.contains(.fullScreen) == want { break }
					NSApp.activate()
					w.makeKeyAndOrderFront(nil)
					w.toggleFullScreen(nil)
					try? await Task.sleep(for: .seconds(3))
					if w.styleMask.contains(.fullScreen) == want { break }
				}
			}
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

	/// Меню Dock: открытые проекты (поднимают своё окно) и «Открыть папку…».
	func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
		let m = NSMenu()
		let model = AppModel.shared
		let open = NSMenuItem(title: "Открыть папку…", action: #selector(openStart), keyEquivalent: "")
		open.target = self
		m.addItem(open)
		let wins = model.projectWindows
		if !wins.isEmpty { m.addItem(.separator()) }
		for w in wins {
			let it = NSMenuItem(title: model.label(of: w), action: #selector(raiseWindow(_:)), keyEquivalent: "")
			it.target = self
			it.representedObject = w.key
			m.addItem(it)
		}
		return m
	}
	@objc private func raiseWindow(_ item: NSMenuItem) {
		if let k = item.representedObject as? String, let w = AppModel.shared.projectWindows.first(where: { $0.key == k }) { AppModel.shared.raise(w) }
	}
	@objc private func openStart() { AppModel.shared.openFolderPanel() }
	@objc private func openSession(_ item: NSMenuItem) { if let id = item.representedObject as? String { AppModel.shared.show(session: id) } }

	/// Служба Finder (Info.plist → NSServices): папка или файл → окно в этой папке (для файла — в его папке).
	@objc func openInTClaude(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString>) {
		let urls = pboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
		for u in urls { AppModel.shared.openTerminal(dir: FinderSupport.directory(of: u)) }
	}

	/// Папки и ссылки `nessy-orch://…`: `open -a "TClaude-Orch" <папка>`, перетаскивание папки на значок, `nessy-orch .`.
	func application(_ application: NSApplication, open urls: [URL]) { urls.forEach { AppModel.shared.handle(url: $0) } }

	func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { AppModel.shared.confirmQuit() }

	/// окна и полноэкранный режим между запусками не восстанавливаем: каждый запуск — чистое окно в выбранной папке
	func application(_ app: NSApplication, shouldRestoreApplicationState coder: NSCoder) -> Bool { false }
	func application(_ app: NSApplication, shouldSaveApplicationState coder: NSCoder) -> Bool { false }

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

	func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
		if !flag { AppModel.shared.showMainWindow() }
		return true
	}
}
