import Foundation

/// Описание сессии (`summary.md` кейса) в формате сборщика (learning/prompts/session-collector.md):
/// заголовок, затем по разделу `## Goal:` на каждую цель. `render()` собирает markdown обратно, так что правка блоками
/// в карточке кейса не меняет формат: `render(parse(x)) == x` для текста в формате сборщика.
public struct CaseSummary: Hashable, Sendable {
	public struct Action: Hashable, Sendable {
		/// что сделано
		public var what: String
		/// кому поручено: «агент, роль»
		public var agent: String
		public var result: String
		/// диапазон событий `n a–b` (одно событие — `a…a`); нет — `nil`
		public var anchor: ClosedRange<Int>?

		public init(what: String, agent: String = "", result: String = "", anchor: ClosedRange<Int>? = nil) {
			self.what = what; self.agent = agent; self.result = result; self.anchor = anchor
		}
	}

	public struct Correction: Hashable, Sendable {
		/// что предлагал оркестратор
		public var proposed: String
		/// что сказал человек
		public var user: String
		public var anchor: ClosedRange<Int>?

		public init(proposed: String, user: String, anchor: ClosedRange<Int>? = nil) {
			self.proposed = proposed; self.user = user; self.anchor = anchor
		}
	}

	public struct Goal: Hashable, Sendable {
		public var title: String
		public var type: String
		/// строки плана как есть
		public var plan: [String]
		public var actions: [Action]
		public var sources: [String]
		public var corrections: [Correction]
		public var open: [String]

		public init(title: String, type: String = "", plan: [String] = [], actions: [Action] = [], sources: [String] = [], corrections: [Correction] = [], open: [String] = []) {
			self.title = title; self.type = type; self.plan = plan; self.actions = actions
			self.sources = sources; self.corrections = corrections; self.open = open
		}
	}

	public var title: String
	public var goals: [Goal]
	/// в тексте нет ни одного `## Goal:`: агент написал не по формату — карточка показывает текст как markdown
	public var unparsed: Bool

	public init(title: String = "", goals: [Goal] = [], unparsed: Bool = false) {
		self.title = title; self.goals = goals; self.unparsed = unparsed
	}

	// MARK: разбор

	private enum Section { case none, plan, actions, sources, corrections, open, other }

