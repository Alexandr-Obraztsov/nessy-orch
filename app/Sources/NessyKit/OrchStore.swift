import Foundation
import Observation

public enum DaemonState: Equatable, Sendable {
	case connecting
	case online(version: String)
	case offline(String)
}

/// Сигнал для уведомлений: что-то стало требовать внимания.
public struct AttentionEvent: Sendable, Equatable {
	public enum Kind: Sendable { case permission, error, blocked, sessionDone }
	public var kind: Kind
	public var agentId: String?
	public var sessionId: String?
	public var title: String
	public var body: String
	public var requestId: String?
	/// подзаголовок уведомления — название сессии
	public var subtitle: String?

	public init(kind: Kind, agentId: String?, sessionId: String?, title: String, body: String, requestId: String?, subtitle: String? = nil) {
		self.kind = kind; self.agentId = agentId; self.sessionId = sessionId; self.title = title; self.body = body; self.requestId = requestId; self.subtitle = subtitle
	}
}

/// Состояние приложения: снапшот и изменения общего потока `/stream`.
@MainActor
@Observable
public final class OrchStore {
	public let client: OrchClient
	public private(set) var daemon: DaemonState = .connecting
	public private(set) var spaces: [SpaceView] = []
	public private(set) var roles: [RoleView] = []
	public private(set) var sessions: [SessionView] = []
	public private(set) var agents: [String: AgentView] = [:]
	public private(set) var messages: [Message] = []
	public private(set) var messagesById: [String: Message] = [:]
	public private(set) var autoApprove = true
	public private(set) var lastEventAt = Date()
	/// просмотренные ответы (msgId): у непросмотренных — точка «новое»
	public private(set) var seenReplies: Set<String>

	/// Подписчик уведомлений (приложение показывает баннеры).
	public var onAttention: ((AttentionEvent) -> Void)?

	private var stream: SSEStream?
	private var primed = false
	private var pollTask: Task<Void, Never>?
	private let defaults: UserDefaults
	private static let seenKey = "seenReplies"

	public init(client: OrchClient = OrchClient(), defaults: UserDefaults = .standard) {
		self.client = client
		self.defaults = defaults
		self.seenReplies = Set(defaults.stringArray(forKey: Self.seenKey) ?? [])
	}

	// MARK: жизненный цикл

	public func start() {
		guard stream == nil else { return }
		let s = client.stream()
		stream = s
		s.start(
			onState: { [weak self] st in Task { @MainActor in self?.streamState(st) } },
			onOpen: { },
			onData: { [weak self] d in
				let ev = StreamEvent.decode(d)
				Task { @MainActor in self?.apply(ev) }
			}
		)
		pollTask = Task { [weak self] in
			while !Task.isCancelled {
				await self?.refreshStatus()
				try? await Task.sleep(for: .seconds(10))
			}
		}
	}

	public func stop() {
		stream?.stop(); stream = nil
		pollTask?.cancel(); pollTask = nil
	}

	private func streamState(_ st: SSEState) {
		switch st {
		case .connecting: if case .online = daemon {} else { daemon = .connecting }
		case .open: break
		case .failed(let msg): daemon = .offline(msg)
		}
	}

	public func refreshStatus() async {
		do {
			let s = try await client.status()
			autoApprove = s.autoApprove
			daemon = .online(version: s.version)
		} catch let e as APIError where e.isOffline {
			daemon = .offline(e.message)
		} catch {}
	}

	// MARK: применение событий

