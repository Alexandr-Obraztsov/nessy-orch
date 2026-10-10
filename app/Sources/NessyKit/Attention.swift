import Foundation

// Внимание человека (docs/design/screens.md §2, §8): считается только то, что требует действия —
// запрос прав, ошибка, «заблокирован» / «не хватает данных». Новый результат действия не требует:
// это отдельный признак «новое» (точка), он не попадает в счётчики и бейджи.

/// Что ждёт решения человека. Порядок срочности соответствует порядку случаев.
public enum AttentionKind: Int, Sendable, Comparable {
	case permission, blocked, error
	public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

public struct AttentionItem: Identifiable, Hashable, Sendable {
	public var id: String
	public var kind: AttentionKind
	public var agentId: String
	public var sessionId: String?
	public var title: String
	public var detail: String
	public var requestId: String?
	public var ts: Date

	public init(id: String, kind: AttentionKind, agentId: String, sessionId: String?, title: String, detail: String, requestId: String?, ts: Date) {
		self.id = id; self.kind = kind; self.agentId = agentId; self.sessionId = sessionId; self.title = title; self.detail = detail; self.requestId = requestId; self.ts = ts
	}
}

public extension AgentView {
	/// Статус из последней строки ответа (разбирает сервер).
	var replyCode: ReplyStatusCode? {
		guard let r = lastReply, r.failed == nil else { return nil }
		return r.status.flatMap(ReplyStatusCode.init(rawValue:))
	}

	/// Ответ «заблокирован» / «не хватает данных», и агент не взял новую работу.
	var isBlocked: Bool {
		guard replyCode?.needsHuman == true else { return false }
		return state == .done || state == .idle
	}

	/// Требует действия человека: запрос прав, ошибка, блокировка.
	var needsYou: Bool { state == .wait || state == .error || isBlocked }

	/// Причина блокировки / оговорок одной строкой (сервер) или пусто.
	var replyReason: String { lastReply?.reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

	/// Группа в списке агентов.
	var group: AgentGroup {
		if needsYou { return .needsYou }
		switch state {
		case .working, .starting: return .working
		case .done: return .done
		case .idle, .wait, .error: return .idle
		}
	}

	/// Порядок внутри «Нужны вы»: запросы прав, затем блокировки, затем ошибки.
	internal var urgency: Int {
		if state == .wait { return 0 }
		if isBlocked { return 1 }
		return 2
	}
}

/// Группы списка агентов в порядке показа. Пустые группы не рисуются.
public enum AgentGroup: Int, CaseIterable, Identifiable, Sendable {
	case needsYou, working, done, idle
	public var id: Int { rawValue }
	public var title: String {
		switch self {
		case .needsYou: "Нужны вы"
		case .working: "В работе"
		case .done: "Готово"
		case .idle: "Ждут поручения"
		}
	}
}

public struct AgentSection: Identifiable, Sendable {
	public var group: AgentGroup
	public var agents: [AgentView]
	public var id: Int { group.rawValue }
}

public enum AgentGrouping {
	/// Секции по смыслу. Внутри — новые сверху (по времени запуска), чтобы строки не прыгали от каждого события:
	/// строка переезжает только при смене секции.
	public static func sections(_ agents: [AgentView]) -> [AgentSection] {
		let byGroup = Dictionary(grouping: agents, by: \.group)
		return AgentGroup.allCases.compactMap { g in
			guard let list = byGroup[g], !list.isEmpty else { return nil }
			let sorted = list.sorted {
				if g == .needsYou, $0.urgency != $1.urgency { return $0.urgency < $1.urgency }
				let (a, b) = ($0.created ?? .distantPast, $1.created ?? .distantPast)
				return a != b ? a > b : $0.id < $1.id
			}
			return AgentSection(group: g, agents: sorted)
		}
	}
}

public enum AttentionBuilder {
	/// Элементы, требующие действия: запросы прав, ошибки, BLOCKED/NEEDS_CONTEXT.
	public static func build(agents: [AgentView]) -> [AttentionItem] {
		var out: [AttentionItem] = []
		for a in agents {
			let when = a.lastActivity ?? Date()
			for p in a.pendingPermissions {
				out.append(.init(id: "p:\(p.requestId)", kind: .permission, agentId: a.id, sessionId: a.session, title: a.name, detail: p.title, requestId: p.requestId, ts: when))
			}
			if a.state == .error {
				out.append(.init(id: "e:\(a.id):\(a.lastActivityAt)", kind: .error, agentId: a.id, sessionId: a.session, title: a.name, detail: a.error ?? "Ход завершился ошибкой", requestId: nil, ts: when))
			} else if a.isBlocked, let r = a.lastReply, let code = a.replyCode {
				out.append(.init(id: "b:\(r.msgId)", kind: .blocked, agentId: a.id, sessionId: a.session, title: a.name, detail: a.replyReason.isEmpty ? code.label : a.replyReason, requestId: nil, ts: Date(timeIntervalSince1970: r.ts / 1000)))
			}
		}
		return out.sorted { $0.kind != $1.kind ? $0.kind < $1.kind : $0.ts > $1.ts }
	}
}

/// Сводка сессии. Числа считаются той же функцией, что раскладывает агентов по группам, — поэтому сходятся.
public struct SessionSummary: Sendable, Equatable {
	public var total = 0
	public var needsYou = 0, working = 0, done = 0, idle = 0
	/// из needsYou: сколько ждут разрешения и сколько с ошибкой (для глифа сессии)
	public var wait = 0, error = 0
	public var active: Int { needsYou + working }
	/// Самое срочное состояние сессии (глиф в сайдбаре): ждут разрешения > ошибка/блокировка > работают > готово > тихо.
	public var top: AgentState? {
		if wait > 0 { return .wait }
		if needsYou > 0 { return .error }
		if error > 0 { return .error }
		if working > 0 { return .working }
		if done > 0 { return .done }
		return idle > 0 ? .idle : nil
	}
}

public extension Sequence where Element == AgentView {
	var summary: SessionSummary {
		var s = SessionSummary()
		for a in self {
			s.total += 1
			switch a.group {
			case .needsYou:
				s.needsYou += 1
				if a.state == .wait { s.wait += 1 } else if a.state == .error { s.error += 1 }
			case .working: s.working += 1
			case .done: s.done += 1
			case .idle: s.idle += 1
			}
		}
		return s
	}
}
