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
		private var monitor: Any?
		private var lockedMove = false

		/// Окно в стиле терминала: без заголовка, содержимое идёт под шапку, фон как у терминала (углы и края не выделяются).
		private func style(_ w: NSWindow) {
			w.titleVisibility = .hidden
			w.titlebarAppearsTransparent = true
			w.styleMask.insert(.fullSizeContentView)
			let dark = w.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
			w.backgroundColor = TerminalTheme.ns(TerminalTheme.scheme(dark: dark).background)
			measure(w)
		}

		/// Светофор встаёт на общую линию шапки (центр = `SessionWindowModel.barCenter`), а отступ слева равен отступу сверху.
		private func measure(_ w: NSWindow) {
			guard !w.styleMask.contains(.fullScreen) else { return }
			let kinds: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
			guard let close = w.standardWindowButton(.closeButton), let csup = close.superview else { return }
			let target = SessionWindowModel.barCenter
			let margin = target - close.frame.height / 2 // сверху: от верха окна до верха кнопки
			let dx = margin - csup.convert(close.frame, to: nil).minX
			var trailing: CGFloat = 0
			for kind in kinds {
				guard let b = w.standardWindowButton(kind), let sup = b.superview else { continue }
				let r = sup.convert(b.frame, to: nil)
				let dy = (w.frame.height - r.midY) - target // < 0 — кнопка выше цели, её надо опустить
				var o = b.frame.origin
				if abs(dy) > 0.5 { o.y += sup.isFlipped ? -dy : dy }
				if abs(dx) > 0.5 { o.x += dx }
				if o != b.frame.origin { b.setFrameOrigin(o) }
				trailing = max(trailing, sup.convert(b.frame, to: nil).maxX)
			}
			if abs((model?.lightsTrailing ?? 0) - trailing) > 0.5 { model?.lightsTrailing = trailing }
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
			// нажатие на шапку блока (он переносится) не должно двигать окно: на время нажатия окно «не перемещаемое»
			if monitor == nil {
				monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp, .keyDown]) { [weak self, weak w] e in
					MainActor.assumeIsolated {
						guard let self, let w, e.window === w, let m = self.model else { return e }
						// ⌘W — закрыть проект (с предупреждением), а не окно; без проектов — как обычно
						if e.type == .keyDown {
							if e.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, e.charactersIgnoringModifiers == "w", m.activeWindow != nil {
								m.closeCurrentWindow()
								return nil
							}
							return e
						}
						if e.type == .leftMouseDown {
							let p = CGPoint(x: e.locationInWindow.x, y: (w.contentView?.bounds.height ?? 0) - e.locationInWindow.y)
							if m.isDockHeader(at: p) { w.isMovable = false; self.lockedMove = true }
						} else if self.lockedMove {
							w.isMovable = true; self.lockedMove = false
						}
						return e
					}
				}
			}
			// система переставляет светофор после показа окна, смены ключевого окна и масштаба: выравниваем несколько раз
			for d in [0.0, 0.1, 0.4, 1.0, 2.0] { DispatchQueue.main.asyncAfter(deadline: .now() + d) { [weak self] in self?.measure(w) } }
			for n in [NSWindow.didBecomeKeyNotification, NSWindow.didChangeScreenNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didUpdateNotification] {
				tokens.append(nc.addObserver(forName: n, object: w, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.measure(w) } })
			}
			if let m = model, guardian == nil, !(w.delegate is CloseGuard) {
				let g = CloseGuard(original: w.delegate, model: m)
				guardian = g
				w.delegate = g
			}
		}
		override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); if let w = window { style(w) } }
		deinit {
			tokens.forEach(NotificationCenter.default.removeObserver)
			if let monitor { NSEvent.removeMonitor(monitor) }
		}
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
