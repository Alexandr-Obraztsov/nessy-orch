import Foundation

// Зеркало shared/types/learning.ts. Декодирование устойчивое: новые и необязательные поля — со значениями по умолчанию,
// неизвестные значения перечислений — `unknown`, а не ошибка. Даты — строки ISO, как в остальных моделях (`ISO.parse`).

extension KeyedDecodingContainer {
	/// Поле или значение по умолчанию: нет поля, null и неверный тип не роняют разбор записи.
	func get<T: Decodable>(_ key: Key, _ fallback: T) -> T { (try? decodeIfPresent(T.self, forKey: key)) ?? fallback }
	func getOpt<T: Decodable>(_ key: Key) -> T? { (try? decodeIfPresent(T.self, forKey: key)) ?? nil }
}

// MARK: перечисления

public enum CaseStatus: String, Codable, Sendable {
	case collecting, closing, ready, error, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum CaseSource: String, Codable, Sendable {
	case live, backfill, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum JobKind: String, Codable, Sendable {
	case collect, close, match, build, review, judge, improve, edit, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum JobStatus: String, Codable, Sendable {
	case queued, running, done, error, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum PlaybookStatus: String, Codable, Sendable {
	case draft, review, trial, active, disabled, archived, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum RuleStatus: String, Codable, Sendable {
	case candidate, active, archived, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum StageVerdict: String, Codable, Sendable {
	case pass, fail, skip, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum JournalKind: String, Codable, Sendable {
	case playbookCreated = "playbook_created"
	case reviewPassed = "review_passed"
	case reviewFailed = "review_failed"
	case published
	case trialPassed = "trial_passed"
	case trialFailed = "trial_failed"
	case ruleActivated = "rule_activated"
	case ruleArchived = "rule_archived"
	case version, reverted, edit, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum ChatAuthor: String, Codable, Sendable {
	case user, agent
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .agent
	}
}

public enum RawKind: String, Codable, Sendable {
	case user, claude, task, reply, call, skill, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

public enum BackfillKind: String, Codable, Sendable {
	case session, transcript, unknown
	public init(from decoder: Decoder) throws {
		self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
	}
}

// MARK: настройки, кейсы, задания

public struct LearningSettings: Codable, Hashable, Sendable {
	public var enabled: Bool
	public var autoReview: Bool
	/// как часто сборщик дописывает описание сессии, мин
	public var intervalMin: Int
	/// сколько простоя закрывает кейс, мин
	public var idleMin: Int
	/// сколько фоновых агентов работает одновременно
	public var maxAgents: Int
	/// сессии, для которых обучение выключено
	public var disabledSessions: [String]

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		enabled = c.get(.enabled, false)
		autoReview = c.get(.autoReview, true)
		intervalMin = c.get(.intervalMin, 10)
		idleMin = c.get(.idleMin, 60)
		maxAgents = c.get(.maxAgents, 2)
		disabledSessions = c.get(.disabledSessions, [])
	}
}

public struct CaseGoal: Codable, Hashable, Sendable {
	public var title: String
	public var type: String

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		title = c.get(.title, "")
		type = c.get(.type, "")
	}
}

public struct CaseView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var title: String?
	public var sessions: [String]
	public var status: CaseStatus
	public var goals: [CaseGoal]
	public var events: Int
	/// номер последнего события, учтённого в summary.md
	public var coveredUntil: Int
	public var createdAt: String
	public var updatedAt: String
	public var closedAt: String?
	/// `id@версия` плейбука, собранного по кейсу
	public var playbook: String?
	public var source: CaseSource

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		title = c.getOpt(.title)
		sessions = c.get(.sessions, [])
		status = c.get(.status, .unknown)
		goals = (try? c.decodeIfPresent(LossyArray<CaseGoal>.self, forKey: .goals))?.items ?? []
		events = c.get(.events, 0)
		coveredUntil = c.get(.coveredUntil, 0)
		createdAt = c.get(.createdAt, "")
		updatedAt = c.get(.updatedAt, "")
		closedAt = c.getOpt(.closedAt)
		playbook = c.getOpt(.playbook)
		source = c.get(.source, .live)
	}

	/// Плейбук кейса: id без версии и номер версии из `id@версия`.
	public var playbookRef: (id: String, version: Int?)? {
		guard let p = playbook, !p.isEmpty else { return nil }
		guard let at = p.lastIndex(of: "@") else { return (p, nil) }
		return (String(p[..<at]), Int(p[p.index(after: at)...]))
	}
}

/// Кейс с описанием сессии и заметками (`GET /learning/cases/:id`).
public struct CaseDetail: Codable, Hashable, Identifiable, Sendable {
	public var view: CaseView
	public var summary: String
	public var notes: String
	public var id: String { view.id }

	private enum CodingKeys: String, CodingKey { case summary, notes }

	public init(from decoder: Decoder) throws {
		view = try CaseView(from: decoder)
		let c = try decoder.container(keyedBy: CodingKeys.self)
		summary = c.get(.summary, "")
		notes = c.get(.notes, "")
	}

	public func encode(to encoder: Encoder) throws {
		try view.encode(to: encoder)
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encode(summary, forKey: .summary)
		try c.encode(notes, forKey: .notes)
	}
}

public struct JobView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var kind: JobKind
	/// кейс задания (пусто, если задание не над кейсом)
	public var caseId: String
	/// объект задания: кейс, плейбук `p-…`, группа `g-…`, `all` у сопоставителя
	public var subject: String
	public var status: JobStatus
	public var attempts: Int
	public var agentId: String?
	public var error: String?
	public var note: String?
	/// диапазон событий `n` порции
	public var range: [Int]?
	public var createdAt: String
	public var startedAt: String?
	public var finishedAt: String?

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		kind = c.get(.kind, .unknown)
		caseId = c.get(.caseId, "")
		subject = c.get(.subject, "")
		status = c.get(.status, .unknown)
		attempts = c.get(.attempts, 0)
		agentId = c.getOpt(.agentId)
		error = c.getOpt(.error)
		note = c.getOpt(.note)
		range = c.getOpt(.range)
		createdAt = c.get(.createdAt, "")
		startedAt = c.getOpt(.startedAt)
		finishedAt = c.getOpt(.finishedAt)
	}
}

/// Задание с ответами агентов (`GET /learning/jobs/:id`).
public struct JobDetail: Codable, Hashable, Identifiable, Sendable {
	public struct Run: Codable, Hashable, Identifiable, Sendable {
		public var name: String
		public var text: String
		public var id: String { name }

		public init(from decoder: Decoder) throws {
			let c = try decoder.container(keyedBy: CodingKeys.self)
			name = c.get(.name, "")
			text = c.get(.text, "")
		}
	}

	public var job: JobView
	public var runs: [Run]
	public var id: String { job.id }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		job = try c.decode(JobView.self, forKey: .job)
		runs = (try? c.decodeIfPresent(LossyArray<Run>.self, forKey: .runs))?.items ?? []
	}
}

/// Событие кейса из `raw/events.jsonl` (`GET /learning/cases/:id/raw`), по нему якорь `n a–b` открывает место в сессии.
public struct RawEvent: Codable, Hashable, Identifiable, Sendable {
	public var n: Int
	/// миллисекунды Unix
	public var ts: Double
	public var kind: RawKind
	public var from: String
	public var to: String?
	public var text: String
	/// откуда взято: id сообщения ленты или uuid записи транскрипта
	public var ref: String
	public var id: Int { n }
	public var date: Date { Date(timeIntervalSince1970: ts / 1000) }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		n = try c.decode(Int.self, forKey: .n)
		ts = c.get(.ts, 0)
		kind = c.get(.kind, .unknown)
		from = c.get(.from, "")
		to = c.getOpt(.to)
		text = c.get(.text, "")
		ref = c.get(.ref, "")
	}
}

