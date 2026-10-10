import SwiftUI
import AppKit
import SwiftTerm
import NessyKit

// MARK: - Тема терминала (design-system.md: спокойные поверхности, один акцент)

/// Палитра терминала для светлой и тёмной темы: ANSI приглушённая и читаемая на своём фоне, курсор — акцентный.
/// Фон чуть отличается от окна, чтобы терминал читался как отдельная поверхность.
enum TerminalTheme {
	struct Scheme {
		var background: UInt32, foreground: UInt32, caret: UInt32, selection: UInt32
		/// 0–7 обычные, 8–15 яркие
		var ansi: [UInt32]
	}

	static let dark = Scheme(
		background: 0x141416, foreground: 0xE4E4E8, caret: 0x4CA2FF, selection: 0x2C4F80,
		ansi: [0x3A3A40, 0xE5736B, 0x7FC08A, 0xD9B86C, 0x6FA3EF, 0xC08AD8, 0x6FC1C8, 0xC9C9CF,
			   0x66666E, 0xFF8F87, 0x9AD6A3, 0xEBCD85, 0x8FBBFF, 0xD3A5E8, 0x8ED3D9, 0xF2F2F4])
	static let light = Scheme(
		background: 0xFBFBFC, foreground: 0x1D1D1F, caret: 0x0A6CE0, selection: 0xBBD6F8,
		ansi: [0x1D1D1F, 0xC2362B, 0x2E7D46, 0x946500, 0x1F5FBF, 0x8A3FA8, 0x167E86, 0x6B6B73,
			   0x5F5F66, 0xD9483B, 0x3C9A59, 0xB07B00, 0x3A7BE0, 0xA354C4, 0x1E99A3, 0x86868C])

	static func ns(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
		NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
	}
	static func term(_ hex: UInt32) -> SwiftTerm.Color {
		SwiftTerm.Color(red: UInt16((hex >> 16) & 0xFF) * 257, green: UInt16((hex >> 8) & 0xFF) * 257, blue: UInt16(hex & 0xFF) * 257)
	}

	static func scheme(dark isDark: Bool) -> Scheme { isDark ? dark : light }

	static func apply(to v: LocalProcessTerminalView, dark isDark: Bool) {
		let s = scheme(dark: isDark)
		v.installColors(s.ansi.map(term))
		v.nativeBackgroundColor = ns(s.background)
		v.nativeForegroundColor = ns(s.foreground)
		v.caretColor = ns(s.caret)
		v.selectedTextBackgroundColor = ns(s.selection)
	}
}

// MARK: - Вид терминала с отступом

/// Контейнер: фон по теме и постоянный внутренний отступ вокруг самого терминала. Шапка окна лежит над контейнером
/// (терминал начинается под ней), поэтому высота терминала от панели не зависит: меняется только ширина.
final class TerminalContainer: NSView {
	static let inset: CGFloat = 12
	let terminal: LocalProcessTerminalView
	private var defaultsToken: NSObjectProtocol?
	/// отступ сверху: высота шапки (постоянная, поэтому высота терминала от панели не зависит)
	private var topInset: CGFloat = TerminalContainer.inset

	override init(frame: NSRect) {
		terminal = LocalProcessTerminalView(frame: .zero)
		super.init(frame: frame)
		wantsLayer = true
		applyFont()
		addSubview(terminal)
		applyTheme()
		// размер шрифта из настроек применяется к живому терминалу
		defaultsToken = NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
			MainActor.assumeIsolated { self?.applyFont() }
		}
	}
	required init?(coder: NSCoder) { fatalError() }
	deinit { if let defaultsToken { NotificationCenter.default.removeObserver(defaultsToken) } }

	var isDark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

	private func applyFont() {
		let size = AppSettings.terminalFontSize
		guard terminal.font.pointSize != size else { return }
		terminal.font = NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
	}

	func applyTheme() {
		TerminalTheme.apply(to: terminal, dark: isDark)
		layer?.backgroundColor = TerminalTheme.ns(TerminalTheme.scheme(dark: isDark).background).cgColor
	}

	/// Отступ сверху: панель открыта — почти нулевой (терминал под прозрачной шапкой), закрыта — высота шапки. Меняется плавно.
	func setTopInset(_ v: CGFloat, animated: Bool = true) {
		guard abs(v - topInset) > 0.5 else { return }
		topInset = v
		let target = terminalFrame
		if animated, window != nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
			NSAnimationContext.runAnimationGroup { ctx in
				ctx.duration = 0.35
				ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.3, 1)
				terminal.animator().frame = target
			}
		} else {
			terminal.frame = target
		}
	}

	private var terminalFrame: CGRect {
		let i = Self.inset
		return CGRect(x: i, y: i, width: max(0, bounds.width - 2 * i), height: max(0, bounds.height - i - topInset))
	}

	private func layoutTerminal() { terminal.frame = terminalFrame }

	override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); applyTheme() }
	override func layout() { super.layout(); layoutTerminal() }
	override var acceptsFirstResponder: Bool { true }
	override func becomeFirstResponder() -> Bool { window?.makeFirstResponder(terminal) ?? false }
}

