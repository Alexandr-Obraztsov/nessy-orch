import Foundation

// Логика раздела «Плейбуки» без UI: группы списка, черновик правки блоками, повтор при занятом плейбуке, тексты подтверждений.

/// Группа списка плейбуков (спека §5): ждущие человека сверху, выключенные и архив — свёрнуты.
public enum PlaybookGroup: String, CaseIterable, Sendable {
	case waiting, active, trial, draft, off

	public var title: String {
		switch self {
		case .waiting: "Ждут вас"
		case .active: "Активные"
		case .trial: "Пробные"
		case .draft: "Черновики"
		case .off: "Выключенные и архив"
		}
	}

	public var collapsedByDefault: Bool { self == .off }
}

/// Вкладки карточки плейбука.
public enum PlaybookTab: String, CaseIterable, Sendable {
	case overview, cases, rules, notes, review, history

	public var title: String {
		switch self {
		case .overview: "Обзор"
		case .cases: "Кейсы"
		case .rules: "Правила"
		case .notes: "Заметки"
		case .review: "Ревью"
		case .history: "История"
		}
	}
}

public enum PlaybookEditing {
	/// сколько первых кейсов с плейбуком идёт в пробный режим (спека §8)
	public static let trialCases = 3

	/// Плейбук ждёт человека: стоит на ревью или у него есть правки улучшателя без решения.
	public static func isWaiting(_ p: PlaybookView) -> Bool { p.status == .review || !p.pendingEdits.isEmpty }

	public static func group(of p: PlaybookView) -> PlaybookGroup {
		if isWaiting(p) { return .waiting }
		switch p.status {
		case .active: return .active
		case .trial: return .trial
		case .draft: return .draft
		default: return .off
		}
	}

	/// Группы по порядку показа, пустые не возвращаются; внутри — свежие сверху.
	public static func groups(_ list: [PlaybookView]) -> [(group: PlaybookGroup, items: [PlaybookView])] {
		PlaybookGroup.allCases.compactMap { g in
			let items = list.filter { group(of: $0) == g }.sorted { $0.updatedAt > $1.updatedAt }
			return items.isEmpty ? nil : (g, items)
		}
	}

	/// «1 из 3 кейсов» у пробного плейбука; у остальных `nil`.
	public static func trialLine(_ p: PlaybookView) -> String? {
		guard p.status == .trial else { return nil }
		let n = min(p.trial?.cases.count ?? 0, trialCases)
		return "\(n) из \(trialCases) кейсов"
	}

	/// ▲▼ по правилам плейбука суммарно (без архивных).
	public static func ruleBalance(_ p: PlaybookView) -> (up: Int, down: Int) {
		p.rules.filter { $0.status != .archived }.reduce((0, 0)) { ($0.0 + $1.up, $0.1 + $1.down) }
	}

	/// Средние поправки на кейс по пробным кейсам; нет данных — `nil`.
	public static func trialAverage(_ p: PlaybookView) -> Double? {
		guard let t = p.trial, !t.corrections.isEmpty else { return nil }
		return t.corrections.reduce(0, +) / Double(t.corrections.count)
	}

	/// Замечания lint из текста ошибки сервера: по строке на замечание.
	public static func lintLines(_ message: String) -> [String] {
		message.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
	}

	/// Заметки списком строк и обратно (файл `notes.md`: заголовок и строки `- дата: …`).
	public static func noteLines(_ text: String) -> [String] {
		text.split(separator: "\n", omittingEmptySubsequences: true).map { String($0) }
	}

	public static func notesText(_ lines: [String]) -> String {
		let kept = lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
		return kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
	}

	// MARK: ревью

	/// Название ступени ревью (спека §3.6).
	public static func reviewStage(_ n: Int) -> String {
		switch n {
		case 1: "Линтер"
		case 2: "Доказательства"
		case 3: "Два вердикта"
		case 4: "Согласованность"
		case 5: "Отложенный кейс"
		case 6: "Описание"
		default: "Ступень \(n)"
		}
	}

	public static func verdict(_ v: StageVerdict) -> String {
		switch v {
		case .pass: "пройдена"
		case .fail: "не пройдена"
		case .skip: "пропущена"
		case .unknown: "нет вердикта"
		}
	}

	/// Последний отчёт ревью: самый поздний по времени.
	public static func latestReview(_ reviews: [ReviewReport]) -> ReviewReport? { reviews.max { $0.ts < $1.ts } }