/// Что потеряет доказательство при удалении кейса (`GET /learning/cases/:id/impact`).
public struct CaseImpact: Codable, Hashable, Sendable {
	public struct Rule: Codable, Hashable, Identifiable, Sendable {
		public var playbookId: String
		public var ruleId: String
		public var text: String
		public var evidenceLeft: Int
		public var id: String { playbookId + "/" + ruleId }

		public init(from decoder: Decoder) throws {
			let c = try decoder.container(keyedBy: CodingKeys.self)
			playbookId = c.get(.playbookId, "")
			ruleId = c.get(.ruleId, "")
			text = c.get(.text, "")
			evidenceLeft = c.get(.evidenceLeft, 0)
		}
	}

	public var rules: [Rule]

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		rules = (try? c.decodeIfPresent(LossyArray<Rule>.self, forKey: .rules))?.items ?? []
	}
}

/// Прошлая сессия или транскрипт, который можно разобрать задним числом.
public struct BackfillCandidate: Codable, Hashable, Identifiable, Sendable {
	public var kind: BackfillKind
	public var id: String
	public var title: String
	public var date: String
	/// сообщений у сессии, байт у транскрипта
	public var size: Int

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		kind = c.get(.kind, .unknown)
		id = try c.decode(String.self, forKey: .id)
		title = c.get(.title, "")
		date = c.get(.date, "")
		size = c.get(.size, 0)
	}
}

