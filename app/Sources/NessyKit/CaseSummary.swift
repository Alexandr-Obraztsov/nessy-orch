import Foundation

/// Описание сессии (`summary.md` кейса) в формате сборщика (learning/prompts/session-collector.md):
/// заголовок, затем по разделу `## Goal:` на каждую цель. `render()` собирает markdown обратно, так что правка блоками
/// в карточке кейса не меняет формат: `render(parse(x)) == x` для текста в формате сборщика.
/// Всё, что блоки показать не умеют (текст до первой цели и до первого `###`, неизвестные разделы `###` и `##`, продолжения пунктов),
/// лежит сырыми строками на своих местах и возвращается при сборке; такое описание — `editable == false`.
public struct CaseSummary: Hashable, Sendable {
	/// Известные разделы цели.
	public enum Kind: String, CaseIterable, Hashable, Sendable {
		case plan, actions, sources, corrections, open

		public var heading: String {
			switch self {
			case .plan: "Plan"
			case .actions: "Actions"
			case .sources: "Sources"
			case .corrections: "User corrections"
			case .open: "Open questions"
			}
		}
	}

	/// Раздел цели в порядке исходного текста: известный (строка заголовка как была) или чужой — заголовок и строки как есть.
	public enum Slot: Hashable, Sendable {
		case known(Kind, heading: String)
		case raw(heading: String, lines: [String])
	}

	public struct Action: Hashable, Sendable {
		/// что сделано
		public var what: String
		/// кому поручено: «агент, роль»
		public var agent: String
		public var result: String
		/// диапазон событий `n a–b` (одно событие — `a…a`); нет — `nil`
		public var anchor: ClosedRange<Int>?
		/// продолжение пункта: строки без `- ` после него, как есть
		public var cont: [String]

		public init(what: String, agent: String = "", result: String = "", anchor: ClosedRange<Int>? = nil, cont: [String] = []) {
			self.what = what; self.agent = agent; self.result = result; self.anchor = anchor; self.cont = cont
		}
	}

	public struct Correction: Hashable, Sendable {
		/// что предлагал оркестратор
		public var proposed: String
		/// что сказал человек
		public var user: String
		public var anchor: ClosedRange<Int>?
		public var cont: [String]

		public init(proposed: String, user: String, anchor: ClosedRange<Int>? = nil, cont: [String] = []) {
			self.proposed = proposed; self.user = user; self.anchor = anchor; self.cont = cont
		}
	}

	public struct Goal: Hashable, Sendable {
		public var title: String
		public var type: String
		/// строки плана как есть
		public var plan: [String]
		public var actions: [Action]
		/// пункты; продолжение пункта дописано к нему через `\n`
		public var sources: [String]
		public var corrections: [Correction]
		public var open: [String]
		/// строки между `## Goal:` и первым `###`
		public var intro: [String]
		/// порядок разделов исходного текста; у новой цели пусто — раздел за разделом в формате сборщика
		public var slots: [Slot]
		/// строки после неизвестного `## …` (вместе с ним) до следующей цели
		public var trailing: [String]

		public init(title: String, type: String = "", plan: [String] = [], actions: [Action] = [], sources: [String] = [], corrections: [Correction] = [], open: [String] = [], intro: [String] = [], slots: [Slot] = [], trailing: [String] = []) {
			self.title = title; self.type = type; self.plan = plan; self.actions = actions
			self.sources = sources; self.corrections = corrections; self.open = open
			self.intro = intro; self.slots = slots; self.trailing = trailing
		}

		fileprivate var isFresh: Bool { slots.isEmpty && intro.isEmpty && trailing.isEmpty }

		fileprivate func isEmpty(_ k: Kind) -> Bool {
			switch k {
			case .plan: plan.isEmpty
			case .actions: actions.isEmpty
			case .sources: sources.isEmpty
			case .corrections: corrections.isEmpty
			case .open: open.isEmpty
			}
		}

