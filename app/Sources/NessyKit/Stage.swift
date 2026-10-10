import Foundation

// Этап агента (docs/design/screens.md §4): показываем только то, что агент сообщил, и как давно.

/// Человеческая фраза о вызове инструмента: «Читает retry.ts» сейчас и «прочитал retry.ts» в прошлом.
public struct ToolPhrase: Equatable, Sendable {
	public var present: String
	public var past: String
	/// короткий аргумент (команда, файл) — для «завершает: …»
	public var short: String
}

public enum ToolPhrases {
	/// Имя файла без каталога: «src/net/retry.ts:42» → «retry.ts:42».
	static func base(_ s: String) -> String {
		let first = s.split(separator: " ").first.map(String.init) ?? s
		return first.split(separator: "/").last.map(String.init) ?? first
	}

	static func host(_ s: String) -> String {
		let h = ReplyParser.hostOf(s)
		return h.isEmpty ? s : h
	}

	public static func of(_ v: ToolView) -> ToolPhrase {
		let arg = v.arg
		func with(_ verb: String, _ obj: String, sep: String = " ") -> String { obj.isEmpty ? verb : verb + sep + obj }
		switch v.name {
		case "Bash": return .init(present: with("Запускает команду", arg, sep: " · "), past: with("запустил", arg), short: arg)
		case "Read": let b = base(arg); return .init(present: with("Читает", b), past: with("прочитал", b), short: b)
		case "Write": let b = base(arg); return .init(present: with("Пишет", b), past: with("записал", b), short: b)
		case "Edit": let b = base(arg); return .init(present: with("Правит", b), past: with("поправил", b), short: b)
		case "Grep", "Glob": return .init(present: with("Ищет в коде", arg, sep: " · "), past: with("искал в коде", arg, sep: " · "), short: arg)
		case "LS": let b = base(arg); return .init(present: with("Смотрит каталог", b), past: with("посмотрел каталог", b), short: b)
		case "WebFetch": let h = host(arg); return .init(present: with("Открывает", h), past: with("открыл", h), short: h)
		case "WebSearch": return .init(present: with("Ищет в сети", arg, sep: " · "), past: with("искал в сети", arg, sep: " · "), short: arg)
		case "Think": return .init(present: with("Думает", arg, sep: " · "), past: with("подумал", arg, sep: " о "), short: arg)
		case "TodoWrite": return .init(present: "Обновляет план", past: "обновил план", short: "")
		default:
			let name = v.name.prefix(1).uppercased() + v.name.dropFirst()
			let p = with(name, arg, sep: " · ")
			return .init(present: p, past: p.prefix(1).lowercased() + p.dropFirst(), short: arg.isEmpty ? name : arg)
		}
	}
}

/// Что показать второй строкой у работающего агента.
public struct AgentStage: Equatable, Sendable {
	public enum Kind: Equatable, Sendable { case step, planDone, tool, silent, starting }
	public var kind: Kind
	public var text: String
	/// статусы шагов для сегментов прогресса (только при показе шага плана)
	public var steps: [PlanStatus]
}

public extension AgentView {
	var toolPhrase: ToolPhrase? {
		lastTool.map { ToolPhrases.of(ToolNames.view(name: $0.name, title: $0.title, input: [:])) }
	}

	/// Номер шага (с 0): первый `in_progress`, иначе первый `pending`.
	internal var currentStepIndex: Int? {
		guard let e = plan?.entries else { return nil }
		return e.firstIndex { $0.status == .inProgress } ?? e.firstIndex { $0.status == .pending }
	}

	/// Где агент по плану, без учёта времени. Пока агент работает, «все шаги выполнены» не пишем — показываем, чем он завершает.
	var stageLine: String? {
		guard let p = plan, !p.entries.isEmpty else { return nil }
		if let i = currentStepIndex { return "Шаг \(i + 1) из \(p.entries.count) · \(p.entries[i].content)" }
		if status == .working || status == .starting {
			if let t = toolPhrase { return "План выполнен · завершает: \(t.short.isEmpty ? t.present.lowercased() : t.short)" }
			return "План выполнен · завершает работу"
		}
		return "План выполнен · \(p.entries.count) из \(p.entries.count)"
	}