	/// Правка «файл → что это»: `stages/01-plan.md` → «шаг 1», `README.md` → имя файла.
	public static func editTarget(_ file: String) -> String {
		guard file.hasPrefix("stages/"), let n = Int(file.dropFirst(7).prefix(2)) else { return file }
		return "шаг \(n)"
	}

	// MARK: подтверждения

	public static let deleteConfirm = "Claude перестанет загружать этот плейбук. Версии и правила пропадут."

	public static func deleteTitle(_ p: PlaybookView) -> String { "Удалить плейбук «\(p.title)»?" }

	public static func revertConfirm(_ version: Int) -> String { "Вернуть плейбук к версии \(version)? Появится новая версия, текущая останется в истории." }

	public static func approveConfirm(_ p: PlaybookView) -> String {
		"Плейбук «\(p.title)» станет пробным: Claude начнёт его загружать, первые \(trialCases) кейса покажут, помогает ли он."
	}

	public static func ruleRemoveNote(_ r: RuleView) -> String {
		r.status == .archived ? "" : "Правило уйдёт в архив; счётчики и доказательства сохранятся."
	}

	/// Подсказка кнопки «Включить/Выключить» по статусу; `nil` — переключать нельзя.
	public static func toggleStatus(_ p: PlaybookView) -> (title: String, to: PlaybookStatus)? {
		switch p.status {
		case .active, .trial: ("Выключить", .disabled)
		case .disabled: ("Включить", .active)
		default: nil
		}
	}

	// MARK: повтор при занятом плейбуке

	/// Выполнить правку; пока плейбук занят фоновым агентом (`playbook_busy`), повторять с паузой. Другая ошибка уходит сразу,
	/// после `attempts` занятых попыток — последняя ошибка (черновик остаётся у человека). `onWait` вызывается перед каждой паузой.
	public static func retryingWhileBusy<T: Sendable>(attempts: Int = 6, delay: Duration = .seconds(5), onWait: @Sendable (Int) -> Void = { _ in }, _ op: @Sendable () async throws -> T) async throws -> T {
		var n = 0
		while true {
			do { return try await op() }
			catch let e as APIError where e.isBusy {
				n += 1
				if n >= attempts { throw e }
				onWait(n)
				try await Task.sleep(for: delay)
			}
		}
	}
}

// MARK: - черновик правки блоками

/// Правило в черновике: `id == nil` — новое (станет кандидатом).
public struct RuleDraft: Hashable, Identifiable, Sendable {
	public var key: String
	/// id правила на сервере; `nil` у нового
	public var ruleId: String?
	public var id: String { key }
	public var text: String
	public var stage: Int?
	public var status: RuleStatus

	public init(key: String, ruleId: String? = nil, text: String, stage: Int? = nil, status: RuleStatus = .candidate) {
		self.key = key; self.ruleId = ruleId; self.text = text; self.stage = stage; self.status = status
	}
}

/// Поле плейбука, которое правится блоками (для конфликтов при `rebase`).
public enum PlaybookField: String, CaseIterable, Hashable, Sendable {
	case title, description, params, sources, files, behavior, stages

	public var label: String {
		switch self {
		case .title: "Название"
		case .description: "Описание"
		case .params: "Параметры"
		case .sources: "Источники"
		case .files: "Файлы"
		case .behavior: "Поведение"
		case .stages: "Этапы"
		}
	}
}

/// Правка плейбука блоками: изменения копятся в черновике и уходят одним `PATCH`. Этапы нумеруются по порядку, поэтому
/// перенос и удаление этапа пересчитывают этап у правил. Черновик помнит снимок `base`, с которого начата правка: в патч идёт
/// только то, что изменено относительно него, поэтому чужие правки версии, которых вы не трогали, не затираются.
public struct PlaybookDraft: Hashable, Sendable {
	/// плейбук в момент начала правки
	public private(set) var base: PlaybookView
	public var title: String
	public var description: String
	public var params: [PlaybookParam]
	public var sources: [String]
	public var files: [String]
	public var behavior: [String]
	public var stages: [PlaybookStage]
	/// живые правила (активные и кандидаты); архивные в правку не входят и остаются в архиве
	public var rules: [RuleDraft]
	private var nextKey = 0

	public init(_ p: PlaybookView) {
		base = p
		title = p.title; description = p.description; params = p.params
		sources = p.sources; files = p.files; behavior = p.behavior
		stages = p.stages.enumerated().map { i, s in var s = s; s.n = i + 1; return s }
		rules = p.rules.filter { $0.status != .archived }.map { RuleDraft(key: $0.id, ruleId: $0.id, text: $0.text, stage: $0.stage, status: $0.status) }
	}

