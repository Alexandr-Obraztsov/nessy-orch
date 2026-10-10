import SwiftUI
import AppKit

/// Настройка окна-терминала: прозрачная шапка без заголовка (содержимое идёт под неё), цвет окна = цвет терминала (углы и края
/// не выделяются), полноэкранный режим для шапки, фокус окна (команды меню действуют на него) и подтверждение закрытия
/// окна с живым процессом.
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
		private var tokens: [NSObjectProtocol] = []
		private var guardian: CloseGuard?

		/// Окно в стиле терминала: без плашки заголовка, фон как у терминала (следует за темой).
		private func style(_ w: NSWindow) {
			w.titleVisibility = .hidden
			w.titlebarAppearsTransparent = true
			w.styleMask.insert(.fullSizeContentView)
			w.isMovableByWindowBackground = false
			let dark = w.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
			w.backgroundColor = TerminalTheme.ns(TerminalTheme.scheme(dark: dark).background)
			measure(w)
		}

		/// Высота шапки подстраивается под светофор: её центр = центр кнопок.
		private func measure(_ w: NSWindow) {
			guard !w.styleMask.contains(.fullScreen), let b = w.standardWindowButton(.closeButton), let sup = b.superview else { return }
			let r = sup.convert(b.frame, to: nil)
			let center = w.frame.height - r.midY
			if center > 8, center < 40, abs((model?.lightsCenter ?? 0) - center) > 0.5 { model?.lightsCenter = center }
		}

		override func viewDidMoveToWindow() {
			super.viewDidMoveToWindow()
			tokens.forEach(NotificationCenter.default.removeObserver)
			tokens = []
			guard let w = window else { return }
			style(w)
			let nc = NotificationCenter.default
			tokens.append(nc.addObserver(forName: NSWindow.didBecomeKeyNotification, object: w, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.onKey() } })
			// полноэкранный режим: шапка прячется и выезжает у кромки; на выходе заново меряем светофор
			for (n, on) in [(NSWindow.willEnterFullScreenNotification, true), (NSWindow.didExitFullScreenNotification, false)] {
				tokens.append(nc.addObserver(forName: n, object: w, queue: .main) { [weak self] _ in
					MainActor.assumeIsolated {
						guard let self else { return }
						self.model?.isFullScreen = on
						self.model?.barHover = false
						if !on { DispatchQueue.main.async { self.style(w) } }
					}
				})
			}
			// пока открыто меню шапки, она не прячется
			for (n, on) in [(NSMenu.didBeginTrackingNotification, true), (NSMenu.didEndTrackingNotification, false)] {
				tokens.append(nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.model?.menuOpen = on } })
			}
			tokens.append(nc.addObserver(forName: NSWindow.didResizeNotification, object: w, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.measure(w) } })
			model?.isFullScreen = w.styleMask.contains(.fullScreen)
			DispatchQueue.main.async { [weak self] in self?.measure(w) }
			if w.isKeyWindow { onKey() }
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