	/// Этап работающего агента с учётом тишины и устаревшего плана; nil — агент не работает.
	func stage(now: Date, silenceAfter: TimeInterval = 60, planStaleAfter: TimeInterval = 180) -> AgentStage? {
		if status == .starting { return AgentStage(kind: .starting, text: "Запускается", steps: []) }
		guard status == .working else { return nil }
		let last = lastActivity ?? now
		let quiet = now.timeIntervalSince(last)
		let tool = toolPhrase
		if quiet > silenceAfter {
			let head = "Нет новостей \(Durations.clock(quiet * 1000))"
			return AgentStage(kind: .silent, text: tool.map { "\(head) · последнее: \($0.past)" } ?? head, steps: [])
		}
		let toolStage: AgentStage = {
			let secs = Int(quiet)
			let base = tool?.present ?? "Думает"
			return AgentStage(kind: .tool, text: secs >= 5 ? "\(base) · \(secs) с" : base, steps: [])
		}()
		guard let p = plan, !p.entries.isEmpty else { return toolStage }
		guard let i = currentStepIndex else {
			return AgentStage(kind: .planDone, text: stageLine ?? "План выполнен", steps: p.entries.map(\.status))
		}
		// шаг не менялся > 3 мин, а инструменты идут — план устарел, правда у инструмента
		if let upd = ISO.parse(p.updatedAt), now.timeIntervalSince(upd) > planStaleAfter, last > upd { return toolStage }
		return AgentStage(kind: .step, text: "Шаг \(i + 1) из \(p.entries.count) · \(p.entries[i].content)", steps: p.entries.map(\.status))
	}
}

// MARK: числа по-русски

public enum Numbers {
	/// «840», «2,8 тыс.», «12 тыс.», «1,4 млн».
	public static func compact(_ n: Int) -> String {
		func fmt(_ v: Double, _ unit: String) -> String {
			let s = v >= 10 ? String(format: "%.0f", v) : String(format: "%.1f", v)
			return s.replacingOccurrences(of: ".0", with: "").replacingOccurrences(of: ".", with: ",") + " " + unit
		}
		if n >= 1_000_000 { return fmt(Double(n) / 1_000_000, "млн") }
		if n >= 1000 { return fmt(Double(n) / 1000, "тыс.") }
		return "\(n)"
	}

	/// «4 вызова», «1 ход».
	public static func count(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
		"\(n) \(Durations.plural(n, one, few, many))"
	}

	/// Счётчики агента одной строкой: «1 ход · 4 вызова · 2,8 тыс. токенов».
	public static func statsLine(_ s: AgentStats) -> String {
		var p = [count(s.turns, "ход", "хода", "ходов"), count(s.toolCalls, "вызов", "вызова", "вызовов")]
		if let t = s.tokens { p.append("\(compact(t.total)) токенов") }
		return p.joined(separator: " · ")
	}
}

// MARK: окно плана

/// Какие шаги плана показать: окно вокруг текущего с «ещё N» с обеих сторон.
public struct PlanWindow: Equatable, Sendable {
	public var range: Range<Int>
	/// скрыто выше окна
	public var before: Int
	/// скрыто ниже окна
	public var after: Int
	public init(range: Range<Int>, before: Int, after: Int) { self.range = range; self.before = before; self.after = after }
}

public enum PlanWindowing {
	/// Короткий план (≤ limit) показываем целиком; длинный — `limit` шагов, текущий — второй сверху (виден один выполненный до него).
	public static func window(count: Int, current: Int?, limit: Int = 5) -> PlanWindow {
		guard count > limit, limit > 0 else { return PlanWindow(range: 0..<count, before: 0, after: 0) }
		let cur = min(max(current ?? count - 1, 0), count - 1)
		let start = min(max(cur - 1, 0), count - limit)
		return PlanWindow(range: start..<(start + limit), before: start, after: count - start - limit)
	}

	/// Текущий шаг: первый «в работе», иначе первый не выполненный; все выполнены — nil.
	public static func current(_ entries: [PlanEntry]) -> Int? {
		entries.firstIndex { $0.status == .inProgress } ?? entries.firstIndex { $0.status == .pending }
	}
}