	public static func parse(_ markdown: String) -> CaseSummary {
		var out = CaseSummary()
		var goal: Goal?
		var section = Section.none
		func flush() { if let g = goal { out.goals.append(g); goal = nil } }

		for rawLine in markdown.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline) {
			let line = String(rawLine).trimmingTrailingSpaces()
			let t = line.trimmingCharacters(in: .whitespaces)
			if line.hasPrefix("# ") {
				if out.title.isEmpty && goal == nil { out.title = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces) }
				continue
			}
			if line.hasPrefix("## ") {
				flush()
				section = .none
				if let g = parseGoalHeader(line) { goal = g }
				continue
			}
			if line.hasPrefix("### ") {
				section = sectionKind(String(line.dropFirst(4)))
				continue
			}
			guard goal != nil, !t.isEmpty else { continue }
			let item = bulletText(t)
			if item.lowercased() == "none", section != .plan || t.hasPrefix("-") { continue }
			switch section {
			case .plan: goal?.plan.append(line)
			case .actions: goal?.actions.append(parseAction(item))
			case .sources: goal?.sources.append(item)
			case .corrections: goal?.corrections.append(parseCorrection(item))
			case .open: goal?.open.append(item)
			case .none, .other: break
			}
		}
		flush()
		out.unparsed = out.goals.isEmpty
		return out
	}

	private static func sectionKind(_ name: String) -> Section {
		switch name.trimmingCharacters(in: .whitespaces).lowercased() {
		case "plan": .plan
		case "actions": .actions
		case "sources": .sources
		case "user corrections", "corrections": .corrections
		case "open questions", "open": .open
		default: .other
		}
	}

	/// `## Goal: <название> (type: <тип>)`; без типа — тип пустой.
	private static func parseGoalHeader(_ line: String) -> Goal? {
		guard line.lowercased().hasPrefix("## goal:") else { return nil }
		let rest = String(line.dropFirst("## goal:".count)).trimmingCharacters(in: .whitespaces)
		if rest.hasSuffix(")"), let r = rest.range(of: "(type:", options: [.backwards, .caseInsensitive]) {
			let title = rest[..<r.lowerBound].trimmingCharacters(in: .whitespaces)
			let type = rest[r.upperBound...].dropLast().trimmingCharacters(in: .whitespaces)
			return Goal(title: title, type: type)
		}
		return Goal(title: rest)
	}

	private static func bulletText(_ t: String) -> String {
		if t.hasPrefix("- ") { return String(t.dropFirst(2)).trimmingCharacters(in: .whitespaces) }
		if t == "-" { return "" }
		return t
	}

	/// Якорь `(n 3–7)` или `(n 12)` в конце строки: текст без якоря и диапазон.
	static func splitAnchor(_ s: String) -> (text: String, anchor: ClosedRange<Int>?) {
		let t = s.trimmingCharacters(in: .whitespaces)
		guard t.hasSuffix(")"), let open = t.range(of: "(n ", options: .backwards) else { return (t, nil) }
		let inner = t[open.upperBound..<t.index(before: t.endIndex)]
		let nums = inner.split(whereSeparator: { "–—-".contains($0) }).map { Int($0.trimmingCharacters(in: .whitespaces)) }
		guard nums.count == 1 || nums.count == 2, !nums.contains(nil) else { return (t, nil) }
		let a = nums[0]!, b = nums.last!!
		return (t[..<open.lowerBound].trimmingCharacters(in: .whitespaces), min(a, b)...max(a, b))
	}

	/// `<что> -> <агент, роль> -> <итог> (n a–b)`; разделитель `->` или `→`.
	private static func parseAction(_ s: String) -> Action {
		let (text, anchor) = splitAnchor(s)
		var parts: [String] = []
		var rest = Substring(text)
		while parts.count < 2, let r = firstSeparator(in: rest) {
			parts.append(rest[..<r.lowerBound].trimmingCharacters(in: .whitespaces))
			rest = rest[r.upperBound...]
		}
		parts.append(rest.trimmingCharacters(in: .whitespaces))
		return Action(what: parts[0], agent: parts.count > 2 ? parts[1] : "", result: parts.count > 2 ? parts[2] : (parts.count > 1 ? parts[1] : ""), anchor: anchor)
	}

	private static func firstSeparator(in s: Substring) -> Range<Substring.Index>? {
		[s.range(of: " -> "), s.range(of: " → ")].compactMap { $0 }.min { $0.lowerBound < $1.lowerBound }
	}

	/// `Proposed: <...>. User: "<...>" (n a–b)`.
	private static func parseCorrection(_ s: String) -> Correction {
		let (text, anchor) = splitAnchor(s)
		var body = text
		if body.lowercased().hasPrefix("proposed:") { body = String(body.dropFirst("proposed:".count)).trimmingCharacters(in: .whitespaces) }
		guard let r = body.range(of: " User:", options: .caseInsensitive) ?? body.range(of: "User:", options: .caseInsensitive) else {
			return Correction(proposed: body, user: "", anchor: anchor)
		}
		var proposed = body[..<r.lowerBound].trimmingCharacters(in: .whitespaces)
		if proposed.hasSuffix(".") { proposed.removeLast() }
		var user = body[r.upperBound...].trimmingCharacters(in: .whitespaces)
		if user.count >= 2, user.hasPrefix("\""), user.hasSuffix("\"") { user = String(user.dropFirst().dropLast()) }
		return Correction(proposed: proposed, user: user, anchor: anchor)
	}

	// MARK: сборка

	/// Markdown в формате сборщика; пустой раздел — одна строка `- none`.
	public func render() -> String {
		var l: [String] = ["# \(title)"]
		for g in goals {
			l.append(g.type.isEmpty ? "## Goal: \(g.title)" : "## Goal: \(g.title) (type: \(g.type))")
			l.append("### Plan")
			l += g.plan.isEmpty ? ["- none"] : g.plan
			l.append("### Actions")
			l += g.actions.isEmpty ? ["- none"] : g.actions.map { a in
				"- \(a.what) -> \(a.agent) -> \(a.result)" + Self.anchorText(a.anchor)
			}
			l.append("### Sources")
			l += g.sources.isEmpty ? ["- none"] : g.sources.map { "- \($0)" }
			l.append("### User corrections")
			l += g.corrections.isEmpty ? ["- none"] : g.corrections.map { c in
				"- Proposed: \(c.proposed). User: \"\(c.user)\"" + Self.anchorText(c.anchor)
			}
			l.append("### Open questions")
			l += g.open.isEmpty ? ["- none"] : g.open.map { "- \($0)" }
		}
		return l.joined(separator: "\n") + "\n"
	}

	/// ` (n 3–7)` или ` (n 12)`; нет якоря — пусто.
	public static func anchorText(_ a: ClosedRange<Int>?) -> String {
		guard let a else { return "" }
		return a.lowerBound == a.upperBound ? " (n \(a.lowerBound))" : " (n \(a.lowerBound)–\(a.upperBound))"
	}
}

private extension String {
	func trimmingTrailingSpaces() -> String {
		var s = self
		while let c = s.last, c == " " || c == "\t" || c == "\r" { s.removeLast() }
		return s
	}
}