public struct BackfillResult: Codable, Hashable, Sendable {
	public struct Skipped: Codable, Hashable, Identifiable, Sendable {
		public var id: String
		public var reason: String

		public init(from decoder: Decoder) throws {
			let c = try decoder.container(keyedBy: CodingKeys.self)
			id = c.get(.id, "")
			reason = c.get(.reason, "")
		}
	}

	public var created: [CaseView]
	public var skipped: [Skipped]

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		created = (try? c.decodeIfPresent(LossyArray<CaseView>.self, forKey: .created))?.items ?? []
		skipped = (try? c.decodeIfPresent(LossyArray<Skipped>.self, forKey: .skipped))?.items ?? []
	}
}

// MARK: плейбуки

/// Доказательство правила: кейс и якорь вида `n 12–15`.
public struct Evidence: Codable, Hashable, Identifiable, Sendable {
	public var caseId: String
	public var anchor: String
	public var id: String { caseId + "#" + anchor }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		caseId = c.get(.caseId, "")
		anchor = c.get(.anchor, "")
	}
}

public struct RuleView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var text: String
	public var stage: Int?
	public var status: RuleStatus
	public var up: Int
	public var down: Int
	public var evidence: [Evidence]
	public var against: [Evidence]
	public var lastAppliedAt: String?
	public var createdAt: String

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		text = c.get(.text, "")
		stage = c.getOpt(.stage)
		status = c.get(.status, .unknown)
		up = c.get(.up, 0)
		down = c.get(.down, 0)
		evidence = (try? c.decodeIfPresent(LossyArray<Evidence>.self, forKey: .evidence))?.items ?? []
		against = (try? c.decodeIfPresent(LossyArray<Evidence>.self, forKey: .against))?.items ?? []
		lastAppliedAt = c.getOpt(.lastAppliedAt)
		createdAt = c.get(.createdAt, "")
	}
}

public struct PlaybookParam: Codable, Hashable, Identifiable, Sendable {
	public var name: String
	public var description: String
	public var source: String
	public var id: String { name }

	public init(name: String, description: String = "", source: String = "") {
		self.name = name; self.description = description; self.source = source
	}

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		name = c.get(.name, "")
		description = c.get(.description, "")
		source = c.get(.source, "")
	}
}

public struct PlaybookStage: Codable, Hashable, Identifiable, Sendable {
	public var n: Int
	public var slug: String
	public var title: String
	public var role: String?
	public var `where`: String
	public var produce: String
	public var done: String
	public var gate: Bool
	public var template: String
	public var id: Int { n }

	public init(n: Int, slug: String, title: String, role: String? = nil, where: String = "", produce: String = "", done: String = "", gate: Bool = false, template: String = "") {
		self.n = n; self.slug = slug; self.title = title; self.role = role; self.where = `where`
		self.produce = produce; self.done = done; self.gate = gate; self.template = template
	}

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		n = c.get(.n, 0)
		slug = c.get(.slug, "")
		title = c.get(.title, "")
		role = c.getOpt(.role)
		`where` = c.get(.where, "")
		produce = c.get(.produce, "")
		done = c.get(.done, "")
		gate = c.get(.gate, false)
		template = c.get(.template, "")
	}
}

/// Правка улучшателя, ожидающая решения человека (`autoReview: false`).
public struct PendingEdit: Codable, Hashable, Identifiable, Sendable {
	public var hash: String
	public var file: String
	public var before: String
	public var after: String
	public var anchor: String
	public var caseId: String
	public var createdAt: String
	public var id: String { hash }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		hash = try c.decode(String.self, forKey: .hash)
		file = c.get(.file, "")
		before = c.get(.before, "")
		after = c.get(.after, "")
		anchor = c.get(.anchor, "")
		caseId = c.get(.caseId, "")
		createdAt = c.get(.createdAt, "")
	}
}

