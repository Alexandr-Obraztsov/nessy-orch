import Foundation

// Зеркало shared/types/*.ts. Неизвестные значения перечислений не роняют декодирование снапшота.

public enum AgentStatus: String, Codable, Sendable {
	case starting, working, idle, error
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .idle
	}
}

public enum SpaceStatus: String, Codable, Sendable {
	case stopped, starting, ready, failed
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .stopped
	}
}

public enum MessageKind: String, Codable, Sendable {
	case msg, reply, event
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .msg
	}
}

public enum ToolStatus: String, Codable, Sendable {
	case pending
	case inProgress = "in_progress"
	case completed, failed
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .pending
	}
}

public enum PlanStatus: String, Codable, Sendable {
	case pending
	case inProgress = "in_progress"
	case completed
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .pending
	}
}

public enum SessionStatus: String, Codable, Sendable {
	case active, done
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .active
	}
}

public struct SpaceView: Codable, Hashable, Identifiable, Sendable {
	public var name: String
	public var path: String
	public var color: Double
	public var mode: String
	public var url: String?
	public var status: SpaceStatus
	public var error: String?
	public var id: String { name }
}

public struct ToolBrief: Codable, Hashable, Sendable {
	public var name: String
	public var title: String
}

public struct PermissionBrief: Codable, Hashable, Identifiable, Sendable {
	public var requestId: String
	public var title: String
	public var id: String { requestId }
}

public struct PlanEntry: Codable, Hashable, Sendable {
	public var content: String
	public var status: PlanStatus
}

public struct AgentPlan: Codable, Hashable, Sendable {
	public var entries: [PlanEntry]
	public var updatedAt: String
	public var source: String
}

public struct ReplyBrief: Codable, Hashable, Sendable {
	public var msgId: String
	public var ts: Double
	public var failed: String?
	public var preview: String
	/// статус из последней строки ответа: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
	public var status: String?
	public var reason: String?
}

/// Сессия оркестратора: один разговор одного Claude. В ней агенты, источники и счётчики.
public struct SessionView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var title: String
	public var owner: String?
	public var status: SessionStatus
	public var summary: String?
	public var createdAt: String
	public var updatedAt: String
	/// сколько источников собрано (список — GET /sessions/:id/sources)
	public var sources: Int

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		title = try c.decode(String.self, forKey: .title)
		owner = try c.decodeIfPresent(String.self, forKey: .owner)
		status = try c.decode(SessionStatus.self, forKey: .status)
		summary = try c.decodeIfPresent(String.self, forKey: .summary)
		createdAt = try c.decode(String.self, forKey: .createdAt)
		updatedAt = try c.decode(String.self, forKey: .updatedAt)
		sources = try c.decodeIfPresent(Int.self, forKey: .sources) ?? 0
	}
}

public struct TokenUsage: Codable, Hashable, Sendable {
	public var input: Int
	public var output: Int
	public var cached: Int
	public var total: Int
}

public struct AgentStats: Codable, Hashable, Sendable {
	public var turns: Int
	public var toolCalls: Int
	public var workMs: Double
	public var tokens: TokenUsage?

	public static let zero = AgentStats(turns: 0, toolCalls: 0, workMs: 0, tokens: nil)
}

/// Источник сессии: ссылка из ответа/инструмента или ссылка на код/команду.
public struct SourceView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var kind: String
	public var label: String
	public var href: String?
	public var host: String?
	public var agentId: String
	public var agentName: String
	public var origin: String
	public var ts: Double
	public var isURL: Bool { kind == "url" && href != nil }
	public var date: Date { Date(timeIntervalSince1970: ts / 1000) }
}

