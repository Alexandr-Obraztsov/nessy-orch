import SwiftUI
import ServiceManagement

enum LoginItem {
	static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
	static func set(_ on: Bool) {
		guard Bundle.main.bundleIdentifier != nil else { return }
		do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } } catch {}
	}
}