/// Пробный режим: поправок на кейс до плейбука и по пробным кейсам.
public struct PlaybookTrial: Codable, Hashable, Sendable {
	public var before: Double
	public var cases: [String]
	public var corrections: [Double]

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		before = c.get(.before, 0)
		cases = c.get(.cases, [])
		corrections = c.get(.corrections, [])
	}
}

public struct PlaybookView: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var name: String
	public var title: String
	public var description: String
	public var taskType: String
	public var status: PlaybookStatus
	public var version: Int
	public var cases: [String]
	public var heldOut: String?
	public var params: [PlaybookParam]
	public var sources: [String]
	public var files: [String]
	public var behavior: [String]
	public var stages: [PlaybookStage]
	public var rules: [RuleView]
	public var trial: PlaybookTrial?
	/// правки, ждущие решения; у плейбуков старого формата поля нет — `[]`
	public var pendingEdits: [PendingEdit]
	public var createdAt: String
	public var updatedAt: String

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		name = c.get(.name, "")
		title = c.get(.title, "")
		description = c.get(.description, "")
		taskType = c.get(.taskType, "")
		status = c.get(.status, .unknown)
		version = c.get(.version, 0)
		cases = c.get(.cases, [])
		heldOut = c.getOpt(.heldOut)
		params = (try? c.decodeIfPresent(LossyArray<PlaybookParam>.self, forKey: .params))?.items ?? []
		sources = c.get(.sources, [])
		files = c.get(.files, [])
		behavior = c.get(.behavior, [])
		stages = (try? c.decodeIfPresent(LossyArray<PlaybookStage>.self, forKey: .stages))?.items ?? []
		rules = (try? c.decodeIfPresent(LossyArray<RuleView>.self, forKey: .rules))?.items ?? []
		trial = c.getOpt(.trial)
		pendingEdits = (try? c.decodeIfPresent(LossyArray<PendingEdit>.self, forKey: .pendingEdits))?.items ?? []
		createdAt = c.get(.createdAt, "")
		updatedAt = c.get(.updatedAt, "")
	}
}

public struct StageReport: Codable, Hashable, Identifiable, Sendable {
	public var stage: Int
	public var verdict: StageVerdict
	public var critical: [String]
	public var notes: [String]
	public var agentIds: [String]
	public var id: Int { stage }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		stage = c.get(.stage, 0)
		verdict = c.get(.verdict, .unknown)
		critical = c.get(.critical, [])
		notes = c.get(.notes, [])
		agentIds = c.get(.agentIds, [])
	}
}

public struct ReviewReport: Codable, Hashable, Identifiable, Sendable {
	public var playbookId: String
	public var version: Int
	public var ts: String
	public var passed: Bool
	public var stages: [StageReport]
	public var id: String { "\(playbookId)@\(version)@\(ts)" }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		playbookId = c.get(.playbookId, "")
		version = c.get(.version, 0)
		ts = c.get(.ts, "")
		passed = c.get(.passed, false)
		stages = (try? c.decodeIfPresent(LossyArray<StageReport>.self, forKey: .stages))?.items ?? []
	}
}

/// Плейбук с файлами-заметками и историей (`GET /learning/playbooks/:id`).
public struct PlaybookDetail: Codable, Hashable, Identifiable, Sendable {
	public struct Version: Codable, Hashable, Identifiable, Sendable {
		public var version: Int
		public var ts: String
		public var message: String
		public var id: Int { version }

		public init(from decoder: Decoder) throws {
			let c = try decoder.container(keyedBy: CodingKeys.self)
			version = c.get(.version, 0)
			ts = c.get(.ts, "")
			message = c.get(.message, "")
		}
	}

	public var view: PlaybookView
	public var notes: String
	public var changelog: String
	public var versions: [Version]
	public var reviews: [ReviewReport]
	public var id: String { view.id }

	private enum CodingKeys: String, CodingKey { case notes, changelog, versions, reviews }

	public init(from decoder: Decoder) throws {
		view = try PlaybookView(from: decoder)
		let c = try decoder.container(keyedBy: CodingKeys.self)
		notes = c.get(.notes, "")
		changelog = c.get(.changelog, "")
		versions = (try? c.decodeIfPresent(LossyArray<Version>.self, forKey: .versions))?.items ?? []
		reviews = (try? c.decodeIfPresent(LossyArray<ReviewReport>.self, forKey: .reviews))?.items ?? []
	}