	// MARK: списки строк (источники, файлы, поведение)

	public static func move<T>(_ a: inout [T], at i: Int, by d: Int) {
		let j = i + d
		guard a.indices.contains(i), a.indices.contains(j) else { return }
		a.swapAt(i, j)
	}

	// MARK: этапы

	public mutating func addStage(title: String) {
		stages.append(PlaybookStage(n: stages.count + 1, slug: "", title: title))
	}

	/// Переставить этап на `d` мест; номера этапов у правил переезжают вместе с ним.
	public mutating func moveStage(at i: Int, by d: Int) {
		let j = i + d
		guard stages.indices.contains(i), stages.indices.contains(j) else { return }
		stages.swapAt(i, j)
		for k in rules.indices {
			if rules[k].stage == i + 1 { rules[k].stage = j + 1 } else if rules[k].stage == j + 1 { rules[k].stage = i + 1 }
		}
		renumber()
	}

	/// Удалить этап: правила этого этапа остаются без этапа, следующие этапы сдвигаются.
	public mutating func removeStage(at i: Int) {
		guard stages.indices.contains(i) else { return }
		stages.remove(at: i)
		for k in rules.indices {
			guard let s = rules[k].stage else { continue }
			if s == i + 1 { rules[k].stage = nil } else if s > i + 1 { rules[k].stage = s - 1 }
		}
		renumber()
	}

	private mutating func renumber() { for i in stages.indices { stages[i].n = i + 1 } }

	// MARK: правила

	@discardableResult
	public mutating func addRule(text: String, stage: Int? = nil) -> RuleDraft {
		nextKey += 1
		let r = RuleDraft(key: "new-\(nextKey)", text: text, stage: stage)
		rules.append(r)
		return r
	}

	public mutating func removeRule(key: String) { rules.removeAll { $0.key == key } }

	// MARK: сравнение и сборка

