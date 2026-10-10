import AppKit
import Foundation
import UserNotifications
import NessyKit

enum NotificationAction {
	case open(agentId: String?, sessionId: String?)
}

/// Системные уведомления (screens.md §3g): запрос прав, ошибка и блокировка — «Открыть», сессия завершена — без звука.
/// Готовый результат не уведомляет. Работает только из .app (у голого бинарника нет bundle id).
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
	var handler: ((NotificationAction) -> Void)?
	private var enabled: Bool { Bundle.main.bundleIdentifier != nil }
	private var center: UNUserNotificationCenter { .current() }

	private static let generalCategory = "GENERAL"

	func requestAuthorization() {
		guard enabled else { return }
		center.delegate = self
		let open = UNNotificationAction(identifier: "open", title: "Открыть", options: [.foreground])
		center.setNotificationCategories([
			UNNotificationCategory(identifier: Self.generalCategory, actions: [open], intentIdentifiers: []),
		])
		center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
	}

	/// Включены ли уведомления этого вида (настройки).
	private func allowed(_ k: AttentionEvent.Kind) -> Bool {
		let d = UserDefaults.standard
		func flag(_ key: String) -> Bool { d.object(forKey: key) == nil ? true : d.bool(forKey: key) }
		switch k {
		case .permission: return flag("notify.permission")
		case .error: return flag("notify.error")
		case .blocked: return flag("notify.blocked")
		case .sessionDone: return flag("notify.sessionDone")
		}
	}

	func post(_ e: AttentionEvent) {
		guard enabled, allowed(e.kind) else { return }
		if let until = UserDefaults.standard.object(forKey: "notify.pausedUntil") as? Date, until > Date() { return }
		let c = UNMutableNotificationContent()
		c.title = e.title
		if let s = e.subtitle { c.subtitle = s }
		c.body = String(e.body.prefix(300))
		c.sound = e.kind == .sessionDone ? nil : .default
		c.categoryIdentifier = Self.generalCategory
		c.threadIdentifier = e.sessionId ?? "none"
		c.interruptionLevel = e.kind == .permission ? .timeSensitive : .active
		c.userInfo = ["agentId": e.agentId ?? "", "sessionId": e.sessionId ?? "", "requestId": e.requestId ?? ""]
		let id = e.requestId ?? UUID().uuidString
		center.add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
	}

	/// Бейдж на иконке Dock.
	func setBadge(_ n: Int) {
		guard enabled else { return }
		center.setBadgeCount(n)
	}

	/// Приложение на экране — вместо баннера тост внутри окна.
	nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
		await MainActor.run { NSApp.isActive } ? [] : [.banner, .sound]
	}

	nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
		let info = response.notification.request.content.userInfo
		let agent = (info["agentId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
		let session = (info["sessionId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
		let action: NotificationAction
		switch response.actionIdentifier {
		default:
			action = .open(agentId: agent, sessionId: session)
		}
		await MainActor.run { self.handler?(action) }
	}
}
