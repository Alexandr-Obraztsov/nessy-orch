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
	/// Номер шага (с 0): первый `in_progress`, иначе первый `pending`.
	internal var currentStepIndex: Int? {
		guard let e = plan?.entries else { return nil }
		return e.firstIndex { $0.status == .inProgress } ?? e.firstIndex { $0.status == .pending }
	}

	/// Сырой текст текущего пункта плана (без «Шаг N из M»); nil — плана нет или все пункты выполнены.
	var currentPlanText: String? {
		guard let p = plan, let i = currentStepIndex else { return nil }
		return p.entries[i].content
	}

	/// Последняя выполненная задача как есть: последний завершённый пункт плана, иначе (пока агент работает) последний инструмент.
	var lastDoneText: String? {
		if let e = plan?.entries.last(where: { $0.status == .completed }) { return e.content }
		return nil
	}

	/// Последняя команда или инструмент как есть: «npm test», «Read src/net/retry.ts»; nil — ещё ничего не запускал.
	var toolText: String? {
		guard let t = lastTool else { return nil }
		let v = ToolNames.view(name: t.name, title: t.title, input: [:])
		if v.name == "Bash" { return v.arg.isEmpty ? nil : v.arg }
		return v.arg.isEmpty ? v.name : v.name + " " + v.arg
	}

	/// Что агент делает сейчас, сырым текстом: текущий пункт плана, иначе (план кончился или его нет) последняя команда.
	var stageLine: String? {
		if let t = currentPlanText { return t }
		if status == .working || status == .starting { return toolText }
		return lastDoneText
	}

	/// Этап работающего агента: текст — только последняя команда как есть (пусто, пока команд не было), без пояснений
	/// и времени тишины. Статусы шагов — для сегментов прогресса. nil — агент не работает.
	func stage(now: Date) -> AgentStage? {
		if status == .starting { return AgentStage(kind: .starting, text: "", steps: []) }
		guard status == .working else { return nil }
		let text = toolText ?? ""
		guard let p = plan, !p.entries.isEmpty else { return AgentStage(kind: .tool, text: text, steps: []) }
		return AgentStage(kind: currentStepIndex == nil ? .planDone : .step, text: text, steps: p.entries.map(\.status))
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

// MARK: сводка вызовов инструментов

/// Вид вызова инструмента: по нему рисуется значок и считается сводка «Запустил 3 команды · прочитал 2 файла».
public enum ToolKind: Int, CaseIterable, Sendable {
	case command, read, edit, search, web, other

	public static func of(name: String) -> ToolKind {
		switch name {
		case "Bash": .command
		case "Read", "LS": .read
		case "Write", "Edit": .edit
		case "Grep", "Glob": .search
		case "WebFetch", "WebSearch": .web
		default: .other
		}
	}

	/// SF Symbol для значка вызова.
	public var symbol: String {
		switch self {
		case .command: "terminal"
		case .read: "doc.text"
		case .edit: "pencil"
		case .search: "magnifyingglass"
		case .web: "globe"
		case .other: "wrench.and.screwdriver"
		}
	}
}

public enum ToolSummary {
	/// «Запустил 3 команды · прочитал 2 файла · изменил файл». Служебные (план, размышления) не считаются; пусто — считать нечего.
	public static func text(_ tools: [AgentEvent.ToolEvent]) -> String {
		var counts: [ToolKind: Int] = [:]
		for t in tools {
			let name = t.view.name
			if name == "TodoWrite" || name == "Think" { continue }
			counts[ToolKind.of(name: name), default: 0] += 1
		}
		var parts: [String] = []
		for k in ToolKind.allCases {
			guard let n = counts[k], n > 0 else { continue }
			parts.append(phrase(k, n))
		}
		guard !parts.isEmpty else { return Numbers.count(tools.count, "вызов", "вызова", "вызовов") }
		let s = parts.joined(separator: " · ")
		return s.prefix(1).uppercased() + s.dropFirst()
	}

	static func phrase(_ k: ToolKind, _ n: Int) -> String {
		switch k {
		case .command: "запустил " + Numbers.count(n, "команду", "команды", "команд")
		case .read: "прочитал " + Numbers.count(n, "файл", "файла", "файлов")
		case .edit: "изменил " + Numbers.count(n, "файл", "файла", "файлов")
		case .search: "поискал " + Numbers.count(n, "раз", "раза", "раз")
		case .web: "сходил в сеть " + Numbers.count(n, "раз", "раза", "раз")
		case .other: "вызвал " + Numbers.count(n, "инструмент", "инструмента", "инструментов")
		}
	}
}
