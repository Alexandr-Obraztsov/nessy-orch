import Foundation

/// Когда перезапускать службу оркестратора, если она перестала отвечать. Чистая функция решения: цикл опроса и запуск `launchctl` — в приложении.
public struct ServiceWatchdog: Equatable, Sendable {
	/// сколько секунд служба должна быть недоступна, прежде чем её перезапускать (короткий обрыв — не повод)
	public var offlineGrace: TimeInterval = 6
	/// минимальный промежуток между перезапусками
	public var minInterval: TimeInterval = 30
	/// после стольких неудач подряд пользователю сообщаем, что служба не поднимается (перезапуски продолжаются, но реже)
	public var reportAfter = 3

	public init() {}

	public enum Action: Equatable, Sendable {
		case none
		case restart
	}

	/// `offlineFor` — как долго служба недоступна (nil — доступна); `sinceRestart` — сколько прошло с прошлого перезапуска (nil — не было);
	/// `failures` — перезапусков подряд, после которых служба так и не поднялась.
	public func decide(offlineFor: TimeInterval?, sinceRestart: TimeInterval?, failures: Int) -> Action {
		guard let offlineFor, offlineFor >= offlineGrace else { return .none }
		// чем дольше не поднимается, тем реже пробуем: 30 с, 60 с, 120 с … до 5 минут
		let interval = min(minInterval * pow(2, Double(min(failures, 4))), 300)
		if let sinceRestart, sinceRestart < interval { return .none }
		return .restart
	}

	public func shouldReport(failures: Int) -> Bool { failures == reportAfter }
}
