import SwiftUI
import AppKit

/// Настраиваемые горячие клавиши приложения: переключение проектов, панель агентов, терминал проекта, роли, новая сессия, открытие папки.
/// Хранятся в UserDefaults («hotkey.<действие>» = «клавиша|модификаторы»); значения по умолчанию — ниже.
enum HotkeyAction: String, CaseIterable, Identifiable {
	case togglePanel, toggleShell, newShellTab, closeShellTab, nextShellTab, prevShellTab, expandShell, roles, background, nextProject, prevProject, newTerminal, openFolder
	var id: String { rawValue }

	var title: String {
		switch self {
		case .togglePanel: "Показать / скрыть панель агентов"
		case .toggleShell: "Показать / скрыть терминал проекта"
		case .newShellTab: "Новый терминал в блоке"
		case .closeShellTab: "Закрыть терминал блока"
		case .nextShellTab: "Следующий терминал блока"
		case .prevShellTab: "Предыдущий терминал блока"
		case .expandShell: "Развернуть / свернуть терминал"
		case .roles: "Роли агентов"
		case .background: "Фон: обучение"
		case .nextProject: "Следующий проект"
		case .prevProject: "Предыдущий проект"
		case .newTerminal: "Новая сессия в этой папке"
		case .openFolder: "Открыть папку…"
		}
	}

	var fallback: Hotkey {
		switch self {
		case .togglePanel: Hotkey(key: "b", mods: [.command, .option])
		case .toggleShell: Hotkey(key: "`", mods: [.control])
		case .newShellTab: Hotkey(key: "t", mods: [.command])
		case .closeShellTab: Hotkey(key: "w", mods: [.command, .option])
		case .nextShellTab: Hotkey(key: "]", mods: [.command, .option])
		case .prevShellTab: Hotkey(key: "[", mods: [.command, .option])
		case .expandShell: Hotkey(key: "e", mods: [.command, .option])
		case .roles: Hotkey(key: "r", mods: [.command, .shift])
		case .background: Hotkey(key: "b", mods: [.command, .shift])
		case .nextProject: Hotkey(key: "]", mods: [.command, .shift])
		case .prevProject: Hotkey(key: "[", mods: [.command, .shift])
		case .newTerminal: Hotkey(key: "n", mods: [.command])
		case .openFolder: Hotkey(key: "o", mods: [.command, .shift])
		}
	}
}

struct Hotkey: Equatable {
	var key: String
	var mods: NSEvent.ModifierFlags

	/// «⌃⌥⇧⌘B»
	var display: String {
		var s = ""
		if mods.contains(.control) { s += "⌃" }
		if mods.contains(.option) { s += "⌥" }
		if mods.contains(.shift) { s += "⇧" }
		if mods.contains(.command) { s += "⌘" }
		return s + key.uppercased()
	}

	var shortcut: KeyboardShortcut? {
		guard let c = key.first else { return nil }
		var m: EventModifiers = []
		if mods.contains(.command) { m.insert(.command) }
		if mods.contains(.option) { m.insert(.option) }
		if mods.contains(.shift) { m.insert(.shift) }
		if mods.contains(.control) { m.insert(.control) }
		return KeyboardShortcut(KeyEquivalent(c), modifiers: m)
	}

	var stored: String { "\(key)|\(mods.rawValue)" }
	init(key: String, mods: NSEvent.ModifierFlags) { self.key = key; self.mods = mods.intersection([.command, .option, .shift, .control]) }
	init?(stored: String) {
		let p = stored.split(separator: "|", maxSplits: 1).map(String.init)
		guard p.count == 2, !p[0].isEmpty, let raw = UInt(p[1]) else { return nil }
		self.init(key: p[0], mods: NSEvent.ModifierFlags(rawValue: raw))
	}
}

@MainActor
@Observable
final class Hotkeys {
	static let shared = Hotkeys()
	private(set) var values: [HotkeyAction: Hotkey] = [:]

