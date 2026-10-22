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
		case .log: "Событие"
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

}

/// Разделы окна «Фон» и ссылка `nessy-orch://background/<раздел>[/<id>]`.
public enum BackgroundSection: String, CaseIterable, Sendable {
	case work, cases, playbooks, journal

	public var title: String {
		switch self {
		case .work: "В процессе"
		case .cases: "Кейсы"
		case .playbooks: "Плейбуки"
		case .journal: "Журнал"
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
