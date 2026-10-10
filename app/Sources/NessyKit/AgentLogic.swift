import Foundation

/// Отображаемое состояние агента. Порядок важности: ждёт → ошибка → работает → запуск → выполнено → свободен.
public enum AgentState: Int, Sendable, Comparable {
	case wait, working, starting, error, idle, done
	public static func < (a: AgentState, b: AgentState) -> Bool { a.rank < b.rank }
	/// порядок карточек в задаче: ждут → работают → ошибка → ждут поручения → выполнены
	var rank: Int {
		switch self {
		case .wait: 0
		case .working, .starting: 1
		case .error: 2
		case .idle: 3
		case .done: 4
		}
	}
	public var label: String {
		switch self {
		case .wait: "Ждёт решения"
		case .error: "Ошибка"
		case .working: "Работает"
		case .starting: "Запускается"
		case .idle: "Ждёт поручения"
		case .done: "Готово"
		}
	}
}

public extension AgentView {
	var state: AgentState {
		if !pendingPermissions.isEmpty { return .wait }
		if status == .error { return .error }
		if status == .working { return .working }
		if status == .starting { return .starting }
		return archived || (lastReply != nil && lastReply?.failed == nil) ? .done : .idle
	}
	var canStop: Bool { status == .working || status == .starting }
	/// Ход закончен (готово, ошибка, ждёт поручения): в окне агента показываем итог, а не чат.
	var isFinished: Bool { state == .done || state == .idle || state == .error }
	var created: Date? { ISO.parse(createdAt) }
	var lastActivity: Date? { ISO.parse(lastActivityAt) }
	var turnStarted: Date? { ISO.parse(turnStartedAt) }

	/// Заголовок: имя сессии nessy, иначе имя агента.
	var title: String { name }

	/// Таймер хода, мс: идущий — от начала, закончивший — длительность последнего; nil — «—».
	func elapsedMs(now: Date) -> Double? {
		if let t = turnStarted, status == .working || status == .starting { return max(0, now.timeIntervalSince(t) * 1000) }
		if status == .starting, let c = created { return max(0, now.timeIntervalSince(c) * 1000) }
		return lastTurnMs
	}

	/// Давно нет событий у работающего агента — возможно, завис.
	func isStalled(now: Date, after: TimeInterval = 300) -> Bool {
		guard status == .working, let a = lastActivity else { return false }
		return now.timeIntervalSince(a) > after
	}
}

public struct PlanProgress: Equatable, Sendable {
	public var done: Int
	public var total: Int
	public var active: Int?
	public var step: String?
	public var fraction: Double { total == 0 ? 0 : Double(done) / Double(total) }
}

public extension AgentPlan {
	var progress: PlanProgress {
		let active = entries.firstIndex { $0.status == .inProgress }
		return PlanProgress(
			done: entries.filter { $0.status == .completed }.count,
			total: entries.count,
			active: active,
			step: active.map { entries[$0].content }
		)
	}
}

public enum AgentOrder {
	/// Ждут разрешения → работают → ошибка → ждут поручения → выполненные; внутри — по времени запуска (карточки не прыгают).
	public static func sorted(_ agents: [AgentView]) -> [AgentView] {
		agents.sorted {
			let (a, b) = ($0.state, $1.state)
			if a.rank != b.rank { return a.rank < b.rank }
			let (ta, tb) = ($0.created ?? .distantPast, $1.created ?? .distantPast)
			if ta != tb { return ta < tb }
			return $0.id < $1.id
		}
	}
}

// MARK: поручение

public enum Brief {
	/// Первое сообщение каждому агенту: от you, иначе от кого угодно (ключ — id получателя).
	public static func firstMessages(_ messages: [Message]) -> [String: Message] {
		var fromYou: [String: Message] = [:]
		var any: [String: Message] = [:]
		for m in messages where m.kind == .msg {
			if any[m.to] == nil { any[m.to] = m }
			if m.from == "you", fromYou[m.to] == nil { fromYou[m.to] = m }
		}
		for (id, m) in any where fromYou[id] == nil { fromYou[id] = m }
		return fromYou
	}