// MARK: - Терминал окна

/// Терминал окна: процесс оболочки в псевдотерминале и его вид. Один на окно; закрывается вместе с окном.
@Observable
final class TerminalTab: NSObject, Identifiable, LocalProcessTerminalViewDelegate {
	let id = UUID()
	let key: String
	let spec: LaunchSpec
	/// nil — процесс работает; иначе код выхода (−1 — неизвестен)
	private(set) var exitCode: Int32?
	/// оболочка завершилась сама (`exit`): окно можно закрыть
	@ObservationIgnored var onExit: ((Int32?) -> Void)?
	@ObservationIgnored let container = TerminalContainer(frame: .zero)

	init(key: String, spec: LaunchSpec) {
		self.key = key
		self.spec = spec
		super.init()
		container.terminal.processDelegate = self
	}

	var isAlive: Bool { exitCode == nil }

	func start() {
		let dir = TerminalLaunch.isUsableDirectory(spec.directory) ? spec.directory : NSHomeDirectory()
		container.terminal.startProcess(executable: spec.executable, args: spec.args, environment: spec.environment, currentDirectory: dir)
	}

	/// Закрыть: SIGHUP процессу и закрытие псевдотерминала.
	func terminate() {
		guard isAlive else { return }
		let pid = container.terminal.process.shellPid
		if pid > 0 { kill(pid, SIGHUP) }
		container.terminal.terminate()
		exitCode = -1
	}

	// MARK: LocalProcessTerminalViewDelegate
	func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
	func setTerminalTitle(source: LocalProcessTerminalView, title: String) {}
	func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
	func processTerminated(source: TerminalView, exitCode code: Int32?) {
		DispatchQueue.main.async { [self] in
			guard isAlive else { return }
			exitCode = code ?? -1
			let text = code.map { $0 == 0 ? "Процесс завершён" : "Процесс завершён · код \($0)" } ?? "Процесс завершён"
			(source as? LocalProcessTerminalView)?.feed(text: "\r\n\u{1b}[2m[\(text)]\u{1b}[0m\r\n")
			onExit?(code)
		}
	}
}

// MARK: - Реестр терминалов

@MainActor
@Observable
final class TerminalStore {
	static let shared = TerminalStore()
	private(set) var tabs: [String: TerminalTab] = [:]

	func tab(for key: String) -> TerminalTab? { tabs[key] }

	@discardableResult
	func add(_ spec: LaunchSpec, key: String) -> TerminalTab {
		tabs[key]?.terminate()
		let tab = TerminalTab(key: key, spec: spec)
		tabs[key] = tab
		tab.start()
		return tab
	}

	func close(key: String) {
		tabs[key]?.terminate()
		tabs[key] = nil
	}

	var liveCount: Int { tabs.values.filter(\.isAlive).count }
	func terminateAll() { tabs.values.forEach { $0.terminate() } }
}

// MARK: - Встраивание в SwiftUI

/// Показывает вид готового терминала и отдаёт ему фокус.
struct TerminalHost: NSViewRepresentable {
	var tab: TerminalTab
	var topInset: CGFloat

	func makeNSView(context: Context) -> TerminalContainer {
		let c = tab.container
		c.removeFromSuperview()
		c.setTopInset(topInset, animated: false)
		// окно появляется не сразу: пробуем несколько раз
		for delay in [0.0, 0.15, 0.5] {
			DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
				guard let w = c.window else { return }
				if w.firstResponder !== c.terminal, !(w.firstResponder is NSTextView) { w.makeFirstResponder(c.terminal) }
			}
		}
		return c
	}
	func updateNSView(_ v: TerminalContainer, context: Context) { v.setTopInset(topInset) }
}
