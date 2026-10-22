import Foundation

/// Логика раздела «Журнал» и разбора прошлых сессий окна «Фон»: без UI, чтобы проверять тестами.
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

	/// Куда ведёт объект записи: плейбук (`p-…`), кейс (`c-…`) или никуда.
	public enum Target: Hashable, Sendable { case playbook(String), caseView(String) }
	public static func target(_ e: JournalEntry) -> Target? {
		if e.subject.hasPrefix("p-") { return .playbook(e.subject) }
		if e.subject.hasPrefix("c-") { return .caseView(e.subject) }
		return nil
	}
}
