import SwiftUI
import NessyKit

/// Что открыто в главном окне. Других экранов нет: сессия → агент (screens.md §2).
enum Route: Hashable {
	case session(String)
}

enum SessionTab: String, CaseIterable, Identifiable {
	case agents = "Агенты", sources = "Источники", stats = "Статистика"
	var id: String { rawValue }
	var symbol: String {
		switch self {
		case .agents: "person.2"
		case .sources: "link"
		case .stats: "chart.bar"
		}
	}
}

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
	var route: Route? = nil { didSet { saveRoute() } }
	var tab: SessionTab = .agents { didSet { UserDefaults.standard.set(tab.rawValue, forKey: "tab") } }
	/// агент, чьё окно открыто справа от списка
	private(set) var openAgentId: String?
	/// выбранная строка списка (курсор ↑/↓); открыть её — ↩
	var selectedAgentId: String?
	/// черновики поля ввода по агентам
	var drafts: [String: String] = [:]
	/// в поле ввода есть текст и оно в фокусе: ⌘⌫ тогда нужен полю, а не «Отклонить»
	var composerBusy = false
	var showPalette = false
	var showShortcuts = false
	var showRoles = false
	/// запрос ⌘F: вкладка «Источники» показывает поиск и фокусирует его
	var searchTick = 0
	var toast: Toast?
	/// сайдбар свернули мы сами (чтобы освободить место окну агента) — вернём при закрытии
	var sidebarCollapsedForPanel = false
	var columnVisibility: NavigationSplitViewVisibility = .all
	/// ширина окна агента (тянется за левый край)
	var panelWidth: CGFloat = DS.Metrics.agentPanelWidth.ideal { didSet { UserDefaults.standard.set(Double(panelWidth), forKey: "panelWidth") } }
	/// ширина контента сессии (без сайдбара) — чтобы решить, сворачивать ли сайдбар под окно агента
	var detailWidth: CGFloat = 0
	/// ширина окна — для компактного тулбара
	var windowWidth: CGFloat = 900

	/// Вынести окно агента в отдельное окно macOS / открыть главное окно (задаются из View).
	var openAgentWindow: ((String) -> Void)?
	var openMainWindow: (() -> Void)?

	let notifier = Notifier()
	private var toastTask: Task<Void, Never>?
	var toastHovered = false { didSet { if !toastHovered, toast != nil { scheduleToastDismiss() } } }

	static let shared = AppModel()

	init() {
		store = OrchStore(client: OrchClient(baseURL: AppSettings.serverURL))
		let d = UserDefaults.standard
		if let saved = d.string(forKey: "route") { route = Self.decodeRoute(saved) }
		if let t = d.string(forKey: "tab").flatMap(SessionTab.init(rawValue:)) { tab = t }
		if d.double(forKey: "panelWidth") > 0 {
			panelWidth = min(DS.Metrics.agentPanelWidth.max, max(DS.Metrics.agentPanelWidth.min, CGFloat(d.double(forKey: "panelWidth"))))
		}
		store.onAttention = { [weak self] e in self?.attention(e) }
		notifier.handler = { [weak self] action in self?.handle(action) }
		store.start()
		notifier.requestAuthorization()
	}

	// MARK: маршруты

	private func saveRoute() { UserDefaults.standard.set(route.map(Self.encodeRoute), forKey: "route") }
	static func encodeRoute(_ r: Route) -> String {
		switch r {
		case .session(let id): "session:" + id
		}
	}
	static func decodeRoute(_ s: String) -> Route? {
		s.hasPrefix("session:") ? .session(String(s.dropFirst(8))) : nil
	}

	var currentSession: SessionView? {
		if case .session(let id) = route { return store.session(id) }
		return nil
	}

	func show(session id: String) {
		if route != .session(id) { open(agent: nil) }
		route = .session(id)
		tab = .agents
	}

	/// Перейти к агенту: открыть его сессию и окно агента.
	func reveal(agent id: String) {
		guard let a = store.agents[id] else { return }
		if let s = a.session { route = .session(s) }
		tab = .agents
		open(agent: id)
		openMainWindow?()
	}

	/// Открыть/закрыть окно агента. Пружина прерываема: повторный вызов посреди анимации разворачивает её.
	func open(agent id: String?) {
		withAnimation(dsAnimation(DS.Motion.panel)) {
			if id == nil, sidebarCollapsedForPanel {
				columnVisibility = .all
				sidebarCollapsedForPanel = false
			}
			// списку остаётся меньше 360 — сайдбар уступает место (screens.md §5)
			if id != nil, openAgentId == nil, columnVisibility != .detailOnly,
				detailWidth - panelWidth - 2 * DS.Metrics.panelInset < 360 {
				columnVisibility = .detailOnly
				sidebarCollapsedForPanel = true
			}
			openAgentId = id
			if let id { selectedAgentId = id }
		}
		if let id, let a = store.agents[id] { store.markSeen(agent: a) }
	}

	func toggle(agent id: String) { open(agent: openAgentId == id ? nil : id) }

	var openAgent: AgentView? { openAgentId.flatMap { store.agents[$0] } }
	/// Над кем работают горячие клавиши: открытый агент, иначе выбранный в списке.
	var targetAgent: AgentView? { openAgent ?? selectedAgentId.flatMap { store.agents[$0] } }

	/// ↑/↓: курсор двигается; если окно агента открыто, оно следует за курсором.
	func select(agent id: String) {
		selectedAgentId = id
		if openAgentId != nil, openAgentId != id { open(agent: id) }
	}

	/// ⌘[ и ⌘]: соседняя активная сессия.
	func step(session d: Int) {
		let list = store.activeSessions
		guard !list.isEmpty else { return }
		let i = list.firstIndex { route == .session($0.id) }
		show(session: list[i.map { min(max(0, $0 + d), list.count - 1) } ?? 0].id)
	}

	/// Первый запрос прав у целевого агента.
	var targetPermission: (agent: AgentView, permission: PermissionBrief)? {
		targetAgent.flatMap { a in a.pendingPermissions.first.map { (a, $0) } }
	}

	/// Время, на котором замерли данные (нет связи) — таймеры не врут, что агент «работает 5:00».
	var frozenAt: Date? {
		if case .offline = store.daemon { return store.lastEventAt }
		return nil
	}
	var isOffline: Bool { frozenAt != nil }

	// MARK: диплинки и уведомления

	func handle(url: URL) {
		guard url.scheme == "nessy-orch" else { return }
		let id = url.pathComponents.dropFirst().first ?? ""
		switch url.host {
		case "session": if !id.isEmpty { show(session: id); openMainWindow?() }
		case "agent": if !id.isEmpty { reveal(agent: id) }
		default: openMainWindow?()
		}
	}

	func handle(_ action: NotificationAction) {
		switch action {
		case .open(let agentId, let sessionId):
			if let agentId { reveal(agent: agentId) } else if let sessionId { show(session: sessionId); openMainWindow?() }
		case .decide(let agentId, let requestId, let approve):
			Task { await run(approve ? "Разрешение" : "Отклонение") { try await self.store.client.decide(agent: agentId, requestId: requestId, approve: approve) } }
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

	func decide(agent: AgentView, permission: PermissionBrief, approve: Bool) {
		Task {
			await run(approve ? "Разрешение" : "Отклонение") {
				try await self.store.client.decide(agent: agent.id, requestId: permission.requestId, approve: approve)
			}
		}
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
			return try await store.client.saveRole(id: id, name: t.name, description: t.description, instructions: t.instructions)
		} catch { flash("Роль не сохранена: \(error.localizedDescription)", error: true); return nil }
	}
	func deleteRole(_ id: String) async -> Bool {
		do { try await store.client.deleteRole(id); return true }
		catch { flash("Роль не удалена: \(error.localizedDescription)", error: true); return false }
	}
	func stop(_ a: AgentView) { Task { await run("Остановка") { try await self.store.client.cancel(a.id) } } }
	func closeSession(_ id: String) { Task { await run("Завершение сессии") { try await self.store.client.closeSession(id) } } }
	func reopenSession(_ id: String) { Task { await run("Возврат сессии") { try await self.store.client.reopenSession(id) } } }
	func deleteSession(_ id: String) {
		Task {
			await run("Удаление") { try await self.store.client.deleteSession(id) }
			if self.route == .session(id) { self.route = self.store.activeSessions.first.map { .session($0.id) } }
		}
	}
}

/// Настройки, не требующие модели.
enum AppSettings {
	static var serverURL: URL {
		let s = UserDefaults.standard.string(forKey: "serverURL") ?? "http://127.0.0.1:4337"
		return URL(string: s) ?? URL(string: "http://127.0.0.1:4337")!
	}
}

/// Служба оркестратора (launchd): запуск при отсутствии связи.
enum Daemon {
	static let label = "com.nessy.orch"

	@discardableResult
	static func kickstart() async -> Bool {
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
