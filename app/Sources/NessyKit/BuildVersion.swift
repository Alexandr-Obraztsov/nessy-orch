import Foundation

/// Версия сборки вида «1.0.<число коммитов>.<ггммддччмм>»: сравнивается по числам, а не по строке (10 новее 9). Служба и плагин обновляются
/// только вперёд, поэтому запуск старой копии приложения новую не затирает.
public enum BuildVersion {
	public static func parse(_ s: String) -> [Int]? {
		let parts = s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".", omittingEmptySubsequences: false)
		guard parts.count >= 2 else { return nil }
		let nums = parts.compactMap { Int($0) }
		return nums.count == parts.count ? nums : nil
	}

	/// 1 — a новее b, −1 — старее, 0 — одинаково. Непонятная версия считается самой старой.
	public static func compare(_ a: String?, _ b: String?) -> Int {
		let x = a.flatMap(parse), y = b.flatMap(parse)
		switch (x, y) {
		case (nil, nil): return 0
		case (nil, _): return -1
		case (_, nil): return 1
		case let (x?, y?):
			for i in 0..<max(x.count, y.count) {
				let d = (i < x.count ? x[i] : 0) - (i < y.count ? y[i] : 0)
				if d != 0 { return d > 0 ? 1 : -1 }
			}
			return 0
		}
	}
}
