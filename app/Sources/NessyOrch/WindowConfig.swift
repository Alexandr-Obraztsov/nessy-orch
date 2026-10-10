import SwiftUI
import AppKit

/// Настройка окна-терминала: прозрачная шапка без заголовка (содержимое идёт под неё), цвет окна = цвет терминала (углы и края
/// не выделяются), полноэкранный режим для шапки, фокус окна (команды меню действуют на него) и подтверждение закрытия
/// окна с живым процессом.
struct WindowConfigurator: NSViewRepresentable {
	var app: AppModel

	func makeNSView(context: Context) -> NSView {
		let v = ConfigView()
		v.model = app
		return v
	}
	func updateNSView(_ v: NSView, context: Context) {}

	final class ConfigView: NSView {
		var model: AppModel?
		private var tokens: [NSObjectProtocol] = []
		private var guardian: CloseGuard?
		private var shown = false

		/// Окно в стиле терминала: без заголовка, содержимое идёт под шапку, фон как у терминала (углы и края не выделяются).
		private func style(_ w: NSWindow) {
			w.titleVisibility = .hidden
			w.titlebarAppearsTransparent = true
			w.styleMask.insert(.fullSizeContentView)
			let dark = w.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
			w.backgroundColor = TerminalTheme.ns(TerminalTheme.scheme(dark: dark).background)
			measure(w)
		}

		/// Светофор опускается на общую линию шапки: его центр = центр кнопок справа (`SessionWindowModel.barCenter`).
		private func measure(_ w: NSWindow) {
			guard !w.styleMask.contains(.fullScreen) else { return }
			let target = SessionWindowModel.barCenter
			for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
				guard let b = w.standardWindowButton(kind), let sup = b.superview else { continue }
				let r = sup.convert(b.frame, to: nil)
				let center = w.frame.height - r.midY
				let dy = center - target // < 0 — кнопка выше цели, её надо опустить
				guard abs(dy) > 0.5 else { continue }
				var o = b.frame.origin
				o.y += sup.isFlipped ? -dy : dy
				b.setFrameOrigin(o)
			}
		}

		override func viewDidMoveToWindow() {
			super.viewDidMoveToWindow()
			tokens.forEach(NotificationCenter.default.removeObserver)
			tokens = []
			guard let w = window else { return }
			style(w)
			// только что созданное окно показывается поверх остальных
			if !shown { shown = true; DispatchQueue.main.async { NSApp.activate(); w.makeKeyAndOrderFront(nil); w.orderFrontRegardless() } }
			let nc = NotificationCenter.default
			// полноэкранный режим: шапка прячется и выезжает у кромки; на выходе заново меряем светофор
			for (n, on) in [(NSWindow.willEnterFullScreenNotification, true), (NSWindow.didExitFullScreenNotification, false)] {
				tokens.append(nc.addObserver(forName: n, object: w, queue: .main) { [weak self] _ in
					MainActor.assumeIsolated {
						guard let self else { return }
						self.model?.isFullScreen = on
						if !on { DispatchQueue.main.async { self.style(w) } }
					}
				})
			}
			tokens.append(nc.addObserver(forName: NSWindow.didResizeNotification, object: w, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.measure(w) } })
			model?.isFullScreen = w.styleMask.contains(.fullScreen)
			DispatchQueue.main.async { [weak self] in self?.measure(w) }
			if let m = model, guardian == nil, !(w.delegate is CloseGuard) {
				let g = CloseGuard(original: w.delegate, model: m)
				guardian = g
				w.delegate = g
			}
		}
		override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); if let w = window { style(w) } }
		deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
	}
}

/// Перехватывает закрытие окна: живой терминал — только с подтверждением; остальное отдаёт прежнему делегату.
@MainActor
final class CloseGuard: NSObject, NSWindowDelegate {
	private weak var original: NSWindowDelegate?
	private let model: AppModel

	init(original: NSWindowDelegate?, model: AppModel) {
		self.original = original
		self.model = model
	}

	func windowShouldClose(_ sender: NSWindow) -> Bool {
		if model.terminals.liveCount > 0, !NSApp.isTerminating {
			let a = NSAlert()
			a.messageText = "Закрыть окно?"
			a.informativeText = model.terminals.liveCount == 1 ? "В нём работает терминал: его процесс будет завершён." : "Работают терминалы (\(model.terminals.liveCount)): их процессы будут завершены."
			a.addButton(withTitle: "Закрыть")
			a.addButton(withTitle: "Отмена")
			a.alertStyle = .warning
			guard a.runModal() == .alertFirstButtonReturn else { return false }
		}
		// закрытие окон пользователем завершает терминалы; программное закрытие (SwiftUI при ссылках) их не трогает
		model.closeAllTabs()
		return original?.windowShouldClose?(sender) ?? true
	}

	func windowWillClose(_ notification: Notification) {
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
