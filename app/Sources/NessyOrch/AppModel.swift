import SwiftUI
import NessyKit

/// Тост: глиф состояния + фраза + необязательное «Показать».
struct Toast: Identifiable, Equatable {
	var id = UUID()
	var state: DS.AgentState?
	var text: String
	var agentId: String?
	var isError = false
}

/// Состояние интерфейса поверх OrchStore: выбор, окно агента, вкладки, уведомления.
@MainActor
@Observable
final class AppModel {
	let store: OrchStore
	/// проекты приложения в порядке открытия: окно одно, в нём переключаются терминалы и их сессии оркестратора
	private(set) var tabs: [SessionWindowModel] = []
	/// последние открытые папки (новые первыми), для начального экрана
	private(set) var recentProjects: [String] = UserDefaults.standard.stringArray(forKey: "recentProjects") ?? []
	/// ключ проекта, который сейчас показан
	private(set) var activeKey: String?
	/// проект, который сейчас показан (команды меню действуют на него)
	var activeWindow: SessionWindowModel? { tabs.first { $0.key == activeKey } ?? tabs.first }
	/// полноэкранный режим окна: терминалу не нужен отступ под светофор
	var isFullScreen = false
	/// правый край светофора от левого края окна: переключатель проектов начинается правее
	var lightsTrailing: CGFloat = 66
	/// показать главное окно ждали, пока из окружения появится `openWindow` (ссылка при холодном старте)
	@ObservationIgnored private var pendingShow = false
	@ObservationIgnored var debugLaunched = false
	/// черновики поля ввода по агентам
	var drafts: [String: String] = [:]
	var showPalette = false
	var toast: Toast?
	/// желаемая ширина правой панели (тянется за левый край), 340…480
	var panelWidth: CGFloat = {
		let w = UserDefaults.standard.double(forKey: "panelWidth")
		return w > 0 ? min(DS.Metrics.sidePanelWidth.max, max(DS.Metrics.sidePanelWidth.min, CGFloat(w))) : DS.Metrics.sidePanelWidth.ideal
	}() { didSet { UserDefaults.standard.set(Double(panelWidth), forKey: "panelWidth") } }
	/// правая панель агентов видна (запоминается, общая для всех окон)
	var showAgents = UserDefaults.standard.object(forKey: "showAgents") as? Bool ?? true { didSet { UserDefaults.standard.set(showAgents, forKey: "showAgents") } }
	let terminals = TerminalStore.shared
	/// первичная установка и проверка окружения (CLI, служба, Claude Code, скилл)
	let setup = SetupModel()

	/// Открыть главное окно / отдельное окно агента (задаются из View при появлении окон).
	@ObservationIgnored var openMainWindowAction: (() -> Void)?


	let notifier = Notifier()
	private var toastTask: Task<Void, Never>?
	var toastHovered = false { didSet { if !toastHovered, toast != nil { scheduleToastDismiss() } } }

	static let shared = AppModel()

	init() {
		store = OrchStore(client: OrchClient(baseURL: AppSettings.serverURL))
		store.onAttention = { [weak self] e in self?.attention(e) }
		notifier.handler = { [weak self] action in self?.handle(action) }
		store.start()
		// для снимков: `-debug.panel hidden` — боковая панель свёрнута с самого начала
		if UserDefaults.standard.string(forKey: "debug.panel") == "hidden" { showAgents = false }
		notifier.requestAuthorization()
	}

	// MARK: проекты (вкладки одного окна)

	/// Запомнить действия «открыть окно» (берутся из окружения окна) и выполнить отложенные.
	func registerWindowOpeners(_ open: OpenWindowAction) {
		openMainWindowAction = { open(id: "main") }
		if pendingShow { pendingShow = false; showMainWindow() }
	}

	/// Главное окно (его делегат — `CloseGuard`).
	private var mainNSWindow: NSWindow? { NSApp.windows.first { $0.delegate is CloseGuard } }

	/// Показать и поднять главное окно (если закрыто — открыть).
	func showMainWindow() {
		// ссылка или папка из другого приложения: иначе окно остаётся позади или на чужом рабочем столе
		NSRunningApplication.current.activate(options: [.activateAllWindows])
		NSApp.activate()
		if let w = mainNSWindow {
			if w.isMiniaturized { w.deminiaturize(nil) }
			w.makeKeyAndOrderFront(nil)
			w.orderFrontRegardless()
		} else if let f = openMainWindowAction { f() } else { pendingShow = true }
	}

	/// Проекты в порядке открытия (переключатель в шапке, меню и ⌘1…⌘9).
	var projectWindows: [SessionWindowModel] { tabs }

	/// Подпись проекта: имя папки; одинаковые отличаются номером («proj», «proj 2»).
	func label(of w: SessionWindowModel) -> String {
		let name = Projects.name(ofPath: w.dir)
		let same = tabs.filter { Projects.name(ofPath: $0.dir) == name }
		guard same.count > 1, let i = same.firstIndex(where: { $0 === w }), i > 0 else { return name }
		return "\(name) \(i + 1)"
	}