public struct AgentView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var name: String
	public var space: String
	public var session: String?
	public var parent: String
	public var role: String?
	public var status: AgentStatus
	public var archived: Bool
	public var error: String?
	public var displayName: String?
	public var createdAt: String
	public var lastActivityAt: String
	public var queued: Int
	public var turnStartedAt: String?
	public var lastTool: ToolBrief?
	public var preview: String
	public var pendingPermissions: [PermissionBrief]
	public var plan: AgentPlan?
	public var turnSteps: Int
	public var lastTurnMs: Double?
	public var lastReply: ReplyBrief?
	public var stats: AgentStats

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		name = try c.decode(String.self, forKey: .name)
		space = try c.decode(String.self, forKey: .space)
		session = try c.decodeIfPresent(String.self, forKey: .session)
		parent = try c.decode(String.self, forKey: .parent)
		role = try c.decodeIfPresent(String.self, forKey: .role)
		status = try c.decode(AgentStatus.self, forKey: .status)
		archived = try c.decode(Bool.self, forKey: .archived)
		error = try c.decodeIfPresent(String.self, forKey: .error)
		displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
		createdAt = try c.decode(String.self, forKey: .createdAt)
		lastActivityAt = try c.decode(String.self, forKey: .lastActivityAt)
		queued = try c.decode(Int.self, forKey: .queued)
		turnStartedAt = try c.decodeIfPresent(String.self, forKey: .turnStartedAt)
		lastTool = try c.decodeIfPresent(ToolBrief.self, forKey: .lastTool)
		preview = try c.decode(String.self, forKey: .preview)
		pendingPermissions = try c.decode([PermissionBrief].self, forKey: .pendingPermissions)
		plan = try c.decodeIfPresent(AgentPlan.self, forKey: .plan)
		turnSteps = try c.decode(Int.self, forKey: .turnSteps)
		lastTurnMs = try c.decodeIfPresent(Double.self, forKey: .lastTurnMs)
		lastReply = try c.decodeIfPresent(ReplyBrief.self, forKey: .lastReply)
		stats = try c.decodeIfPresent(AgentStats.self, forKey: .stats) ?? .zero
	}
}

public struct Message: Codable, Hashable, Identifiable, Sendable {
	public var seq: Int
	public var id: String
	/// миллисекунды Unix
	public var ts: Double
	public var from: String
	public var to: String
	public var kind: MessageKind
	public var text: String
	public var hops: Int
	public var replyTo: String?
	public var wait: Bool?
	public var failed: String?
	public var date: Date { Date(timeIntervalSince1970: ts / 1000) }
}

public struct RoleView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var name: String
	public var description: String
	public var instructions: String
	public var color: Double
	public var createdAt: String
	public var updatedAt: String
}

// MARK: события чата агента

public enum AgentEvent: Codable, Hashable, Identifiable, Sendable {
	case user(UserEvent)
	case text(TextEvent)
	case thought(TextEvent)
	case tool(ToolEvent)
	case permission(PermissionEvent)
	case system(SystemEvent)

	public struct UserEvent: Codable, Hashable, Sendable {
		public var seq: Int
		public var ts: Double
		public var from: String
		public var msgId: String
		public var text: String
	}
	public struct TextEvent: Codable, Hashable, Sendable {
		public var seq: Int
		public var ts: Double
		public var text: String
	}
	public struct ToolEvent: Codable, Hashable, Sendable {
		public var seq: Int
		public var ts: Double
		public var toolId: String
		public var name: String
		public var title: String
		public var input: [String: JSONValue]
		public var status: ToolStatus
		public var output: String?
		public var endedTs: Double?
		/// длительность вызова, сек (nil — ещё идёт)
		public var duration: Double? { endedTs.map { max(0, ($0 - ts) / 1000) } }
	}
	public struct PermissionEvent: Codable, Hashable, Sendable {
		public var seq: Int
		public var ts: Double
		public var requestId: String
		public var title: String
		public var resolved: Bool
		public var approved: Bool?
		public var auto: Bool?
	}
	public struct SystemEvent: Codable, Hashable, Sendable {
		public var seq: Int
		public var ts: Double
		public var level: String
		public var text: String
		public var isError: Bool { level == "error" }
	}

	private enum Key: String, CodingKey { case kind }

	public init(from decoder: Decoder) throws {
		let kind = try decoder.container(keyedBy: Key.self).decode(String.self, forKey: .kind)
		switch kind {
		case "user": self = .user(try UserEvent(from: decoder))
		case "text": self = .text(try TextEvent(from: decoder))
		case "thought": self = .thought(try TextEvent(from: decoder))
		case "tool": self = .tool(try ToolEvent(from: decoder))
		case "permission": self = .permission(try PermissionEvent(from: decoder))
		case "system": self = .system(try SystemEvent(from: decoder))
		default:
			throw DecodingError.dataCorruptedError(forKey: .kind, in: try decoder.container(keyedBy: Key.self), debugDescription: "kind \(kind)")
		}
	}

