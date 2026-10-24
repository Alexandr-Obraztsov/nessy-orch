import Foundation

// Этап агента (docs/design/screens.md §4): показываем только то, что агент сообщил, и как давно.

/// Человеческая фраза о вызове инструмента: «Читает retry.ts» сейчас и «прочитал retry.ts» в прошлом.
public struct ToolPhrase: Equatable, Sendable {
	public var present: String
	public var past: String
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
		case "Bash": return .init(present: with("Запускает команду", arg, sep: " · "), past: with("запустил", arg))
		case "Read": let b = base(arg); return .init(present: with("Читает", b), past: with("прочитал", b))
		case "Write": let b = base(arg); return .init(present: with("Пишет", b), past: with("записал", b))
		case "Edit": let b = base(arg); return .init(present: with("Правит", b), past: with("поправил", b))
		case "Grep", "Glob": return .init(present: with("Ищет в коде", arg, sep: " · "), past: with("искал в коде", arg, sep: " · "))
		case "LS": let b = base(arg); return .init(present: with("Смотрит каталог", b), past: with("посмотрел каталог", b))
		case "WebFetch": let h = host(arg); return .init(present: with("Открывает", h), past: with("открыл", h))
		case "WebSearch": return .init(present: with("Ищет в сети", arg, sep: " · "), past: with("искал в сети", arg, sep: " · "))
		case "Think": return .init(present: with("Думает", arg, sep: " · "), past: with("подумал", arg, sep: " о "))
		case "TodoWrite": return .init(present: "Обновляет план", past: "обновил план")
		default:
			let name = v.name.prefix(1).uppercased() + v.name.dropFirst()
			let p = with(name, arg, sep: " · ")
			return .init(present: p, past: p.prefix(1).lowercased() + p.dropFirst())
		}
	}
}

/// Что показать второй строкой у работающего агента.
public struct AgentStage: Equatable, Sendable {
	public enum Kind: Equatable, Sendable { case step, planDone, tool, starting }
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

	/// Последний выполненный пункт плана как есть; nil — ни один не выполнен.
	var lastDoneText: String? { plan?.entries.last(where: { $0.status == .completed })?.content }

	/// Чем занят работающий агент, без деталей: «Читает файл», «Пишет файл», «Запускает команду» — как в карточках Claude. Команды и пути не показываем.
	/// nil — ещё ничего не делал.
	var activity: String? {
		if status == .starting { return "Запускается" }
		guard let t = lastTool else { return nil }
		return ToolKind.activity(name: ToolNames.view(name: t.name, title: t.title, input: [:]).name)
	}

	/// Последняя команда или инструмент как есть: «npm test», «Read src/net/retry.ts»; nil — ещё ничего не запускал.
	var toolText: String? {
		guard let t = lastTool else { return nil }
		let v = ToolNames.view(name: t.name, title: t.title, input: [:])
		if v.name == "Bash" { return v.arg.isEmpty ? nil : v.arg }
		return v.arg.isEmpty ? v.name : v.name + " " + v.arg
	}

	/// Этап работающего агента: текст — только последняя команда как есть (пусто, пока команд не было), без пояснений
	/// и времени тишины. Статусы шагов — для сегментов прогресса. nil — агент не работает.
	func stage(now: Date) -> AgentStage? {
		if status == .starting { return AgentStage(kind: .starting, text: "", steps: []) }
		guard status == .working else { return nil }
		let text = activity ?? ""
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
		if let t = s.tokens, t.total > 0 { p.append("\(compact(t.total)) токенов") }
		return p.joined(separator: " · ")
	}
}

// MARK: план

public enum PlanWindowing {
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

	/// Что делает агент, пока идёт вызов этого инструмента.
	public static func activity(name: String) -> String {
		switch name {
		case "Bash": "Запускает команду"
		case "Read": "Читает файл"
		case "LS": "Смотрит каталог"
		case "Write": "Пишет файл"
		case "Edit": "Правит файл"
		case "Grep", "Glob": "Ищет в коде"
		case "WebFetch": "Открывает страницу"
		case "WebSearch": "Ищет в сети"
		case "Think": "Думает"
		case "TodoWrite": "Обновляет план"
		default: "Работает"
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