	func toggleAgents() { withAnimation(dsAnimation(DS.Motion.panel)) { showAgents.toggle() } }

	/// Показать проект.
	func select(_ w: SessionWindowModel) {
		guard tabs.contains(where: { $0 === w }) else { return }
		withAnimation(dsAnimation(DS.Motion.panel)) { activeKey = w.key }
	}

	/// Следующий (+1) или предыдущий (−1) проект по кругу.
	func cycleWindow(_ delta: Int) {
		guard tabs.count > 1 else { return }
		let cur = tabs.firstIndex { $0 === activeWindow } ?? 0
		select(tabs[(cur + delta + tabs.count) % tabs.count])
	}

	/// Закрыть проект (с подтверждением, если в его терминале живой процесс).
	func close(_ w: SessionWindowModel) {
		if w.terminal?.isAlive == true {
			let a = NSAlert()
			a.messageText = "Закрыть терминал «\(label(of: w))»?"
			a.informativeText = "Его процесс будет завершён."
			a.addButton(withTitle: "Закрыть")
			a.addButton(withTitle: "Отмена")
			a.alertStyle = .warning
			guard a.runModal() == .alertFirstButtonReturn else { return }
		}
		w.closed()
	}

	/// Закрыть все проекты (окно закрыто или приложение завершается).
	func closeAllTabs() { for w in tabs { w.closed() } }

	func forget(window w: SessionWindowModel) {
		guard let i = tabs.firstIndex(where: { $0 === w }) else { return }
		tabs.remove(at: i)
		if activeKey == w.key { activeKey = tabs.isEmpty ? nil : tabs[min(i, tabs.count - 1)].key }
	}

	/// Поднять проект на передний план.
	func raise(_ w: SessionWindowModel) {
		select(w)
		showMainWindow()
	}

	private func rememberRecent(_ dir: String) {
		guard !dir.isEmpty, dir != NSHomeDirectory() else { return }
		recentProjects = Array(([dir] + recentProjects.filter { $0 != dir }).prefix(10))
		UserDefaults.standard.set(recentProjects, forKey: "recentProjects")
	}

	private func add(_ value: TerminalWindowValue) {
		rememberRecent(value.dir)
		let w = SessionWindowModel(app: self, value: value)
		tabs.append(w)
		withAnimation(dsAnimation(DS.Motion.panel)) { activeKey = w.key }
		Task { await w.bootstrap() }
		showMainWindow()
	}

	/// Проект в папке (ссылка, Finder, `nessy-orch .`, ⌘N). Внешние вызовы переключаются на уже открытый проект этой папки;
	/// `forceNew` (⌘N) открывает ещё один терминал в ней.
	func openTerminal(dir: String, forceNew: Bool = false) {
		let d = Projects.normalize(dir).flatMap { TerminalLaunch.isUsableDirectory($0) ? $0 : nil } ?? NSHomeDirectory()
		if !forceNew, let w = tabs.first(where: { $0.dir == d }) { raise(w); return }
		add(.fresh(dir: d))
	}

	/// Открыть (или показать) проект сессии оркестратора.
	func show(session id: String) {
		if let w = tabs.first(where: { $0.owns(id) }) { raise(w); return }
		let s = store.session(id)
		let dir = s?.cwd.flatMap(Projects.normalize) ?? projectPath(of: id) ?? NSHomeDirectory()
		add(.reopen(session: id, dir: dir, chat: s?.chatId))
	}

	/// Последние сессии главного агента, которые сейчас не открыты (их можно продолжить: `--resume`): свежие сверху.
	var recentSessions: [SessionView] {
		let open = tabs
		let list = store.sessions.filter { s in s.chatId != nil && s.status == .active && !open.contains { $0.owns(s.id) } }
		return Array(list.sorted { $0.updatedAt > $1.updatedAt }.prefix(8))
	}

	/// Перейти к агенту: окно его сессии и карточка агента в боковой панели.
	func reveal(agent id: String) {
		guard let a = store.agents[id], let s = a.session else { return }
		show(session: s)
		// карточка открывается, когда окно уже есть
		Task { @MainActor in
			for _ in 0..<20 {
				if let w = tabs.first(where: { $0.owns(s) }) { w.open(agent: id); return }
				try? await Task.sleep(for: .milliseconds(100))
			}
		}
	}

	/// Над кем работают горячие клавиши: открытый агент окна в фокусе, иначе выбранный в его списке.
	var targetAgent: AgentView? { activeWindow?.targetAgent }

	/// Время, на котором замерли данные (нет связи) — таймеры не врут, что агент «работает 5:00».
	var frozenAt: Date? {
		if case .offline = store.daemon { return store.lastEventAt }
		return nil
	}
	var isOffline: Bool { frozenAt != nil }

	// MARK: диплинки и уведомления

