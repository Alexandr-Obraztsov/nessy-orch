import Foundation

/// Фильтр списка кейсов по статусу.
public enum CaseFilter: String, CaseIterable, Sendable {
	case all, collecting, ready, error

	public var title: String {
		switch self {
		case .all: "Все"
		case .collecting: "Собираются"
		case .ready: "Готовы"
		case .error: "Ошибка"
		}
	}

	public func matches(_ s: CaseStatus) -> Bool {
		switch self {
		case .all: true
		case .collecting: s == .collecting || s == .closing
		case .ready: s == .ready
		case .error: s == .error
		}
	}
}

/// Логика раздела «Кейсы» без интерфейса: список, правка строк и блоков, повтор сохранения.
public enum CaseEditing {
	/// Кейсы по фильтру и поиску (по заголовку, названиям и типам целей, названиям сессий), самые свежие сверху.
	public static func list(
		_ cases: [CaseView], filter: CaseFilter, query: String,
		titleOf: (CaseView) -> String, sessionTitlesOf: (CaseView) -> [String]
	) -> [CaseView] {
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return cases
			.filter { filter.matches($0.status) }
			.filter { c in
				guard !q.isEmpty else { return true }
				let hay = [titleOf(c)] + c.goals.flatMap { [$0.title, $0.type] } + sessionTitlesOf(c)
				return hay.contains { $0.lowercased().contains(q) }
			}
			.sorted { a, b in
				let da = ISO.parse(a.updatedAt), db = ISO.parse(b.updatedAt)
				if let da, let db, da != db { return da > db }
				return a.updatedAt > b.updatedAt
			}
	}

	/// Копия списка с элементом `i`, сдвинутым на `delta` (−1 вверх, +1 вниз); за границу не уходит.
	public static func moved<T>(_ a: [T], at i: Int, by delta: Int) -> [T] {
		let j = i + delta
		guard a.indices.contains(i), a.indices.contains(j) else { return a }
		var r = a
		r.swapAt(i, j)
		return r
	}

	/// Сборщик или агент-редактор не работает над кейсом: правку описания можно отправлять (иначе сервер ответит `case_busy`).
	public static func canRetry(jobs: [JobView], caseId: String) -> Bool {
		!jobs.contains { $0.caseId == caseId && ($0.status == .queued || $0.status == .running) }
	}

	/// Заметки: непустые строки текста `notes.md`.
	public static func notes(from text: String) -> [String] {
		text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
	}

	public static func text(fromNotes notes: [String]) -> String {
		let lines = notes.map { $0.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
		return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
	}

	/// Описание перед сохранением: пустые строки пунктов убраны, пункты без «что» и пустые поправки тоже.
	public static func cleaned(_ s: CaseSummary) -> CaseSummary {
		func t(_ x: String) -> String { x.trimmingCharacters(in: .whitespacesAndNewlines) }
		var r = s
		r.title = t(s.title)
		r.goals = s.goals.map { g in
			var g = g
			g.title = t(g.title); g.type = t(g.type)
			g.plan = g.plan.filter { !t($0).isEmpty }
			g.actions = g.actions.compactMap { a in
				guard !t(a.what).isEmpty else { return nil }
				return CaseSummary.Action(what: t(a.what), agent: t(a.agent), result: t(a.result), anchor: a.anchor, cont: a.cont)
			}
			g.sources = g.sources.map(t).filter { !$0.isEmpty }
			g.corrections = g.corrections.compactMap { c in
				guard !t(c.proposed).isEmpty || !t(c.user).isEmpty else { return nil }
				return CaseSummary.Correction(proposed: t(c.proposed), user: t(c.user), anchor: c.anchor, cont: c.cont)
			}
			g.open = g.open.map(t).filter { !$0.isEmpty }
			return g
		}
		return r
	}

	/// Markdown для `PUT …/summary` из правок.
	public static func markdown(_ s: CaseSummary) -> String { cleaned(s).render() }

	/// Строки предупреждения при удалении кейса: какие правила потеряют доказательство.
	public static func impactLines(_ i: CaseImpact) -> [String] {
		i.rules.map { r in
			let text = r.text.count > 90 ? String(r.text.prefix(90)) + "…" : r.text
			let tail = r.evidenceLeft == 0 ? "останется без доказательств" : "потеряет доказательство (осталось \(r.evidenceLeft))"
			return "Правило «\(text)» (\(r.playbookId)) \(tail)"
		}
	}
}
