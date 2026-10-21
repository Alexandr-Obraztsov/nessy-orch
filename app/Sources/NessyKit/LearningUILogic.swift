import Foundation
import Observation

// Логика окна «Фон» без UI: токен запроса, очередь настроек, кэш отчётов журнала, черновики кейсов, сохранение плейбука.

// MARK: - токен запроса

/// Ответы `load()` приходят не по порядку: применять можно только ответ самого свежего запроса.
public struct RequestToken: Sendable {
	private var n = 0
	public init() {}
	/// Новый запрос: все прежние становятся устаревшими.
	public mutating func next() -> Int { n += 1; return n }
	public func isCurrent(_ t: Int) -> Bool { t == n }
}

// MARK: - очередь PATCH настроек

/// Правки настроек копятся и уходят одним `PATCH` через `debounce` после последней; запросы идут по одному,
/// поэтому побеждает последнее значение. Пока что-то не ушло, `isBusy`.
@MainActor
public final class SettingsPatchQueue {
	public var debounce: Duration
	public var send: ([String: JSONValue]) async throws -> Void = { _ in }
	public var onError: (Error) -> Void = { _ in }
	/// очередь опустела (всё отправлено)
	public var onIdle: () async -> Void = {}
	private var pending: [String: JSONValue] = [:]
	private var timer: Task<Void, Never>?
	private var draining = false

	public init(debounce: Duration = .milliseconds(400)) { self.debounce = debounce }

	public var isBusy: Bool { !pending.isEmpty || draining || timer != nil }

	public func set(_ changes: [String: JSONValue]) {
		for (k, v) in changes { pending[k] = v }
		timer?.cancel()
		let d = debounce
		timer = Task { [weak self] in
			try? await Task.sleep(for: d)
			guard !Task.isCancelled else { return }
			await self?.drain()
		}
	}

	/// Отправить накопленное сразу (закрытие вкладки).
	public func flush() async {
		timer?.cancel()
		await drain()
	}

	private func drain() async {
		timer = nil
		guard !draining else { return }
		draining = true
		while !pending.isEmpty {
			let batch = pending
			pending = [:]
			do { try await send(batch) } catch { onError(error) }
		}
		draining = false
		if timer == nil { await onIdle() }
	}
}

// MARK: - кэш отчётов журнала

/// Разбор `report` записи журнала — один раз на запись.
@MainActor
public final class JournalReportCache {
	private var cache: [String: JournalLogic.Report?] = [:]
	public private(set) var parses = 0
	public init() {}

	public func report(_ e: JournalEntry) -> JournalLogic.Report? {
		if let hit = cache[e.id] { return hit }
		parses += 1
		let r = JournalLogic.report(e)
		cache[e.id] = .some(r)
		return r
	}
}

extension LearningText {
	/// Статус до изменения (`prevStatus` отчёта): статус плейбука или правила по-русски.
	public static func prevStatus(_ raw: String) -> String {
		switch raw {
		case "candidate": return "кандидат"
		case "archived": return "в архиве"
		default:
			let s = PlaybookStatus(rawValue: raw) ?? .unknown
			return s == .unknown ? raw : playbookStatus(s)
		}
	}

	/// Сколько событий отдаёт сервер за один запрос.
	public static let rawLimit = 500

	/// «показаны первые 500» — когда список упёрся в предел сервера.
	public static func rawLimitNote(count: Int) -> String? {
		count >= rawLimit ? "Показаны первые \(rawLimit) событий" : nil
	}
}

// MARK: - длинный текст

public enum LongTextMeasure {
	/// Длинный ли текст: стоимость ограничена `preview`, как бы велик ни был текст (сотни КБ не считаются целиком).
	public static func isLong(_ text: String, preview: Int, lines: Int) -> Bool {
		if text.utf8.count > preview * 4 { return true }
		if text.count > preview { return true }
		return text.split(separator: "\n", omittingEmptySubsequences: false).count > lines
	}
}

// MARK: - удаление кейса

public enum CaseDeleteText {
	public static let impactFailed = "Не удалось проверить, какие правила потеряют доказательства."

	/// Текст диалога удаления: `impact == nil` и `failed` — проверка не удалась, удалить всё равно можно.
	public static func message(impact: CaseImpact?, failed: Bool) -> String {
		let base = "Описание, заметки и события кейса исчезнут."
		if failed { return base + "\n" + impactFailed }
		let lines = impact.map(CaseEditing.impactLines) ?? []
		return lines.isEmpty ? base : base + "\n" + lines.joined(separator: "\n")
	}
}

// MARK: - черновики кейса

