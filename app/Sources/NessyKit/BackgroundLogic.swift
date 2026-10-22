import Foundation

/// Логика окна «Фон» без UI: списки «В процессе», «Кейсы», «Плейбуки» и подписи.
public enum BackgroundLogic {
	/// Задания описания сессии (сбор и закрытие): остальные виды в «В процессе» не показываются.
	public static func isSessionJob(_ j: JobView) -> Bool { j.kind == .collect || j.kind == .close }

	/// «Ждут обработки»: сессии в очереди, по порядку постановки.
	public static func waiting(_ jobs: [JobView]) -> [JobView] {
		jobs.filter { isSessionJob($0) && $0.status == .queued }.sorted { $0.createdAt < $1.createdAt }
	}

	/// «Обрабатываются»: сессии с идущим заданием, давно начатые сверху.
	public static func processing(_ jobs: [JobView]) -> [JobView] {
		jobs.filter { isSessionJob($0) && $0.status == .running }.sorted { ($0.startedAt ?? $0.createdAt) < ($1.startedAt ?? $1.createdAt) }
	}

	/// Название строки «В процессе»: название сессии из задания, иначе подпись от вызывающего (заголовок кейса).
	public static func jobTitle(_ j: JobView, fallback: String) -> String {
		let t = j.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return t.isEmpty ? fallback : t
	}

	/// «Прочитано 12 из 40 событий».
	public static func progressLine(_ p: JobProgress?) -> String {
		guard let p, p.total > 0 else { return "Читаю сессию…" }
		return "Прочитано \(min(p.read, p.total)) из \(p.total) \(Durations.plural(p.total, "события", "событий", "событий"))"
	}

	/// Доля прочитанного, 0…1.
	public static func progressFraction(_ p: JobProgress?) -> Double {
		guard let p, p.total > 0 else { return 0 }
		return min(1, max(0, Double(p.read) / Double(p.total)))
	}

	// MARK: кейсы

	/// Кейсы по поиску (заголовок, названия и типы целей, названия сессий), самые свежие сверху.
	public static func cases(_ cases: [CaseView], query: String, titleOf: (CaseView) -> String, sessionTitlesOf: (CaseView) -> [String]) -> [CaseView] {
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return cases
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

	// MARK: плейбуки

	/// Виды заданий, из-за которых плейбук считается «в процессе».
	static let playbookJobKinds: Set<JobKind> = [.build, .review, .improve, .judge]

	/// Плейбук, над которым идёт или ждёт задание сборки, ревью, улучшения, суждения.
	public static func isBusy(_ p: PlaybookView, jobs: [JobView]) -> Bool {
		jobs.contains { $0.subject == p.id && playbookJobKinds.contains($0.kind) && ($0.status == .queued || $0.status == .running) }
	}

	/// Готовые (active/trial) и «в процессе» (draft/review и те, над которыми идёт работа); поиск по названию и описанию, свежие сверху.
	public static func playbooks(_ list: [PlaybookView], jobs: [JobView], query: String) -> (ready: [PlaybookView], inProgress: [PlaybookView]) {
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		let shown = list
			.filter { p in q.isEmpty || p.title.lowercased().contains(q) || p.description.lowercased().contains(q) }
			.filter { $0.status != .disabled && $0.status != .archived }
			.sorted { $0.updatedAt > $1.updatedAt }
		var ready: [PlaybookView] = [], progress: [PlaybookView] = []
		for p in shown {
			if p.status == .draft || p.status == .review || isBusy(p, jobs: jobs) { progress.append(p) }
			else if p.status == .active || p.status == .trial { ready.append(p) }
		}
		return (ready, progress)
	}

	/// «v3 · 2 кейса» — подпись строки плейбука без технических id.
	public static func playbookLine(_ p: PlaybookView) -> String {
		"v\(p.version) · \(p.cases.count) \(Durations.plural(p.cases.count, "кейс", "кейса", "кейсов"))"
	}

	/// Правила по группам: включённые (по порядку), кандидаты, архив.
	public static func ruleGroups(_ p: PlaybookView) -> (active: [RuleView], candidates: [RuleView], archived: [RuleView]) {
		(p.rules.filter { $0.status == .active }, p.rules.filter { $0.status == .candidate }, p.rules.filter { $0.status == .archived })
	}

	public static func deleteCaseMessage(impact: CaseImpact?, failed: Bool) -> String {
		let base = "Описание и события кейса исчезнут."
		if failed { return base + "\nНе удалось проверить, какие правила потеряют доказательства." }
		let lines = impact?.rules.map { r -> String in
			let text = r.text.count > 90 ? String(r.text.prefix(90)) + "…" : r.text
			let tail = r.evidenceLeft == 0 ? "останется без доказательств" : "потеряет доказательство (осталось \(r.evidenceLeft))"
			return "Правило «\(text)» \(tail)"
		} ?? []
		return lines.isEmpty ? base : base + "\n" + lines.joined(separator: "\n")
	}

	/// «1 из 3 кейсов» у пробного плейбука; у остальных `nil`.
	public static func trialLine(_ p: PlaybookView) -> String? {
		guard p.status == .trial else { return nil }
		return "\(min(p.trial?.cases.count ?? 0, 3)) из 3 кейсов"
	}

	public static func deletePlaybookTitle(_ p: PlaybookView) -> String { "Удалить плейбук «\(p.title)»?" }
	public static let deletePlaybookMessage = "Claude перестанет загружать этот плейбук. Версии и правила пропадут."
	public static func approveMessage(_ p: PlaybookView) -> String {
		"Плейбук «\(p.title)» станет пробным: Claude начнёт его загружать, первые 3 кейса покажут, помогает ли он."
	}

	// MARK: тексты

	/// Пункт плана без ведущего «- » (в описании строки плана лежат как есть).
	public static func planLine(_ s: String) -> String {
		var t = s.trimmingCharacters(in: .whitespaces)
		if t.hasPrefix("- ") { t = String(t.dropFirst(2)) } else if t.hasPrefix("* ") { t = String(t.dropFirst(2)) }
		return t
	}

	/// Строчный markdown (`код`, **жирный**) в тексте кейса; не разобралось — обычный текст.
	public static func inline(_ s: String) -> AttributedString {
		let o = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
		return (try? AttributedString(markdown: s, options: o)) ?? AttributedString(s)
	}

	/// Текст без знаков markdown (обратные кавычки, `**`) — для чипов и заголовков, где разметка не рендерится.
	public static func plain(_ s: String) -> String {
		s.replacingOccurrences(of: "`", with: "").replacingOccurrences(of: "**", with: "")
	}
}