	public func encode(to encoder: Encoder) throws {
		try view.encode(to: encoder)
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encode(notes, forKey: .notes)
		try c.encode(changelog, forKey: .changelog)
		try c.encode(versions, forKey: .versions)
		try c.encode(reviews, forKey: .reviews)
	}
}

/// Правило в теле `PATCH /learning/playbooks/:id`: без `id` — новое (кандидат); отсутствующие в массиве id уходят в архив.
public struct RulePatch: Codable, Hashable, Sendable {
	public var id: String?
	public var text: String
	public var stage: Int?

	public init(id: String? = nil, text: String, stage: Int? = nil) {
		self.id = id; self.text = text; self.stage = stage
	}

	public func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encodeIfPresent(id, forKey: .id)
		try c.encode(text, forKey: .text) // этап `null` передаётся явно: правило без этапа
		if let stage { try c.encode(stage, forKey: .stage) } else { try c.encodeNil(forKey: .stage) }
	}
}

/// Тело `PATCH /learning/playbooks/:id`: заменяет только переданные поля.
public struct PlaybookPatch: Encodable, Hashable, Sendable {
	public var title: String?
	public var description: String?
	public var params: [PlaybookParam]?
	public var sources: [String]?
	public var files: [String]?
	public var behavior: [String]?
	public var stages: [PlaybookStage]?
	public var rules: [RulePatch]?

	public init(title: String? = nil, description: String? = nil, params: [PlaybookParam]? = nil, sources: [String]? = nil, files: [String]? = nil, behavior: [String]? = nil, stages: [PlaybookStage]? = nil, rules: [RulePatch]? = nil) {
		self.title = title; self.description = description; self.params = params; self.sources = sources
		self.files = files; self.behavior = behavior; self.stages = stages; self.rules = rules
	}
}

// MARK: журнал и чат

public struct JournalEntry: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var ts: String
	public var kind: JournalKind
	public var subject: String
	public var summary: String
	/// отчёт решения (JSON ревью и т. п.)
	public var report: String?
	public var revertible: Bool
	public var revertedBy: String?

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		ts = c.get(.ts, "")
		kind = c.get(.kind, .unknown)
		subject = c.get(.subject, "")
		summary = c.get(.summary, "")
		report = c.getOpt(.report)
		revertible = c.get(.revertible, false)
		revertedBy = c.getOpt(.revertedBy)
	}
}

public struct ChatMessage: Codable, Hashable, Identifiable, Sendable {
	public var id: String
	public var ts: String
	public var from: ChatAuthor
	public var text: String
	/// что агент-редактор изменил этим ответом («изменено: …»)
	public var changes: [String]

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		ts = c.get(.ts, "")
		from = c.get(.from, .agent)
		text = c.get(.text, "")
		changes = c.get(.changes, [])
	}
}

// MARK: общий вид

/// `GET /learning`: всё состояние обучения одним ответом. Записи декодируются по одной; битые считаются в `skipped`.
public struct LearningView: Decodable, Sendable {
	public var settings: LearningSettings
	public var jobs: [JobView]
	public var cases: [CaseView]
	public var playbooks: [PlaybookView]
	public var journal: [JournalEntry]
	public var skipped = 0

	private enum CodingKeys: String, CodingKey { case settings, jobs, cases, playbooks, journal }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		settings = try c.decode(LearningSettings.self, forKey: .settings)
		let j = try? c.decodeIfPresent(LossyArray<JobView>.self, forKey: .jobs)
		let k = try? c.decodeIfPresent(LossyArray<CaseView>.self, forKey: .cases)
		let p = try? c.decodeIfPresent(LossyArray<PlaybookView>.self, forKey: .playbooks)
		let e = try? c.decodeIfPresent(LossyArray<JournalEntry>.self, forKey: .journal)
		jobs = j?.items ?? []; cases = k?.items ?? []; playbooks = p?.items ?? []; journal = e?.items ?? []
		skipped = (j?.skipped ?? 0) + (k?.skipped ?? 0) + (p?.skipped ?? 0) + (e?.skipped ?? 0)
	}

	public init(settings: LearningSettings, jobs: [JobView] = [], cases: [CaseView] = [], playbooks: [PlaybookView] = [], journal: [JournalEntry] = []) {
		self.settings = settings; self.jobs = jobs; self.cases = cases; self.playbooks = playbooks; self.journal = journal
	}
}
