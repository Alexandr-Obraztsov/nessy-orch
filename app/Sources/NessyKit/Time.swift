import Foundation

public enum ISO {
	nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return f
	}()
	nonisolated(unsafe) private static let plain = ISO8601DateFormatter()
	private static let lock = NSLock()

	public static func parse(_ s: String?) -> Date? {
		guard let s, !s.isEmpty else { return nil }
		lock.lock(); defer { lock.unlock() }
		return withFraction.date(from: s) ?? plain.date(from: s)
	}
}

public enum Durations {
	/// «1:05», «12:40», «1:02:03» — таймер хода.
	public static func clock(_ ms: Double) -> String {
		let total = Int(max(0, ms) / 1000)
		let h = total / 3600, m = (total % 3600) / 60, s = total % 60
		return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
	}

	/// «только что», «5 мин назад», «вчера» — коротко и по-русски.
	public static func ago(_ date: Date, now: Date = Date()) -> String {
		let s = Int(now.timeIntervalSince(date))
		if s < 10 { return "только что" }
		if s < 60 { return "\(s) с назад" }
		let m = s / 60
		if m < 60 { return "\(m) мин назад" }
		let h = m / 60
		if h < 24 { return "\(h) ч назад" }
		let d = h / 24
		if d == 1 { return "вчера" }
		return "\(d) \(plural(d, "день", "дня", "дней")) назад"
	}

	public static func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
		let a = abs(n) % 100, b = a % 10
		if a > 10 && a < 20 { return many }
		if b == 1 { return one }
		if b >= 2 && b <= 4 { return few }
		return many
	}
}