	public func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: AnyKey.self)
		func kind(_ k: String) throws { try c.encode(k, forKey: AnyKey("kind")) }
		switch self {
		case .user(let e): try kind("user"); try e.encode(to: encoder)
		case .text(let e): try kind("text"); try e.encode(to: encoder)
		case .thought(let e): try kind("thought"); try e.encode(to: encoder)
		case .tool(let e): try kind("tool"); try e.encode(to: encoder)
		case .permission(let e): try kind("permission"); try e.encode(to: encoder)
		case .system(let e): try kind("system"); try e.encode(to: encoder)
		}
	}

	public var seq: Int {
		switch self {
		case .user(let e): e.seq
		case .text(let e), .thought(let e): e.seq
		case .tool(let e): e.seq
		case .permission(let e): e.seq
		case .system(let e): e.seq
		}
	}
	public var id: Int { seq }
	public var ts: Double {
		switch self {
		case .user(let e): e.ts
		case .text(let e), .thought(let e): e.ts
		case .tool(let e): e.ts
		case .permission(let e): e.ts
		case .system(let e): e.ts
		}
	}
}

struct AnyKey: CodingKey {
	var stringValue: String
	var intValue: Int? { nil }
	init(_ s: String) { stringValue = s }
	init?(stringValue: String) { self.stringValue = stringValue }
	init?(intValue: Int) { nil }
}

public struct ChunkEvent: Codable, Hashable, Sendable {
	public var seq: Int
	public var ts: Double
	public var kind: String
	public var delta: String
	public var len: Int
}

// MARK: потоки

public enum StreamEvent: Sendable {
	case snapshot(Snapshot)
	case message(Message)
	case agent(AgentView)
	case agentRemoved(String)
	case space(SpaceView)
	case spaceRemoved(String)
	case role(RoleView)
	case roleRemoved(String)
	case session(SessionView)
	case sessionRemoved(String)
	case unknown

	public struct Snapshot: Codable, Sendable {
		public var rev: Int
		public var spaces: [SpaceView]
		public var agents: [AgentView]
		public var roles: [RoleView]
		public var sessions: [SessionView]
		public var messages: [Message]
	}

	private struct Frame: Decodable {
		var t: String
		var message: Message?
		var agent: AgentView?
		var space: SpaceView?
		var role: RoleView?
		var session: SessionView?
		var id: String?
		var name: String?
	}

	public static func decode(_ data: Data) -> StreamEvent {
		let d = JSONDecoder()
		guard let f = try? d.decode(Frame.self, from: data) else { return .unknown }
		switch f.t {
		case "snapshot": if let s = try? d.decode(Snapshot.self, from: data) { return .snapshot(s) }
		case "message": if let m = f.message { return .message(m) }
		case "agent": if let a = f.agent { return .agent(a) }
		case "agent_removed": if let i = f.id { return .agentRemoved(i) }
		case "space": if let s = f.space { return .space(s) }
		case "space_removed": if let n = f.name { return .spaceRemoved(n) }
		case "role": if let r = f.role { return .role(r) }
		case "role_removed": if let i = f.id { return .roleRemoved(i) }
		case "session": if let t = f.session { return .session(t) }
		case "session_removed": if let i = f.id { return .sessionRemoved(i) }
		default: break
		}
		return .unknown
	}
}

public enum AgentStreamEvent: Sendable {
	case event(AgentEvent)
	case chunk(ChunkEvent)
	case agent(AgentView)
	case replayDone
	case unknown

	private struct Frame: Decodable {
		var t: String
		var event: AgentEvent?
		var chunk: ChunkEvent?
		var agent: AgentView?
	}

	public static func decode(_ data: Data) -> AgentStreamEvent {
		guard let f = try? JSONDecoder().decode(Frame.self, from: data) else { return .unknown }
		switch f.t {
		case "event": if let e = f.event { return .event(e) }
		case "chunk": if let c = f.chunk { return .chunk(c) }
		case "agent": if let a = f.agent { return .agent(a) }
		case "replay_done": return .replayDone
		default: break
		}
		return .unknown
	}
}

public struct StatusResponse: Codable, Sendable {
	public var version: String
	public var pid: Int
	public var uptimeSec: Double
	public var rev: Int
	public var home: String
	public var autoApprove: Bool
	public var spaces: Int
	public var agents: Int
	public var working: Int
	public var roles: Int
}