		fileprivate var hasHiddenContent: Bool {
			intro.contains(where: \.hasText) || trailing.contains(where: \.hasText)
				|| slots.contains { if case .raw = $0 { true } else { false } }
				|| actions.contains { !$0.cont.isEmpty } || corrections.contains { !$0.cont.isEmpty }
				|| sources.contains { $0.contains("\n") } || open.contains { $0.contains("\n") }
		}
	}

	public var title: String
	public var goals: [Goal]
	/// в тексте нет ни одного `## Goal:`: агент написал не по формату — карточка показывает текст как markdown
	public var unparsed: Bool
	/// строки до первой цели, кроме заголовка `# …`, как есть
	public var preamble: [String]
	/// место строки заголовка среди строк `preamble`; `nil` — в тексте заголовка нет
	public var titleAt: Int?

	public init(title: String = "", goals: [Goal] = [], unparsed: Bool = false, preamble: [String] = [], titleAt: Int? = 0) {
		self.title = title; self.goals = goals; self.unparsed = unparsed; self.preamble = preamble; self.titleAt = titleAt
	}

	/// Правка блоками покажет всё содержимое: нет ничего, кроме заголовка, целей и их известных разделов. Иначе — чат и правка текстом.
	public var editable: Bool { !unparsed && !preamble.contains(where: \.hasText) && !goals.contains { $0.hasHiddenContent } }

	// MARK: разбор

	private enum Ctx { case preamble, intro, known(Kind), raw, trailing }

	public static func parse(_ markdown: String) -> CaseSummary {
		var out = CaseSummary(titleAt: nil)
		var goal: Goal?
		var ctx = Ctx.preamble
		var seen = Set<Kind>()
		func flush() { if let g = goal { out.goals.append(g); goal = nil } }

		var lines = markdown.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).map(String.init)
		if lines.last == "" { lines.removeLast() }