	init() {
		for a in HotkeyAction.allCases {
			values[a] = UserDefaults.standard.string(forKey: "hotkey." + a.rawValue).flatMap(Hotkey.init(stored:)) ?? a.fallback
		}
	}

	func hotkey(_ a: HotkeyAction) -> Hotkey { values[a] ?? a.fallback }
	func shortcut(_ a: HotkeyAction) -> KeyboardShortcut? { hotkey(a).shortcut }
	func display(_ a: HotkeyAction) -> String { hotkey(a).display }

	/// Действие, у которого уже стоит такое сочетание (кроме самого `a`), или системное, которое нельзя перебивать.
	func conflict(_ h: Hotkey, for a: HotkeyAction) -> String? {
		if let other = HotkeyAction.allCases.first(where: { $0 != a && hotkey($0) == h }) { return other.title }
		let reserved: [(Hotkey, String)] = [
			(Hotkey(key: "q", mods: .command), "Выйти"), (Hotkey(key: "w", mods: .command), "Закрыть терминал"), (Hotkey(key: ",", mods: .command), "Настройки"),
			(Hotkey(key: "k", mods: .command), "Перейти к…"), (Hotkey(key: "/", mods: .command), "Горячие клавиши"), (Hotkey(key: "r", mods: [.command, .shift]), "Роли"),
		] + ["c", "v", "x", "a", "z", "h", "m"].map { (Hotkey(key: $0, mods: .command), "Системное сочетание") }
			+ (1...9).map { (Hotkey(key: String($0), mods: .command), "Переключение проектов") }
		return reserved.first { $0.0 == h }?.1
	}

	func set(_ h: Hotkey, for a: HotkeyAction) {
		values[a] = h
		UserDefaults.standard.set(h.stored, forKey: "hotkey." + a.rawValue)
	}

	func reset(_ a: HotkeyAction) {
		values[a] = a.fallback
		UserDefaults.standard.removeObject(forKey: "hotkey." + a.rawValue)
	}

	func resetAll() { HotkeyAction.allCases.forEach(reset) }
}

/// Поле записи сочетания: клик — «нажмите сочетание», затем любая комбинация с ⌘, ⌃ или ⌥; Esc — отмена.
struct HotkeyRecorder: View {
	var action: HotkeyAction
	@Environment(AppModel.self) private var model
	@State private var recording = false
	@State private var monitor: Any?

	var body: some View {
		let keys = Hotkeys.shared
		HStack(spacing: DS.Metrics.s2) {
			Button { recording ? stop() : start() } label: {
				Text(recording ? "Нажмите сочетание…" : keys.display(action))
					.font(DS.Typography.mono)
					.foregroundStyle(recording ? DS.Palette.accentText : DS.Palette.textPrimary)
					.frame(minWidth: 110)
					.padding(.horizontal, 10).padding(.vertical, 4)
					.background(recording ? DS.Palette.selection : DS.Palette.hover, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
			}
			.buttonStyle(.plain)
			if keys.hotkey(action) != action.fallback {
				Button { keys.reset(action) } label: { Image(systemName: "arrow.counterclockwise") }
					.buttonStyle(.plain).foregroundStyle(DS.Palette.textTertiary).help("По умолчанию: \(action.fallback.display)")
			}
		}
		.onDisappear { stop() }
	}

	private func start() {
		recording = true
		monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
			if e.keyCode == 53 { stop(); return nil } // Esc
			let mods = e.modifierFlags.intersection([.command, .option, .shift, .control])
			guard let ch = e.charactersIgnoringModifiers?.lowercased(), ch.count == 1, mods.contains(.command) || mods.contains(.control) || mods.contains(.option) else { NSSound.beep(); return nil }
			let h = Hotkey(key: ch, mods: mods)
			if let c = Hotkeys.shared.conflict(h, for: action) { model.flash("Сочетание занято: \(c)", error: true); return nil }
			Hotkeys.shared.set(h, for: action)
			stop()
			return nil
		}
	}

	private func stop() {
		recording = false
		if let monitor { NSEvent.removeMonitor(monitor) }
		monitor = nil
	}
}
