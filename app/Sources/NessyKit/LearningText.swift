import Foundation

/// Русские названия видов заданий, статусов и событий для окна «Фон»: одни слова во всех разделах.
public enum LearningText {
	public static func kind(_ k: JobKind) -> String {
		switch k {
		case .collect: "Описание сессии"
		case .close: "Закрытие кейса"
		case .match: "Сопоставление"
		case .build: "Сборка плейбука"
		case .review: "Ревью"
		case .judge: "Судья"
		case .improve: "Улучшение"
		case .edit: "Правка из чата"
		case .unknown: "Задание"
		}
	}

	/// Шаг работы: вид задания; у ревью — «Ревью: ступень N», если номер ступени есть в пометке задания.
	public static func step(_ j: JobView) -> String {
		guard j.kind == .review, let n = stage(in: j.note) else { return kind(j.kind) }
		return "Ревью: ступень \(n)"
	}

	private static func stage(in note: String?) -> Int? {
		guard let note, let r = note.range(of: "ступен[ьи]\\s*(\\d)", options: .regularExpression) else { return nil }
		return Int(note[r].filter(\.isNumber))
	}

	public static func jobStatus(_ s: JobStatus) -> String {
		switch s {
		case .queued: "в очереди"
		case .running: "работает"
		case .done: "готово"
		case .error: "ошибка"
		case .unknown: "неизвестно"
		}
	}

	public static func caseStatus(_ s: CaseStatus) -> String {
		switch s {
		case .collecting: "собирается"
		case .closing: "закрывается"
		case .ready: "готов"
		case .error: "ошибка"
		case .unknown: "неизвестно"
		}
	}

	public static func playbookStatus(_ s: PlaybookStatus) -> String {
		switch s {
		case .draft: "черновик"
		case .review: "ждёт вас"
		case .trial: "пробный"
		case .active: "активен"
		case .disabled: "выключен"
		case .archived: "в архиве"
		case .unknown: "неизвестно"
		}
	}

	public static func journalKind(_ k: JournalKind) -> String {
		switch k {
		case .playbookCreated: "Плейбук собран"
		case .reviewPassed: "Ревью пройдено"
		case .reviewFailed: "Ревью не пройдено"
		case .published: "Опубликован"
		case .trialPassed: "Пробный режим пройден"
		case .trialFailed: "Пробный режим не пройден"
		case .ruleActivated: "Правило включено"
		case .ruleArchived: "Правило в архиве"
		case .version: "Новая версия"
		case .reverted: "Откат"
		case .edit: "Правка"
		case .unknown: "Событие"
		}
	}

	/// Кто говорит в событии кейса: подпись якоря.
	public static func rawKind(_ k: RawKind) -> String {
		switch k {
		case .user: "вы"
		case .claude: "Claude"
		case .task: "поручение"
		case .reply: "ответ агента"
		case .call: "вызов"
		case .skill: "скилл"
		case .unknown: "событие"
		}
	}

	/// Подпись под заданием в очереди: сопоставитель ждёт, пока соберутся кейсы пачки; иначе — пометка задания.
	public static func queueNote(_ j: JobView, among jobs: [JobView]) -> String? {
		if let n = j.note, !n.isEmpty { return n }
		if j.kind == .match, jobs.contains(where: { ($0.kind == .collect || $0.kind == .close) && ($0.status == .queued || $0.status == .running) }) {
			return "ждёт пачку бэкфилла"
		}
		return nil
	}

	/// «1:05», «1:02:03» — сколько работает задание.
	public static func elapsed(since start: Date?, now: Date = Date()) -> String? {
		guard let start else { return nil }
		return Durations.clock(now.timeIntervalSince(start) * 1000)
	}

	/// Якорь «n a–b» как в описании сессии.
	public static func anchor(_ r: ClosedRange<Int>) -> String { r.lowerBound == r.upperBound ? "n \(r.lowerBound)" : "n \(r.lowerBound)–\(r.upperBound)" }

	/// Якорь из строки доказательства: «n 3–7», «n 12», «(n 3–7)»; не якорь — `nil`.
	public static func parseAnchor(_ s: String) -> ClosedRange<Int>? {
		var t = s.trimmingCharacters(in: CharacterSet(charactersIn: "() ").union(.whitespaces))
		guard t.hasPrefix("n") else { return nil }
		t = String(t.dropFirst()).trimmingCharacters(in: .whitespaces)
		let nums = t.split(whereSeparator: { "–—-".contains($0) }).map { Int($0.trimmingCharacters(in: .whitespaces)) }
		guard nums.count == 1 || nums.count == 2, !nums.contains(nil) else { return nil }
		return min(nums[0]!, nums.last!!)...max(nums[0]!, nums.last!!)
	}

	/// «пока вас не было»: одна тихая строка или `nil`, если ничего не произошло.
	public static func sinceLine(_ v: (cases: Int, rulesActivated: Int, playbooks: Int)) -> String? {
		var parts: [String] = []
		if v.cases > 0 { parts.append("\(v.cases) \(Durations.plural(v.cases, "кейс закрыт", "кейса закрыто", "кейсов закрыто"))") }
		if v.rulesActivated > 0 { parts.append("\(v.rulesActivated) \(Durations.plural(v.rulesActivated, "правило включено", "правила включено", "правил включено"))") }
		if v.playbooks > 0 { parts.append("\(v.playbooks) \(Durations.plural(v.playbooks, "плейбук создан", "плейбука создано", "плейбуков создано"))") }
		return parts.isEmpty ? nil : "Пока вас не было: " + parts.joined(separator: ", ")
	}
}

/// Разделы окна «Фон» и ссылка `nessy-orch://background/<раздел>[/<id>]`.
public enum BackgroundSection: String, CaseIterable, Sendable {
	case work, cases, playbooks, journal, settings

	public var title: String {
		switch self {
		case .work: "Работа"
		case .cases: "Кейсы"
		case .playbooks: "Плейбуки"
		case .journal: "Журнал"
		case .settings: "Настройки"
		}
	}

	/// Раздел и объект из ссылки; неизвестный раздел — `nil`, пустой путь — «Работа».
	public static func parse(host: String?, path: [String]) -> (section: BackgroundSection, id: String?)? {
		guard host == "background" else { return nil }
		let parts = path.filter { $0 != "/" && !$0.isEmpty }
		guard let first = parts.first else { return (.work, nil) }
		guard let s = BackgroundSection(rawValue: first) else { return nil }
		return (s, parts.count > 1 ? parts[1] : nil)
	}

	public func link(id: String? = nil) -> URL? { URL(string: "nessy-orch://background/\(rawValue)" + (id.map { "/\($0)" } ?? "")) }
}