	/// Очищенная копия: пустые строки и безымянные блоки отброшены, текст обрезан по краям.
	public func cleaned() -> PlaybookDraft {
		var d = self
		func lines(_ a: [String]) -> [String] { a.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty } }
		d.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
		d.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
		d.sources = lines(sources); d.files = lines(files); d.behavior = lines(behavior)
		d.params = params.compactMap { p in
			let n = p.name.trimmingCharacters(in: .whitespacesAndNewlines)
			return n.isEmpty ? nil : PlaybookParam(name: n, description: p.description.trimmingCharacters(in: .whitespacesAndNewlines), source: p.source.trimmingCharacters(in: .whitespacesAndNewlines))
		}
		d.stages = stages.filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
		d.rules = rules.compactMap { r in
			let t = r.text.trimmingCharacters(in: .whitespacesAndNewlines)
			if t.isEmpty { return nil }
			var r = r; r.text = t
			return r
		}
		return d
	}

	private static func key(_ r: RuleDraft) -> String { "\(r.text)|\(r.stage.map(String.init) ?? "-")" }

	private func value(_ f: PlaybookField) -> AnyHashable {
		switch f {
		case .title: title
		case .description: description
		case .params: params
		case .sources: sources
		case .files: files
		case .behavior: behavior
		case .stages: stages
		}
	}

	private mutating func set(_ f: PlaybookField, from o: PlaybookDraft) {
		switch f {
		case .title: title = o.title
		case .description: description = o.description
		case .params: params = o.params
		case .sources: sources = o.sources
		case .files: files = o.files
		case .behavior: behavior = o.behavior
		case .stages: stages = o.stages
		}
	}

	/// Тело `PATCH`: только поля, изменённые относительно `base`; правила — изменённые и новые, удалённые — в `removeRules`.
	/// `nil` — менять нечего.
	public func patch() -> PlaybookPatch? {
		let was = PlaybookDraft(base).cleaned()
		let now = cleaned()
		var p = PlaybookPatch(baseVersion: base.version)
		if now.title != was.title, !now.title.isEmpty { p.title = now.title }
		if now.description != was.description { p.description = now.description }
		if now.params != was.params { p.params = now.params }
		if now.sources != was.sources { p.sources = now.sources }
		if now.files != was.files { p.files = now.files }
		if now.behavior != was.behavior { p.behavior = now.behavior }
		if now.stages != was.stages { p.stages = now.stages }
		let before = Dictionary(was.rules.compactMap { r in r.ruleId.map { ($0, Self.key(r)) } }, uniquingKeysWith: { $1 })
		let changed = now.rules.filter { r in r.ruleId.map { before[$0] != Self.key(r) } ?? true }
		if !changed.isEmpty { p.rules = changed.map { RulePatch(id: $0.ruleId, text: $0.text, stage: $0.stage) } }
		let kept = Set(now.rules.compactMap(\.ruleId))
		let removed = was.rules.compactMap(\.ruleId).filter { !kept.contains($0) }
		if !removed.isEmpty { p.removeRules = removed }
		return p == PlaybookPatch(baseVersion: base.version) ? nil : p
	}

	public func isDirty() -> Bool { patch() != nil }

	/// Какие правила пропали из черновика (уйдут в архив).
	public func removedRules() -> [RuleView] {
		let kept = Set(rules.compactMap(\.ruleId))
		return base.rules.filter { $0.status != .archived && !kept.contains($0.id) }
	}

	// MARK: перенос на свежую версию

	/// Перенести свои правки на свежую версию плейбука (после 409 `stale`). Поле, изменённое только на сервере, берётся оттуда;
	/// только у вас — остаётся ваше; у обоих по-разному — остаётся ваше и попадает в конфликты. Новый `base` — `fresh`.
	public func rebase(onto fresh: PlaybookView) -> (draft: PlaybookDraft, conflicts: [String]) {
		let r = rebaseFields(onto: fresh)
		return (r.draft, r.fields.map(\.label) + r.ruleNotes)
	}

	/// То же, но конфликты полей — значениями `PlaybookField` (для выбора «оставить мои / взять новые»); конфликты правил — подписями.
	public func rebaseFields(onto fresh: PlaybookView) -> (draft: PlaybookDraft, fields: [PlaybookField], ruleNotes: [String]) {
		let was = PlaybookDraft(base).cleaned(), mine = cleaned(), theirs = PlaybookDraft(fresh).cleaned()
		var d = PlaybookDraft(fresh)
		d.nextKey = nextKey
		var fields: [PlaybookField] = []
		for f in PlaybookField.allCases {
			let iChanged = mine.value(f) != was.value(f), theyChanged = theirs.value(f) != was.value(f)
			if iChanged { d.set(f, from: self) }
			if iChanged && theyChanged && mine.value(f) != theirs.value(f) { fields.append(f) }
		}
		// правила: за основу — свежие живые правила, поверх — ваши изменения
		var notes: [String] = []
		let baseRules = Dictionary(was.rules.compactMap { r in r.ruleId.map { ($0, r) } }, uniquingKeysWith: { $1 })
		let freshRules = Dictionary(theirs.rules.compactMap { r in r.ruleId.map { ($0, r) } }, uniquingKeysWith: { $1 })
		let myIds = Set(mine.rules.compactMap(\.ruleId))
		for r in mine.rules {
			guard let id = r.ruleId else { d.rules.append(r); continue }
			guard let was = baseRules[id], Self.key(was) != Self.key(r) else { continue } // не тронуто: берётся свежее
			if let t = freshRules[id] {
				if Self.key(t) != Self.key(was), Self.key(t) != Self.key(r) { notes.append("Правило «\(Self.short(r.text))»") }
				if let i = d.rules.firstIndex(where: { $0.ruleId == id }) { d.rules[i].text = r.text; d.rules[i].stage = r.stage }
			} else {
				// правило ушло в архив на сервере: ваша правка станет новым правилом
				notes.append("Правило «\(Self.short(r.text))» убрано на сервере")
				var n = r; n.ruleId = nil; n.key = "new-\(d.nextKey + 1)"; d.nextKey += 1; n.status = .candidate
				d.rules.append(n)
			}
		}
		for (id, was) in baseRules where !myIds.contains(id) {
			// вы убрали правило; на сервере его изменили — удаление остаётся, но об этом надо сказать
			if let t = freshRules[id], Self.key(t) != Self.key(was) { notes.append("Правило «\(Self.short(t.text))» вы убрали, а на сервере изменили") }
			d.rules.removeAll { $0.ruleId == id }
		}
		return (d, fields, notes)
	}

	/// Взять поле из свежей версии вместо своего (выбор «взять новые» при конфликте).
	public mutating func take(_ f: PlaybookField, from fresh: PlaybookView) {
		set(f, from: PlaybookDraft(fresh))
	}

	private static func short(_ t: String) -> String { t.count > 40 ? String(t.prefix(40)) + "…" : t }
}
