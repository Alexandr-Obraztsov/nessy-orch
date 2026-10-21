import Foundation
import Observation

/// Что `LearningStore` берёт с сервера. `OrchClient` соответствует протоколу; в тестах подставляется заглушка.
public protocol LearningSource: Sendable {
	func learning() async throws -> LearningView
	func chat(_ subject: String) async throws -> [ChatMessage]
	func sendChat(_ subject: String, text: String) async throws -> ChatMessage
}

extension OrchClient: LearningSource {}

/// Состояние фонового обучения: `GET /learning` и события SSE `learning_*` (docs/api.md).
/// События применяются сразу; `snapshot` (переподключение потока) перечитывает всё, поэтому события, пришедшие во время
/// чтения, запоминаются и применяются поверх ответа: он мог быть собран раньше них.
@MainActor
@Observable
public final class LearningStore {
	public let source: any LearningSource
	public private(set) var settings: LearningSettings?
	public private(set) var jobs: [JobView] = []
	public private(set) var cases: [CaseView] = []
	public private(set) var playbooks: [PlaybookView] = []
	/// последние 200 записей, старые первыми
	public private(set) var journal: [JournalEntry] = []
	public private(set) var chats: [String: [ChatMessage]] = [:]
	/// сервер умеет обучение: `false` при `learning_unavailable` или отсутствии маршрута
	public private(set) var available = true
	/// первое чтение `GET /learning` состоялось
	public private(set) var loaded = false
	/// записей последнего ответа, которые не удалось разобрать
	public private(set) var skippedRecords = 0
	public static let journalLimit = 200

	private var refreshing = false
	private var refreshAgain = false
	private var buffered: [(event: StreamEvent, rev: Int?)] = []

	public init(source: any LearningSource) { self.source = source }

	// MARK: чтение

	/// `GET /learning`. Нет связи — состояние остаётся прежним; обучение недоступно — `available = false`.
	public func refresh() async {
		if refreshing { refreshAgain = true; return }
		refreshing = true
		defer { refreshing = false }
		repeat {
			refreshAgain = false
			buffered = []
			do {
				let v = try await source.learning()
				replace(with: v)
				// событие с `rev` не больше ответного уже учтено в нём; новее — применяется поверх
				let late = buffered
				buffered = []
				for b in late where b.rev.map({ $0 > v.rev }) ?? true { apply(b.event, rev: b.rev, record: false) }
				for key in Array(chats.keys) { await loadChat(key) }
			} catch let e as APIError where e.isUnavailable {
				available = false; loaded = true
			} catch {
				// нет связи или сбой: остаётся последнее известное состояние
			}
		} while refreshAgain
	}

	private func replace(with v: LearningView) {
		settings = v.settings
		jobs = v.jobs
		cases = v.cases
		playbooks = v.playbooks
		journal = Array(v.journal.suffix(Self.journalLimit))
		skippedRecords = v.skipped
		available = true
		loaded = true
	}

	public func loadChat(_ subject: String) async {
		guard let list = try? await source.chat(subject) else { return }
		var merged = list
		for m in chats[subject] ?? [] where !merged.contains(where: { $0.id == m.id }) { merged.append(m) }
		chats[subject] = merged
	}

	/// Отправить сообщение агенту-редактору; сообщение пользователя сразу попадает в ленту, ответ придёт событием.
	@discardableResult
	public func sendChat(_ subject: String, text: String) async throws -> ChatMessage {
		let m = try await source.sendChat(subject, text: text)
		appendChat(subject, m)
		return m
	}

	// MARK: события

	public func apply(_ e: StreamEvent, rev: Int? = nil) { apply(e, rev: rev, record: true) }

	private func apply(_ e: StreamEvent, rev: Int?, record: Bool) {
		switch e {
		case .snapshot:
			Task { await refresh() }
			return
		case .learningJob(let j): upsert(&jobs, j)
		case .learningCase(let k): upsert(&cases, k)
		case .learningCaseRemoved(let id): cases.removeAll { $0.id == id }; chats[id] = nil
		case .learningSettings(let s): settings = s
		case .learningPlaybook(let p): upsert(&playbooks, p)
		case .learningPlaybookRemoved(let id): playbooks.removeAll { $0.id == id }; chats[id] = nil
		case .learningJournal(let j):
			if let i = journal.firstIndex(where: { $0.id == j.id }) { journal[i] = j } else { journal.append(j) }
			if journal.count > Self.journalLimit { journal.removeFirst(journal.count - Self.journalLimit) }
		case .learningChat(let subject, let m): appendChat(subject, m)
		default: return
		}
		if record && refreshing { buffered.append((e, rev)) }
	}

	private func appendChat(_ subject: String, _ m: ChatMessage) {
		var list = chats[subject] ?? []
		if let i = list.firstIndex(where: { $0.id == m.id }) { list[i] = m } else { list.append(m) }
		chats[subject] = list
	}

	private func upsert<T: Identifiable>(_ list: inout [T], _ item: T) {
		if let i = list.firstIndex(where: { $0.id == item.id }) { list[i] = item } else { list.append(item) }
	}

	// MARK: производные

	public var running: [JobView] { jobs.filter { $0.status == .running } }
	/// по порядку постановки
	public var queued: [JobView] { jobs.filter { $0.status == .queued }.sorted { $0.createdAt < $1.createdAt } }
	public var failed: [JobView] { jobs.filter { $0.status == .error } }
	public func doneToday(now: Date = Date()) -> [JobView] {
		jobs.filter { $0.status == .done && ISO.parse($0.finishedAt).map { Calendar.current.isDate($0, inSameDayAs: now) } == true }
	}
	public var doneToday: [JobView] { doneToday() }

	/// Сколько решений ждут человека: плейбуки на ревью плюс все правки, ждущие решения.
	public var needsHuman: Int { playbooks.filter { $0.status == .review }.count + playbooks.reduce(0) { $0 + $1.pendingEdits.count } }
	/// Число на кнопке «Фон»: ошибки заданий и ожидание человека; штатная работа значка не даёт.
	public var badge: Int { failed.count + needsHuman }

	public func cases(of status: CaseStatus) -> [CaseView] { cases.filter { $0.status == status } }
	public func caseView(_ id: String) -> CaseView? { cases.first { $0.id == id } }
	public func playbook(_ id: String) -> PlaybookView? { playbooks.first { $0.id == id } }

	/// Кейс сессии (сессия входит в `sessions` кейса); у нескольких — самый свежий.
	public func caseOf(session: String) -> CaseView? {
		cases.filter { $0.sessions.contains(session) }.max { $0.updatedAt < $1.updatedAt }
	}

	/// Плейбук, собранный по кейсу сессии (`case.playbook` = `id@версия`).
	public func playbookOf(session: String) -> PlaybookView? {
		guard let ref = caseOf(session: session)?.playbookRef else { return nil }
		return playbook(ref.id)
	}

	/// «Пока вас не было»: кейсов закрыто, правил включено и плейбуков создано после `date`.
	public func sinceLastVisit(_ date: Date) -> (cases: Int, rulesActivated: Int, playbooks: Int) {
		let closed = cases.filter { ISO.parse($0.closedAt).map { $0 > date } == true }.count
		func count(_ k: JournalKind) -> Int { journal.filter { $0.kind == k && ISO.parse($0.ts).map { $0 > date } == true }.count }
		return (closed, count(.ruleActivated), count(.playbookCreated))
	}
}
