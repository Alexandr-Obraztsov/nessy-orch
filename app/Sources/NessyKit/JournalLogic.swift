import Foundation

/// Логика раздела «Журнал» и разбора прошлых сессий окна «Фон»: без UI, чтобы проверять тестами.
public enum JournalLogic {
	/// Фраза без служебного префикса вида `p-aff-package: ` / `c-…: ` (id объекта человеку не нужен: рядом название).
	public static func plain(_ summary: String) -> String {
		summary.replacingOccurrences(of: #"^[pc]-[\w.-]+:\s*"#, with: "", options: .regularExpression)
	}

	/// Записи одного дня.
	public struct Day: Identifiable, Hashable, Sendable {
		public var start: Date
		public var entries: [JournalEntry]
		public var id: Date { start }
	}

	/// Фильтр ленты по важности.
	public enum LevelFilter: Hashable, Sendable { case all, warnings, errors }

	/// Слияние без дублей по id (позднее значение заменяет), старые первыми, не больше `limit` свежих.
	/// Порядок по времени; запись с нечитаемым временем идёт первой, равные времена сохраняют прежний порядок.
	public static func merge(_ base: [JournalEntry], _ extra: [JournalEntry], limit: Int) -> [JournalEntry] {
		var order: [String] = []
		var byId: [String: JournalEntry] = [:]
		for e in base + extra {
			if byId.updateValue(e, forKey: e.id) == nil { order.append(e.id) }
		}
		let keyed = order.enumerated().map { (i, id) -> (Date, Int, JournalEntry) in
			let e = byId[id]!
			return (ISO.parse(e.ts) ?? .distantPast, i, e)
		}
		let sorted = keyed.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }.map(\.2)
		return sorted.count > limit ? Array(sorted.suffix(limit)) : sorted
	}

	/// Записи, прошедшие фильтр важности и поиск по тексту (фраза и вид события, без учёта регистра).
	public static func filter(_ entries: [JournalEntry], level: LevelFilter, query: String) -> [JournalEntry] {
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return entries.filter { e in
			switch level {
			case .all: break
			case .warnings: if e.level != .warn { return false }
			case .errors: if e.level != .error { return false }
			}
			if q.isEmpty { return true }
			return e.summary.lowercased().contains(q) || (e.kind != .log && LearningText.journalKind(e.kind).lowercased().contains(q))
		}
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
