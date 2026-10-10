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
	/// состояние окон сессий (карточка агента, курсор списка): по одному на сессию
	@ObservationIgnored private(set) var windows: [String: SessionWindowModel] = [:]
	/// порядок открытия окон (переключатель в шапке и ⌘1…⌘9 идут в нём)
	@ObservationIgnored private var windowOrder: [String] = []
	/// растёт при открытии и закрытии окон: по нему обновляются меню «Окно» и меню Dock
	private(set) var windowsRevision = 0
	/// открыть окна ждали, пока из окружения появится `openWindow` (ссылка при холодном старте)
	@ObservationIgnored private var pendingOpens: [TerminalWindowValue] = []
	/// на запуске пришла ссылка или папка — окно в домашнем каталоге не нужно
	var suppressHomeWindow = false
	/// окно сессии, которое сейчас в фокусе (команды меню действуют на него)
	var activeWindow: SessionWindowModel?
	/// черновики поля ввода по агентам
	var drafts: [String: String] = [:]
	var showPalette = false
	var showShortcuts = false
	var toast: Toast?
	/// желаемая ширина правой панели (тянется за левый край), 340…480
	var panelWidth: CGFloat = {
		let w = UserDefaults.standard.double(forKey: "panelWidth")
		return w > 0 ? min(DS.Metrics.sidePanelWidth.max, max(DS.Metrics.sidePanelWidth.min, CGFloat(w))) : DS.Metrics.sidePanelWidth.ideal
	}() { didSet { UserDefaults.standard.set(Double(panelWidth), forKey: "panelWidth") } }
	/// правая панель агентов видна (запоминается, общая для всех окон)
	var showAgents = UserDefaults.standard.object(forKey: "showAgents") as? Bool ?? true { didSet { UserDefaults.standard.set(showAgents, forKey: "showAgents") } }
	/// папка терминала каждой сессии (чтобы повторно открыть сессию в её папке)
	var sessionDirs: [String: String] = UserDefaults.standard.dictionary(forKey: "sessionDirs") as? [String: String] ?? [:]
	let terminals = TerminalStore.shared

	/// Открыть окно-терминал / отдельное окно агента (задаются из View при появлении окон).
	var openTerminalWindow: ((TerminalWindowValue) -> Void)?
	var openAgentWindow: ((String) -> Void)?


	let notifier = Notifier()
	private var toastTask: Task<Void, Never>?
	var toastHovered = false { didSet { if !toastHovered, toast != nil { scheduleToastDismiss() } } }

	static let shared = AppModel()

	init() {
		store = OrchStore(client: OrchClient(baseURL: AppSettings.serverURL))
		store.onAttention = { [weak self] e in self?.attention(e) }
		notifier.handler = { [weak self] action in self?.handle(action) }
		store.start()
		notifier.requestAuthorization()
	}

	// MARK: окна-терминалы

	/// Запомнить действия «открыть окно» (берутся из окружения любого окна) и выполнить отложенные.
	func registerWindowOpeners(_ open: OpenWindowAction) {
		openTerminalWindow = { open(id: "terminal", value: $0) }
		openAgentWindow = { open(id: "agent", value: $0) }
		let queued = pendingOpens
		pendingOpens = []
		queued.forEach { open(id: "terminal", value: $0) }
	}

	/// Окно в домашнем каталоге (Dock, повторный запуск без окон).
	func openMainWindow() { openFromLauncher() }

	/// Запуск без папки (Dock, Spotlight, повторный запуск без окон): окно с просьбой открыть проект вместо терминала.
	func openFromLauncher() { open(.fresh(dir: "")) }

	/// Окно без проекта (терминала в нём нет).
	private func closeEmptyWindows() {
		for w in windows.values where w.dir.isEmpty {
			NSApp.windows.first { ($0.delegate as? CloseGuard)?.key == w.key }?.close()
		}
	}

	var hasTerminalWindows: Bool { !windows.isEmpty }
	var hasProjectWindows: Bool { windows.values.contains { !$0.dir.isEmpty } }

	/// Состояние окна (создаётся при первом обращении).
	func window(for value: TerminalWindowValue) -> SessionWindowModel {
		if let w = windows[value.key] { return w }
		let w = SessionWindowModel(app: self, value: value)
		windows[value.key] = w
		windowOrder.append(value.key)
		Task { @MainActor in self.windowsRevision += 1 }
		return w
	}

	func forget(window w: SessionWindowModel) {
		windows[w.key] = nil
		windowOrder.removeAll { $0 == w.key }
		windowsRevision += 1
		if activeWindow === w { activeWindow = nil }
	}

	private func open(_ value: TerminalWindowValue) {
		if let f = openTerminalWindow { f(value); NSApp.activate() } else { pendingOpens.append(value) }
		// новое окно — поверх остальных
		Task { @MainActor in
			for _ in 0..<20 {
				try? await Task.sleep(for: .milliseconds(100))
				if let w = NSApp.windows.first(where: { ($0.delegate as? CloseGuard)?.key == value.key }) {
					try? await Task.sleep(for: .milliseconds(400))
					NSApp.activate()
					w.makeKeyAndOrderFront(nil)
					w.orderFrontRegardless()
					return
				}
			}
		}
	}

	/// Новое окно-терминал в папке (ссылка, `open -a … <папка>`, ⌘N).
	/// Окна проектов в порядке открытия (для переключателя в шапке, меню и ⌘1…⌘9).
	var projectWindows: [SessionWindowModel] {
		_ = windowsRevision
		return windowOrder.compactMap { windows[$0] }.filter { !$0.dir.isEmpty }
	}

	/// Подпись окна: имя папки; одинаковые отличаются номером («proj», «proj 2»).
	func label(of w: SessionWindowModel) -> String {
		let name = Projects.name(ofPath: w.dir)
		let same = projectWindows.filter { Projects.name(ofPath: $0.dir) == name }
		guard same.count > 1, let i = same.firstIndex(where: { $0 === w }), i > 0 else { return name }
		return "\(name) \(i + 1)"
	}

	/// Следующее (+1) или предыдущее (−1) окно по кругу.
	func cycleWindow(_ delta: Int) {
		let all = projectWindows
		guard all.count > 1 else { return }
		let cur = all.firstIndex { $0 === activeWindow } ?? 0
		raise(all[(cur + delta + all.count) % all.count])
	}

	/// Закрыть окно проекта (с подтверждением, если в нём живой терминал).
	func close(_ w: SessionWindowModel) {
		NSApp.windows.first { ($0.delegate as? CloseGuard)?.key == w.key }?.performClose(nil)
	}

	/// Поднять окно на передний план.
	func raise(_ w: SessionWindowModel) {
		NSApp.activate()
		guard let nw = NSApp.windows.first(where: { ($0.delegate as? CloseGuard)?.key == w.key }) else { return }
		if nw.isMiniaturized { nw.deminiaturize(nil) }
		nw.makeKeyAndOrderFront(nil)
	}

	/// Окно в папке. Внешние вызовы (Finder, ссылка, `nessy-orch .`) поднимают уже открытое окно этой папки; `forceNew` (⌘N) открывает ещё одно.
	func openTerminal(dir: String, forceNew: Bool = false) {
		let d = Projects.normalize(dir).flatMap { TerminalLaunch.isUsableDirectory($0) ? $0 : nil } ?? NSHomeDirectory()
		if !forceNew, let w = projectWindows.first(where: { $0.dir == d }) { raise(w); return }
		closeEmptyWindows()
		open(.fresh(dir: d))
	}

	/// Открыть (или поднять) окно сессии оркестратора.
	func show(session id: String) {
		if let w = windows.values.first(where: { $0.owns(id) }) { open(w.value); return }
		open(.reopen(session: id, dir: projectPath(of: id) ?? NSHomeDirectory()))
	}

	/// Перейти к агенту: окно его сессии и карточка агента в боковой панели.
	func reveal(agent id: String) {
		guard let a = store.agents[id], let s = a.session else { return }
		show(session: s)
		// карточка открывается, когда окно уже есть
		Task { @MainActor in
			for _ in 0..<20 {
				if let w = windows.values.first(where: { $0.owns(s) }) { w.open(agent: id); return }
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
			if let d = TerminalLaunch.directory(from: url) { suppressHomeWindow = true; openTerminal(dir: d) }
			return
		}
		guard url.scheme == "nessy-orch" else { return }
		let id = url.pathComponents.dropFirst().first ?? ""
		switch url.host {
		case "terminal": if let d = TerminalLaunch.directory(from: url) { suppressHomeWindow = true; openTerminal(dir: d) }
		case "session": if !id.isEmpty { suppressHomeWindow = true; show(session: id) }
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
	func closeSession(_ id: String) { Task { await run("Завершение сессии") { try await self.store.client.closeSession(id) } } }
	func reopenSession(_ id: String) { Task { await run("Возврат сессии") { try await self.store.client.reopenSession(id) } } }
	func deleteSession(_ id: String) {
		Task {
			await run("Удаление") { try await self.store.client.deleteSession(id) }
		}
	}
}

/// Настройки, не требующие модели.
enum AppSettings {
	/// запускать `claude` сразу при открытии проекта
	static var autoStartClaude: Bool { UserDefaults.standard.object(forKey: "autoStartClaude") as? Bool ?? true }
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
		return await CLISupport.shared.installService()
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