	public func apply(_ e: StreamEvent) {
		lastEventAt = Date()
		switch e {
		case .snapshot(let s):
			let old = agents
			spaces = s.spaces
			roles = s.roles
			sessions = s.sessions
			agents = Dictionary(s.agents.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
			messages = s.messages
			messagesById = Dictionary(s.messages.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
			if case .online = daemon {} else { daemon = .online(version: "") }
			if primed { for a in s.agents { detect(old: old[a.id], new: a) } }
			primed = true
		case .message(let m):
			messages.append(m)
			if messages.count > 2000 { messages.removeFirst(messages.count - 2000) }
			messagesById[m.id] = m
		case .agent(let a):
			let prev = agents[a.id]
			agents[a.id] = a
			if primed { detect(old: prev, new: a) }
		case .agentRemoved(let id): agents[id] = nil
		case .space(let s): upsert(&spaces, s)
		case .spaceRemoved(let n): spaces.removeAll { $0.name == n }
		case .role(let r): upsert(&roles, r)
		case .roleRemoved(let id): roles.removeAll { $0.id == id }
		case .session(let t):
			let was = sessions.first { $0.id == t.id }
			upsert(&sessions, t)
			if primed, t.status == .done, was?.status != .done {
				let ags = agents(inSession: t.id)
				let roll = SessionRollup(ags)
				var body = "\(t.title) · \(Numbers.count(ags.count, "агент", "агента", "агентов"))"
				if roll.workMs > 0 { body += ", \(Durations.clock(roll.workMs))" }
				onAttention?(.init(kind: .sessionDone, agentId: nil, sessionId: t.id, title: "Сессия завершена", body: body, requestId: nil))
			}
		case .sessionRemoved(let id): sessions.removeAll { $0.id == id }
		case .unknown: break
		}
	}

	private func upsert<T: Identifiable>(_ list: inout [T], _ item: T) {
		if let i = list.firstIndex(where: { $0.id == item.id }) { list[i] = item } else { list.append(item) }
	}

	/// Переходы, о которых надо сообщить: новый запрос прав, ошибка, блокировка. Готовый результат не уведомляет.
	private func detect(old: AgentView?, new a: AgentView) {
		let sub = session(a.session)?.title
		let oldPerms = Set(old?.pendingPermissions.map(\.requestId) ?? [])
		for p in a.pendingPermissions where !oldPerms.contains(p.requestId) {
			onAttention?(.init(kind: .permission, agentId: a.id, sessionId: a.session, title: "\(a.name) просит разрешения", body: PermissionText.command(p.title), requestId: p.requestId, subtitle: sub))
		}
		if a.status == .error, old?.status != .error {
			onAttention?(.init(kind: .error, agentId: a.id, sessionId: a.session, title: "\(a.name): ошибка", body: a.error ?? "Ход завершился ошибкой", requestId: nil, subtitle: sub))
		}
		if a.isBlocked, let r = a.lastReply, r.msgId != old?.lastReply?.msgId, let code = a.replyCode {
			let title = code == .blocked ? "\(a.name) заблокирован" : "\(a.name): не хватает данных"
			onAttention?(.init(kind: .blocked, agentId: a.id, sessionId: a.session, title: title, body: a.replyReason.isEmpty ? Brief.summary(a) : a.replyReason, requestId: nil, subtitle: sub))
		}
	}

	// MARK: производные

	public var allAgents: [AgentView] { Array(agents.values) }
	public func agents(inSession id: String?) -> [AgentView] { allAgents.filter { $0.session == id } }
	public var agentsWithoutSession: [AgentView] { allAgents.filter { $0.session == nil } }
	public func session(_ id: String?) -> SessionView? { id.flatMap { id in sessions.first { $0.id == id } } }
	public func role(_ id: String?) -> RoleView? { id.flatMap { id in roles.first { $0.id == id } } }
	public func space(_ name: String) -> SpaceView? { spaces.first { $0.name == name } }

	/// Что требует действия (запросы прав, ошибки, блокировки) — по срочности.
	public var attention: [AttentionItem] { AttentionBuilder.build(agents: allAgents) }
	/// Сколько агентов ждут вас: бейдж Dock, menu bar, сайдбара. Совпадает с числом в группе «Нужны вы».
	public var attentionCount: Int { allAgents.filter(\.needsYou).count }
	public func attentionCount(session id: String) -> Int { agents(inSession: id).filter(\.needsYou).count }

	/// Новый (непросмотренный) результат — точка «новое», не бейдж.
	public func isNew(_ a: AgentView) -> Bool {
		guard let r = a.lastReply, r.failed == nil, !a.needsYou, a.state == .done else { return false }
		return !seenReplies.contains(r.msgId)
	}
	public func hasNew(session id: String) -> Bool { agents(inSession: id).contains { isNew($0) } }
	public var workingCount: Int { allAgents.filter { $0.state == .working || $0.state == .starting }.count }

	/// Активные: живые сверху, давно затихшие — внизу (их строка тускнеет).
	public var activeSessions: [SessionView] {
		let now = Date()
		return sessions.filter { $0.status == .active }.sorted {
			let (a, b) = (isStale($0, now: now), isStale($1, now: now))
			return a != b ? !a : sortKey($0) > sortKey($1)
		}
	}
	public var staleSessions: [SessionView] { sessions.filter { $0.status == .active && isStale($0) }.sorted { sortKey($0) > sortKey($1) } }
	public var doneSessions: [SessionView] { sessions.filter { $0.status == .done }.sorted { sortKey($0) > sortKey($1) } }
	private func sortKey(_ t: SessionView) -> Date { ISO.parse(t.updatedAt) ?? .distantPast }

	/// Сессия считается брошенной: активна, никто не работает и не ждёт, давно нет событий.
	public func isStale(_ t: SessionView, now: Date = Date(), after: TimeInterval = 30 * 60) -> Bool {
		guard t.status == .active else { return false }
		let ags = agents(inSession: t.id)
		if ags.contains(where: { $0.state == .wait || $0.state == .working || $0.state == .starting || $0.state == .error }) { return false }
		let last = ([ISO.parse(t.updatedAt)] + ags.map { $0.lastActivity }).compactMap { $0 }.max() ?? .distantPast
		return now.timeIntervalSince(last) > after
	}

	public func firstMessages() -> [String: Message] { Brief.firstMessages(messages) }

	// MARK: просмотр

	public func markSeen(_ msgIds: [String]) {
		seenReplies.formUnion(msgIds)
		defaults.set(Array(seenReplies.suffix(600)), forKey: Self.seenKey)
	}
	public func markSeen(agent a: AgentView) { if let r = a.lastReply { markSeen([r.msgId]) } }
	public func markAllSeen() { markSeen(allAgents.compactMap { $0.lastReply?.msgId }) }

	// MARK: действия (ошибки возвращаются вызывающему)

	public func decide(_ item: AttentionItem, approve: Bool) async throws {
		guard let rid = item.requestId else { return }
		try await client.decide(agent: item.agentId, requestId: rid, approve: approve)
	}
}
