import SwiftUI
import AppKit

/// Многострочное поле ввода на NSTextView: ↩ — отправить, ⇧↩ / ⌥↩ — перенос строки в позиции каретки, Esc — снять фокус.
/// Высота растёт по содержимому до `maxHeight`, дальше поле прокручивается. Плейсхолдер рисует SwiftUI-обёртка.
struct ComposerTextView: NSViewRepresentable {
	@Binding var text: String
	@Binding var height: CGFloat
	var font: NSFont
	var maxHeight: CGFloat
	var onSubmit: () -> Void
	var onEscape: () -> Bool

	func makeCoordinator() -> Coordinator { Coordinator(self) }

	func makeNSView(context: Context) -> NSScrollView {
		let tv = NSTextView()
		tv.delegate = context.coordinator
		tv.isRichText = false
		tv.allowsUndo = true
		tv.drawsBackground = false
		tv.font = font
		tv.textColor = .labelColor
		tv.insertionPointColor = .labelColor
		tv.textContainerInset = .zero
		tv.textContainer?.lineFragmentPadding = 0
		tv.isVerticallyResizable = true
		tv.isHorizontallyResizable = false
		tv.autoresizingMask = [.width]
		tv.textContainer?.widthTracksTextView = true
		tv.isAutomaticQuoteSubstitutionEnabled = false
		tv.isAutomaticDashSubstitutionEnabled = false
		let sv = NSScrollView()
		sv.drawsBackground = false
		sv.hasVerticalScroller = true
		sv.autohidesScrollers = true
		sv.scrollerStyle = .overlay
		sv.borderType = .noBorder
		sv.documentView = tv
		// для проверки: `-debug.focusComposer YES` — фокус в поле сразу
		if UserDefaults.standard.bool(forKey: "debug.focusComposer") { DispatchQueue.main.async { sv.window?.makeFirstResponder(tv) } }
		return sv
	}

	func updateNSView(_ sv: NSScrollView, context: Context) {
		context.coordinator.parent = self
		guard let tv = sv.documentView as? NSTextView else { return }
		if tv.string != text {
			tv.string = text
			tv.undoManager?.removeAllActions()
		}
		context.coordinator.measure(tv)
	}

	final class Coordinator: NSObject, NSTextViewDelegate {
		var parent: ComposerTextView
		init(_ p: ComposerTextView) { parent = p }

		func textDidChange(_ n: Notification) {
			guard let tv = n.object as? NSTextView else { return }
			if parent.text != tv.string { parent.text = tv.string }
			measure(tv)
		}

		func measure(_ tv: NSTextView) {
			guard let lm = tv.layoutManager, let tc = tv.textContainer else { return }
			lm.ensureLayout(for: tc)
			let h = ceil(max(lm.usedRect(for: tc).height, tv.font.map { $0.ascender - $0.descender + $0.leading } ?? 16))
			let capped = min(h, parent.maxHeight)
			if abs(parent.height - capped) > 0.5 { DispatchQueue.main.async { self.parent.height = capped } }
		}

		/// Перенос строки на месте каретки (а не в конце текста и не символ U+2028).
		private func insertBreak(_ tv: NSTextView) { tv.insertText("\n", replacementRange: tv.selectedRange()) }

		func textView(_ tv: NSTextView, doCommandBy sel: Selector) -> Bool {
			switch sel {
			case #selector(NSResponder.insertNewline(_:)):
				// ⇧↩ и ⌥↩ — обычный перенос на месте каретки; ↩ — отправка
				let f = NSApp.currentEvent?.modifierFlags ?? []
				if f.contains(.shift) || f.contains(.option) { insertBreak(tv); return true }
				parent.onSubmit()
				return true
			case #selector(NSResponder.insertLineBreak(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
				insertBreak(tv)
				return true
			case #selector(NSResponder.cancelOperation(_:)):
				if !parent.onEscape() { tv.window?.makeFirstResponder(nil) }
				return true
			default:
				return false
			}
		}
	}
}
