import Foundation
import Observation

/// Что `LearningStore` берёт с сервера. `OrchClient` соответствует протоколу; в тестах подставляется заглушка.
public protocol LearningSource: Sendable {
	func learning() async throws -> LearningView
	func journal(limit: Int?, before: String?) async throws -> [JournalEntry]
}

extension LearningSource {
	/// Источники без страниц журнала (заглушки) отдают пусто.
	public func journal(limit: Int?, before: String?) async throws -> [JournalEntry] { [] }
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
	/// до 2000 записей, старые первыми
	public private(set) var journal: [JournalEntry] = []
	/// сервер умеет обучение: `false` при `learning_unavailable` или отсутствии маршрута
	public private(set) var available = true
	/// первое чтение `GET /learning` состоялось
	public private(set) var loaded = false
	/// записей последнего ответа, которые не удалось разобрать
	public private(set) var skippedRecords = 0
	public static let journalLimit = 2000
	public static let journalPage = 200

	private var loadingMore = false
	/// старее записей нет (страница пришла пустой)
	public private(set) var journalExhausted = false
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
			} catch let e as APIError where e.isUnavailable {
				available = false; loaded = true
			} catch {
				// нет связи или сбой: остаётся последнее известное состояние
			}
		} while refreshAgain
	}

	/// Страница старее самой старой записи (`before`); пустая страница — дальше нет.
	public func loadMoreJournal() async {
		guard !loadingMore, !journalExhausted, let oldest = journal.first else { return }
		loadingMore = true
		defer { loadingMore = false }
		guard let page = try? await source.journal(limit: Self.journalPage, before: oldest.id) else { return }
		let before = journal.count
		journal = JournalLogic.merge(journal, page, limit: Self.journalLimit)
		if journal.count == before { journalExhausted = true }
	}

	private func replace(with v: LearningView) {
		settings = v.settings
		jobs = v.jobs
		cases = v.cases
		playbooks = v.playbooks
		journal = JournalLogic.merge(journal, v.journal, limit: Self.journalLimit)
		skippedRecords = v.skipped
		available = true
		loaded = true
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
		case .learningCaseRemoved(let id): cases.removeAll { $0.id == id }
		case .learningSettings(let s): settings = s
		case .learningPlaybook(let p): upsert(&playbooks, p)
		case .learningPlaybookRemoved(let id): playbooks.removeAll { $0.id == id }
		case .learningJournal(let j):
			journal = JournalLogic.merge(journal, [j], limit: Self.journalLimit)
		default: return
		}
		if record && refreshing { buffered.append((e, rev)) }
	}

	private func upsert<T: Identifiable>(_ list: inout [T], _ item: T) {
		if let i = list.firstIndex(where: { $0.id == item.id }) { list[i] = item } else { list.append(item) }
	}

	// MARK: производные

	public var running: [JobView] { jobs.filter { $0.status == .running } }
	/// по порядку постановки
	public var queued: [JobView] { jobs.filter { $0.status == .queued }.sorted { $0.createdAt < $1.createdAt } }

	public func caseView(_ id: String) -> CaseView? { cases.first { $0.id == id } }
	public func playbook(_ id: String) -> PlaybookView? { playbooks.first { $0.id == id } }
}