	func handle(url: URL) {
		if url.isFileURL {
			// папка, брошенная на значок или открытая через `open -a "TClaude-Orch" <папка>`
			if let d = TerminalLaunch.directory(from: url) { openTerminal(dir: d) }
			return
		}
		guard url.scheme == "nessy-orch" else { return }
		let id = url.pathComponents.dropFirst().first ?? ""
		switch url.host {
		case "terminal": if let d = TerminalLaunch.directory(from: url) { openTerminal(dir: d) }
		case "session": if !id.isEmpty { show(session: id) }
		case "agent": if !id.isEmpty { reveal(agent: id) }
		default: break
		}
	}

	func handle(_ action: NotificationAction) {
		switch action {
		case .open(let agentId, let sessionId):
			if let agentId { reveal(agent: agentId) } else if let sessionId { show(session: sessionId) }
		}
	}

	/// Событие внимания: системное уведомление (вне приложения) и тост (внутри).
	private func attention(_ e: AttentionEvent) {
		notifier.post(e)
		guard NSApp.isActive, e.kind != .sessionDone else { return }
		let state: DS.AgentState = e.kind == .error ? .error : .wait
		show(Toast(state: state, text: e.title, agentId: e.agentId))
	}

	// MARK: тосты

	func show(_ t: Toast) {
		withAnimation(dsAnimation(DS.Motion.panel)) { toast = t }
		scheduleToastDismiss()
	}

	func flash(_ text: String, error: Bool = false) {
		show(Toast(state: error ? .error : nil, text: text, isError: error))
	}

	private func scheduleToastDismiss() {
		toastTask?.cancel()
		guard let id = toast?.id else { return }
		toastTask = Task { [weak self] in
			try? await Task.sleep(for: .seconds(5))
			guard !Task.isCancelled, let self, self.toast?.id == id, !self.toastHovered else { return }
			withAnimation(dsAnimation(DS.Motion.panel)) { self.toast = nil }
		}
	}

	// MARK: действия

	/// Выполнить сетевое действие; ошибку показать тостом.
	func run(_ title: String, _ op: @escaping () async throws -> Void) async {
		do { try await op() } catch { flash("\(title): \(error.localizedDescription)", error: true) }
	}

	/// Написать агенту (прерывает текущий ход). Ошибка — тостом, черновик возвращается в поле.
	func send(to a: AgentView, text: String) {
		let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { return }
		drafts[a.id] = ""
		Task {
			do { try await self.store.client.sendMessage(to: a.id, text: t) }
			catch {
				if (self.drafts[a.id] ?? "").isEmpty { self.drafts[a.id] = t }
				self.flash("Сообщение не отправлено: \(error.localizedDescription)", error: true)
			}
		}
	}
	func saveRole(id: String?, _ d: RoleDraft) async -> RoleView? {
		do {
			let t = d.trimmed
			return try await store.client.saveRole(id: id, name: t.name, description: t.description, instructions: t.instructions, color: t.color, icon: t.icon)
		} catch { flash("Роль не сохранена: \(error.localizedDescription)", error: true); return nil }
	}
	func deleteRole(_ id: String) async -> Bool {
		do { try await store.client.deleteRole(id); return true }
		catch { flash("Роль не удалена: \(error.localizedDescription)", error: true); return false }
	}
	func stop(_ a: AgentView) { Task { await run("Остановка") { try await self.store.client.cancel(a.id) } } }
}

/// Настройки, не требующие модели.
enum AppSettings {
	/// запускать `claude` сразу при открытии проекта
	/// команда запуска Claude в новом терминале (по умолчанию `claude`; функция `claude` в оболочке сама добавляет хуки оркестратора)
	static var leadCommand: String {
		let c = (UserDefaults.standard.string(forKey: "claudeCommand") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		return c.isEmpty ? "claude" : c
	}
	/// размер шрифта терминала (pt)
	static var terminalFontSize: CGFloat {
		let v = UserDefaults.standard.double(forKey: "terminal.fontSize")
		return v >= 10 && v <= 24 ? CGFloat(v) : 13
	}

	static var serverURL: URL {
		let s = UserDefaults.standard.string(forKey: "serverURL") ?? "http://127.0.0.1:4337"
		return URL(string: s) ?? URL(string: "http://127.0.0.1:4337")!
	}
}

/// Служба оркестратора (launchd): запуск при отсутствии связи.
enum Daemon {
	static let label = "com.nessy.orch"

	@discardableResult
	/// Перезапустить службу; если её ещё нет — установить из встроенной копии сервера.
	static func kickstart() async -> Bool {
		if await launchctlKickstart() { return true }
		return await AppModel.shared.setup.installService()
	}

	private static func launchctlKickstart() async -> Bool {
		await Task.detached {
			let p = Process()
			p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
			p.arguments = ["kickstart", "-k", "gui/\(getuid())/\(label)"]
			p.standardOutput = FileHandle.nullDevice
			p.standardError = FileHandle.nullDevice
			do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
		}.value
	}

	static func openLogs() {
		NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nessy-orch/logs"))
	}
}