	/// Текст поручения для карточки: без разметки markdown, абзацы — переносами.
	public static func plain(_ text: String) -> String {
		var t = text
		t = t.replacingOccurrences(of: "```[\\s\\S]*?```", with: " … ", options: .regularExpression)
		return t.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
			var l = String(line)
			l = l.replacingOccurrences(of: "^\\s*(?:#{1,6}\\s+|>\\s?|[-*+]\\s+(?:\\[[ xX]\\]\\s+)?)", with: "", options: .regularExpression)
			l = l.replacingOccurrences(of: "[*_`]{1,3}([^*_`]+)[*_`]{1,3}", with: "$1", options: .regularExpression)
			l = l.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
			return l.trimmingCharacters(in: .whitespaces)
		}.filter { !$0.isEmpty }.joined(separator: "\n")
	}

	public static func of(_ a: AgentView, first: [String: Message]) -> String {
		if let m = first[a.id] {
			let p = plain(m.text)
			if !p.isEmpty { return p }
		}
		return a.displayName ?? plain(a.preview)
	}

	/// Текст результата для превью: без «Источников» и строки «Статус», без служебного «Итог —» в начале, одной строкой.
	public static func resultText(_ text: String, limit: Int = 240) -> String {
		var body = plain(ReplyParser.parse(text).body)
		body = body.replacingOccurrences(of: "^(?:итог|ответ|резюме|вердикт)\\s*[:—–-]\\s*", with: "", options: [.regularExpression, .caseInsensitive])
		body = body.replacingOccurrences(of: "\\s*\\n\\s*", with: " ", options: .regularExpression)
		return body.count > limit ? String(body.prefix(limit - 1)) + "…" : body
	}

	/// Краткий итог из превью: без служебного «Итог:» в начале.
	public static func summary(_ a: AgentView) -> String {
		let p = a.lastReply?.preview.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return p.replacingOccurrences(of: "^(?:итог|ответ|резюме|вердикт)\\s*[:—–-]\\s*", with: "", options: [.regularExpression, .caseInsensitive])
	}
}

// MARK: инструмент в стиле Claude Code

public struct ToolView: Equatable, Sendable {
	public var name: String
	public var arg: String
}

public enum ToolNames {
	static let known: [String: String] = [
		"run_shell_command": "Bash", "shell": "Bash", "bash": "Bash", "execute": "Bash", "terminal": "Bash",
		"read_file": "Read", "read_many_files": "Read", "read": "Read",
		"write_file": "Write", "write": "Write", "create_file": "Write",
		"replace": "Edit", "edit": "Edit", "edit_file": "Edit", "multi_edit": "Edit",
		"glob": "Glob", "search_file_content": "Grep", "grep": "Grep", "search": "Grep",
		"list_directory": "LS", "ls": "LS",
		"web_fetch": "WebFetch", "fetch": "WebFetch", "google_web_search": "WebSearch", "web_search": "WebSearch",
		"think": "Think", "todo_write": "TodoWrite", "save_memory": "Memory",
	]
	static let argKeys = ["command", "cmd", "file_path", "absolute_path", "path", "paths", "pattern", "query", "url", "prompt", "step", "description"]

	static func pretty(_ raw: String) -> String {
		let n = raw.trimmingCharacters(in: .whitespaces)
		if let k = known[n.lowercased()] { return k }
		if let m = try? NSRegularExpression(pattern: "^(?:mcp__)?([\\w-]+?)(?:__|\\||\\.)([\\w.-]+)$").firstMatch(in: n, range: NSRange(n.startIndex..., in: n)),
			let a = Range(m.range(at: 1), in: n), let b = Range(m.range(at: 2), in: n) {
			return "\(n[a]) · \(n[b])"
		}
		return n
	}

	static func arg(from input: [String: JSONValue]) -> String {
		for k in argKeys {
			switch input[k] {
			case .string(let s) where !s.trimmingCharacters(in: .whitespaces).isEmpty: return s.trimmingCharacters(in: .whitespacesAndNewlines)
			case .array(let a) where !a.isEmpty: return a.compactMap(\.string).joined(separator: " ")
			default: continue
			}
		}
		return ""
	}

	public static func view(name: String, title: String, input: [String: JSONValue]) -> ToolView {
		let t = title.trimmingCharacters(in: .whitespaces)
		var fromTitle: (name: String, arg: String)?
		if let r = t.range(of: ": "), t.distance(from: t.startIndex, to: r.lowerBound) > 0, t.distance(from: t.startIndex, to: r.lowerBound) <= 24 {
			fromTitle = (String(t[..<r.lowerBound]), String(t[r.upperBound...]))
		}
		let generic = name.isEmpty || name == "tool" || name == "other"
		let n = pretty(generic ? (fromTitle?.name ?? (t.isEmpty ? "Tool" : t)) : name)
		let titleName = fromTitle.map { pretty($0.name) } ?? ""
		var a = arg(from: input)
		if a.isEmpty { a = fromTitle?.arg ?? "" }
		if a.isEmpty, !t.isEmpty, t != name, titleName != n { a = t }
		return ToolView(name: n, arg: a.split(whereSeparator: \.isWhitespace).joined(separator: " "))
	}
}

public extension AgentEvent.ToolEvent {
	var view: ToolView { ToolNames.view(name: name, title: title, input: input) }
}