		for rawLine in lines {
			let line = rawLine.trimmingTrailingSpaces()
			let t = line.trimmingCharacters(in: .whitespaces)
			if line.hasPrefix("# ") {
				if out.titleAt == nil && goal == nil {
					out.title = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)
					out.titleAt = out.preamble.count
				} else if goal == nil {
					out.preamble.append(rawLine)
				} else if case .trailing = ctx {
					goal?.trailing.append(rawLine)
				} else {
					goal?.slots.append(.raw(heading: rawLine, lines: []))
					ctx = .raw
				}
				continue
			}
			if line.hasPrefix("## ") {
				if let g = parseGoalHeader(line) {
					flush(); goal = g; ctx = .intro; seen = []
				} else if goal == nil {
					out.preamble.append(rawLine)
				} else {
					ctx = .trailing
					goal?.trailing.append(rawLine)
				}
				continue
			}
			if line.hasPrefix("### "), goal != nil {
				if case .trailing = ctx { goal?.trailing.append(rawLine); continue }
				if let k = sectionKind(String(line.dropFirst(4))), !seen.contains(k) {
					seen.insert(k)
					goal?.slots.append(.known(k, heading: rawLine))
					ctx = .known(k)
				} else {
					goal?.slots.append(.raw(heading: rawLine, lines: []))
					ctx = .raw
				}
				continue
			}
			switch ctx {
			case .preamble: out.preamble.append(rawLine)
			case .intro: goal?.intro.append(rawLine)
			case .trailing: goal?.trailing.append(rawLine)
			case .raw:
				if var g = goal, case .raw(let h, var ls)? = g.slots.last {
					ls.append(rawLine)
					g.slots[g.slots.count - 1] = .raw(heading: h, lines: ls)
					goal = g
				}
			case .known(let k):
				guard !t.isEmpty else { continue }
				let isBullet = t.hasPrefix("- ") || t == "-"
				let item = bulletText(t)
				if item.lowercased() == "none", k != .plan || t.hasPrefix("-") { continue }
				switch k {
				case .plan: goal?.plan.append(line)
				case .actions:
					if !isBullet, let last = goal?.actions.indices.last { goal?.actions[last].cont.append(rawLine) } else { goal?.actions.append(parseAction(item)) }
				case .sources:
					if !isBullet, let last = goal?.sources.indices.last { goal?.sources[last] += "\n" + rawLine } else { goal?.sources.append(item) }
				case .corrections:
					if !isBullet, let last = goal?.corrections.indices.last { goal?.corrections[last].cont.append(rawLine) } else { goal?.corrections.append(parseCorrection(item)) }
				case .open:
					if !isBullet, let last = goal?.open.indices.last { goal?.open[last] += "\n" + rawLine } else { goal?.open.append(item) }
				}
			}
		}
		flush()
		out.unparsed = out.goals.isEmpty
		return out
	}

	private static func sectionKind(_ name: String) -> Kind? {
		switch name.trimmingCharacters(in: .whitespaces).lowercased() {
		case "plan": .plan
		case "actions": .actions
		case "sources": .sources
		case "user corrections", "corrections": .corrections
		case "open questions", "open": .open
		default: nil
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

	/// `<что> -> <агент, роль> -> <итог> (n a–b)`; разделитель `->` или `→`. Хвост `->` без итога — агент без итога.
	private static func parseAction(_ s: String) -> Action {
		var (text, anchor) = splitAnchor(s)
		if text.hasSuffix(" ->") || text.hasSuffix(" →") { text += " " }
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

	/// Markdown в формате сборщика; пустой известный раздел — одна строка `- none`, неизвестное — как в исходном тексте.
	public func render() -> String {
		var l: [String] = []
		var pre = preamble
		if let at = titleAt { pre.insert("# \(title)", at: min(at, pre.count)) } else if !title.isEmpty { pre.insert("# \(title)", at: 0) }
		l += pre
		for g in goals {
			l.append(g.type.isEmpty ? "## Goal: \(g.title)" : "## Goal: \(g.title) (type: \(g.type))")
			l += g.intro
			var emitted = Set<Kind>()
			for slot in g.slots {
				switch slot {
				case .known(let k, let heading): l.append(heading); l += body(g, k); emitted.insert(k)
				case .raw(let heading, let lines): l.append(heading); l += lines
				}
			}
			for k in Kind.allCases where !emitted.contains(k) && (g.isFresh || !g.isEmpty(k)) {
				l.append("### \(k.heading)"); l += body(g, k)
			}
			l += g.trailing
		}
		return l.joined(separator: "\n") + "\n"
	}

	private func body(_ g: Goal, _ k: Kind) -> [String] {
		switch k {
		case .plan: return g.plan.isEmpty ? ["- none"] : g.plan
		case .actions: return g.actions.isEmpty ? ["- none"] : g.actions.flatMap { a in ["- " + Self.actionText(a)] + a.cont }
		case .sources: return g.sources.isEmpty ? ["- none"] : g.sources.map { "- \($0)" }
		case .corrections: return g.corrections.isEmpty ? ["- none"] : g.corrections.flatMap { c in ["- " + Self.correctionText(c)] + c.cont }
		case .open: return g.open.isEmpty ? ["- none"] : g.open.map { "- \($0)" }
		}
	}

	/// `что -> агент -> итог (n a–b)`: пустые агент и итог без хвостов `->`.
	static func actionText(_ a: Action) -> String {
		var s = a.what
		if !a.agent.isEmpty { s += " -> \(a.agent) ->" + (a.result.isEmpty ? "" : " \(a.result)") }
		else if !a.result.isEmpty { s += " -> \(a.result)" }
		return s + anchorText(a.anchor)
	}

	static func correctionText(_ c: Correction) -> String {
		var s: String
		if c.user.isEmpty { s = "Proposed: \(c.proposed)" }
		else if c.proposed.isEmpty { s = "User: \"\(c.user)\"" }
		else { s = "Proposed: \(c.proposed). User: \"\(c.user)\"" }
		return s + anchorText(c.anchor)
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

	var hasText: Bool { !trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