/// Несохранённые правки кейса: живут в `BackgroundNav` по id кейса, переживают смену объекта и раздела.
@MainActor
@Observable
public final class CaseDraftState {
	/// описание блоками
	public var summary: CaseSummary?
	/// описание текстом (markdown целиком)
	public var text: String?
	public var notes: [String]?
	/// текст описания на сервере, когда он изменился под вашим черновиком (409 `stale`)
	public var staleServerText: String?
	public init() {}

	public var editingSummary: Bool { summary != nil || text != nil }
	public var hasDrafts: Bool { editingSummary || notes != nil }

	/// Текст для «Скопировать текст» у удалённого кейса.
	public func copyText() -> String {
		var parts: [String] = []
		if let s = summary { parts.append(CaseEditing.markdown(s)) } else if let t = text { parts.append(t) }
		if let n = notes { parts.append(CaseEditing.text(fromNotes: n)) }
		return parts.joined(separator: "\n\n")
	}

	public func clear() { summary = nil; text = nil; notes = nil; staleServerText = nil }
}

public enum LeaveGuard {
	/// Уход с объекта с несохранёнными правками спрашивает подтверждение; переход на тот же объект — нет.
	public static func needsConfirm(from: String?, to: String?, unsaved: Bool) -> Bool {
		unsaved && from != nil && from != to
	}
}

// MARK: - текст черновика плейбука

extension PlaybookDraft {
	/// Черновик простым текстом — «Скопировать текст» у удалённого плейбука.
	public func plainText() -> String {
		var out: [String] = ["# \(title)", description]
		func list(_ t: String, _ a: [String]) { if !a.isEmpty { out.append("\n\(t):\n" + a.map { "- \($0)" }.joined(separator: "\n")) } }
		if !params.isEmpty { out.append("\nПараметры:\n" + params.map { "- \($0.name): \($0.description) (\($0.source))" }.joined(separator: "\n")) }
		list("Источники", sources); list("Файлы", files); list("Поведение", behavior)
		if !stages.isEmpty { out.append("\nЭтапы:\n" + stages.map { "\($0.n). \($0.title)" }.joined(separator: "\n")) }
		if !rules.isEmpty { out.append("\nПравила:\n" + rules.map { "- \($0.text)" }.joined(separator: "\n")) }
		return out.joined(separator: "\n")
	}
}

// MARK: - сохранение плейбука

public struct PlaybookRebase: Sendable {
	public var draft: PlaybookDraft
	/// поля, изменённые и у вас, и на сервере (в черновике пока ваши значения)
	public var fields: [PlaybookField]
	public var ruleNotes: [String]
	public var fresh: PlaybookView
}

public enum PlaybookSaveOutcome: Sendable {
	case saved
	case unchanged
	case lint([String])
	/// плейбук всё ещё занят после всех повторов
	case busy
	/// на сервере другая версия: правки перенесены, нужно подтверждение (и выбор по конфликтам)
	case rebased(PlaybookRebase)
	case failed(String)
}

public enum PlaybookSaving {
	/// Отправить патч черновика. 409 `stale` — перечитать и перенести правки (`rebase`); `playbook_busy` — повторы с паузой,
	/// перед каждым повтором сверка с версией на сервере: если она сменилась, правки переносятся, а не затирают её.
	public static func save(_ draft: PlaybookDraft,
	                        send: @Sendable (PlaybookPatch) async throws -> Void,
	                        fetch: @Sendable () async throws -> PlaybookView,
	                        onWait: @Sendable (Int) -> Void = { _ in },
	                        attempts: Int = 6, delay: Duration = .seconds(5)) async -> PlaybookSaveOutcome {
		guard let patch = draft.patch() else { return .unchanged }
		func rebased() async -> PlaybookSaveOutcome {
			do {
				let fresh = try await fetch()
				let r = draft.rebaseFields(onto: fresh)
				return .rebased(PlaybookRebase(draft: r.draft, fields: r.fields, ruleNotes: r.ruleNotes, fresh: fresh))
			} catch { return .failed(error.localizedDescription) }
		}
		var n = 0
		while true {
			do { try await send(patch); return .saved }
			catch let e as APIError where e.isStale { return await rebased() }
			catch let e as APIError where e.isLint { return .lint(PlaybookEditing.lintLines(e.message)) }
			catch let e as APIError where e.isBusy {
				n += 1
				if n >= attempts { return .busy }
				onWait(n)
				do { try await Task.sleep(for: delay) } catch { return .failed(error.localizedDescription) }
				if let fresh = try? await fetch(), fresh.version != draft.base.version { return await rebased() }
			}
			catch { return .failed(error.localizedDescription) }
		}
	}
}
