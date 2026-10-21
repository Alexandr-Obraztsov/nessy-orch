import Foundation

/// Логика раздела «Журнал», настроек и меню сессии окна «Фон»: без UI, чтобы проверять тестами.
public enum JournalLogic {
	/// Записи одного дня.
	public struct Day: Identifiable, Hashable, Sendable {
		public var start: Date
		public var entries: [JournalEntry]
		public var id: Date { start }
	}

	/// Группы по дням: дни — от новых к старым, записи внутри дня — тоже от новых к старым. Запись с нечитаемым временем в конце, одной группой.
	public static func days(_ entries: [JournalEntry], calendar: Calendar = .current) -> [Day] {
		var byDay: [Date: [(Date, JournalEntry)]] = [:]
		var broken: [JournalEntry] = []
		for e in entries {
			guard let d = ISO.parse(e.ts) else { broken.append(e); continue }
			byDay[calendar.startOfDay(for: d), default: []].append((d, e))
		}
		var out = byDay.keys.sorted(by: >).map { day in
			Day(start: day, entries: byDay[day]!.sorted { $0.0 > $1.0 }.map(\.1))
		}
		if !broken.isEmpty { out.append(Day(start: .distantPast, entries: broken)) }
		return out
	}

	/// «Сегодня», «Вчера», «12 октября»; `distantPast` — «Без даты».
	public static func dayTitle(_ day: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
		if day == .distantPast { return "Без даты" }
		if calendar.isDate(day, inSameDayAs: now) { return "Сегодня" }
		if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(day, inSameDayAs: y) { return "Вчера" }
		let f = DateFormatter()
		f.locale = Locale(identifier: "ru_RU")
		f.setLocalizedDateFormatFromTemplate(calendar.isDate(day, equalTo: now, toGranularity: .year) ? "d MMMM" : "d MMMM y")
		return f.string(from: day)
	}

	/// Откатить можно запись с `revertible`, которую ещё не откатили.
	public static func canRevert(_ e: JournalEntry) -> Bool { e.revertible && e.revertedBy == nil }
	public static func isReverted(_ e: JournalEntry) -> Bool { e.revertedBy != nil }

	/// Куда ведёт объект записи: плейбук (`p-…`), кейс (`c-…`) или никуда.
	public enum Target: Hashable, Sendable { case playbook(String), caseView(String) }
	public static func target(_ e: JournalEntry) -> Target? {
		if e.subject.hasPrefix("p-") { return .playbook(e.subject) }
		if e.subject.hasPrefix("c-") { return .caseView(e.subject) }
		return nil
	}

	/// Разобранный `report` записи: `{prevStatus?, review?}`.
	public struct Report: Hashable, Sendable {
		public var prevStatus: String?
		public var review: ReviewReport?
		public var isEmpty: Bool { prevStatus == nil && review == nil }
	}

	/// Отчёт записи; нет отчёта, битый JSON или пустой объект — `nil`.
	public static func report(_ e: JournalEntry) -> Report? {
		guard let text = e.report, let data = text.data(using: .utf8),
			  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
		var r = Report()
		r.prevStatus = obj["prevStatus"] as? String
		if obj["review"] is [String: Any], let sub = try? JSONSerialization.data(withJSONObject: obj["review"]!) {
			r.review = try? JSONDecoder().decode(ReviewReport.self, from: sub)
		}
		return r.isEmpty ? nil : r
	}

	/// Название ступени ревью и вердикт для списка ступеней.
	public static func verdict(_ v: StageVerdict) -> String {
		switch v {
		case .pass: "пройдена"
		case .fail: "не пройдена"
		case .skip: "пропущена"
		case .unknown: "—"
		}
	}

	// MARK: меню сессии

	/// Какие пункты меню «⋯» сессии доступны (спека §5).
	public struct SessionMenu: Equatable, Sendable {
		public var learnsHere: Bool
		/// «Собрать кейс сейчас»: обучение включено и для этой сессии
		public var canRun: Bool
		public var hasCase: Bool
		public var canRebuild: Bool
		public var canStop: Bool
		public var canDelete: Bool
		public var canOpen: Bool

		public init(settings: LearningSettings?, caseView c: CaseView?, session: String) {
			learnsHere = !(settings?.disabledSessions.contains(session) ?? false)
			canRun = (settings?.enabled ?? false) && learnsHere
			hasCase = c != nil
			canRebuild = c.map { $0.status == .ready || $0.status == .error } ?? false
			canStop = c?.status == .collecting
			canDelete = c != nil
			canOpen = c != nil
		}
	}

	/// Список `disabledSessions` после включения/выключения обучения сессии (без дублей, порядок сохраняется).
	public static func toggled(_ disabled: [String], session: String, learn: Bool) -> [String] {
		var l = disabled.filter { $0 != session }
		if !learn { l.append(session) }
		return l
	}

	/// «12 сообщений» / «340 КБ» у кандидата разбора.
	public static func size(_ c: BackfillCandidate) -> String {
		switch c.kind {
		case .session: return "\(c.size) \(Durations.plural(c.size, "сообщение", "сообщения", "сообщений"))"
		default:
			if c.size >= 1_048_576 { return String(format: "%.1f МБ", Double(c.size) / 1_048_576) }
			return "\(max(1, (c.size + 512) / 1024)) КБ"
		}
	}

	/// Итог разбора: «создано 3, пропущено 1».
	public static func backfillLine(_ r: BackfillResult) -> String {
		"создано \(r.created.count), пропущено \(r.skipped.count)"
	}
}
