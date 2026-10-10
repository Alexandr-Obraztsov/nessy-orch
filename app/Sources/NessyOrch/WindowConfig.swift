import SwiftUI
import AppKit

/// Настройка окна-терминала: следит, какое окно сейчас в фокусе (команды меню действуют на него), и спрашивает подтверждение,
/// если закрывают окно с живым процессом. Раскладка окна — системная (NavigationSplitView), в том числе в полноэкранном режиме:
/// отдельной логики для него нет.
struct WindowConfigurator: NSViewRepresentable {
	var window: SessionWindowModel
	var onKey: () -> Void = {}

	func makeNSView(context: Context) -> NSView {
		let v = ConfigView()
		v.model = window
		v.onKey = onKey
		return v
	}
	func updateNSView(_ v: NSView, context: Context) { (v as? ConfigView)?.onKey = onKey }

	final class ConfigView: NSView {
		var model: SessionWindowModel?
		var onKey: () -> Void = {}
		private var token: NSObjectProtocol?
		private var guardian: CloseGuard?

		override func viewDidMoveToWindow() {
			super.viewDidMoveToWindow()
			if let token { NotificationCenter.default.removeObserver(token) }
			guard let w = window else { return }
			token = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: w, queue: .main) { [weak self] _ in self?.onKey() }
			if w.isKeyWindow { onKey() }
			if let m = model, guardian == nil, !(w.delegate is CloseGuard) {
				let g = CloseGuard(original: w.delegate, model: m)
				guardian = g
				w.delegate = g
			}
		}
		deinit { if let token { NotificationCenter.default.removeObserver(token) } }
	}
}

/// Перехватывает закрытие окна: живой терминал — только с подтверждением; остальное отдаёт прежнему делегату.
@MainActor
final class CloseGuard: NSObject, NSWindowDelegate {
	private weak var original: NSWindowDelegate?
	private let model: SessionWindowModel
	var key: String { model.key }

	init(original: NSWindowDelegate?, model: SessionWindowModel) {
		self.original = original
		self.model = model
	}

	func windowShouldClose(_ sender: NSWindow) -> Bool {
		if model.terminal?.isAlive == true, !NSApp.isTerminating {
			let a = NSAlert()
			a.messageText = "Закрыть окно?"
			a.informativeText = "В нём работает терминал: его процесс будет завершён."
			a.addButton(withTitle: "Закрыть")
			a.addButton(withTitle: "Отмена")
			a.alertStyle = .warning
			guard a.runModal() == .alertFirstButtonReturn else { return false }
		}
		return original?.windowShouldClose?(sender) ?? true
	}

	func windowWillClose(_ notification: Notification) {
		model.closed()
		original?.windowWillClose?(notification)
	}

	override func responds(to aSelector: Selector!) -> Bool { super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false) }
	override func forwardingTarget(for aSelector: Selector!) -> Any? { original?.responds(to: aSelector) == true ? original : nil }
}

extension NSApplication {
	/// выход уже подтверждён: окна закрываются без повторных вопросов
	@MainActor static var terminatingFlag = false
	var isTerminating: Bool { Self.terminatingFlag }
}
