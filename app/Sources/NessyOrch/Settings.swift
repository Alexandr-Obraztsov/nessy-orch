import SwiftUI
import NessyKit

struct SettingsView: View {
	var body: some View {
		TabView {
			GeneralSettings().tabItem { Label("Основные", systemImage: "gearshape") }
			TerminalSettings().tabItem { Label("Терминал", systemImage: "terminal") }
			HotkeySettings().tabItem { Label("Клавиши", systemImage: "keyboard") }
			NotificationSettings().tabItem { Label("Уведомления", systemImage: "bell") }
			ServerSettings().tabItem { Label("Сервер", systemImage: "server.rack") }
		}
		.frame(width: 540, height: 520)
	}
}

struct GeneralSettings: View {
	@Environment(AppModel.self) private var model
	@AppStorage("menuBarOnly") private var menuBarOnly = false
	@State private var login = LoginItem.isEnabled
	@State private var finder = FinderSupport.isEnabled
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Form {
			Section {
				Toggle("Быстрое действие «Открыть в TClaude-Orch» в Finder", isOn: $finder)
					.onChange(of: finder) { _, v in if !FinderSupport.setEnabled(v) { finder = FinderSupport.isEnabled } }
			} footer: {
				Text("Действие появится в меню правой кнопки Finder → «Быстрые действия»; кроме того, приложение можно перетащить на панель Finder с зажатым ⌘.")
					.foregroundStyle(DS.Palette.textSecondary)
			}
			Section {
				Toggle("Только в строке меню, без значка в Dock", isOn: $menuBarOnly)
					.onChange(of: menuBarOnly) { _, v in NSApp.setActivationPolicy(v ? .accessory : .regular) }
				Toggle("Открывать при входе в систему", isOn: $login)
					.onChange(of: login) { _, v in LoginItem.set(v); login = LoginItem.isEnabled }
				Button("Роли агентов…") { openWindow(id: "roles") }
			}
			CLISettingsSection()
		}
		.formStyle(.grouped)
	}
}

struct TerminalSettings: View {
	@AppStorage("terminal.fontSize") private var fontSize = 13.0
	@AppStorage("autoStartClaude") private var autoClaude = true
	@AppStorage("claudeCommand") private var claudeCommand = "claude"

	var body: some View {
		Form {
			Section {
				Toggle("Запускать Claude при открытии проекта", isOn: $autoClaude)
				TextField("Команда запуска", text: $claudeCommand, prompt: Text("claude")).disabled(!autoClaude)
				Stepper(value: $fontSize, in: 10...24, step: 1) { LabeledContent("Размер шрифта", value: "\(Int(fontSize)) pt") }
			} footer: {
				Text("Команда вводится в терминал сразу после старта оболочки, например `claude --model opus`. Команда `claude` уже идёт с хуками оркестратора. Размер шрифта применяется ко всем терминалам сразу.")
					.foregroundStyle(DS.Palette.textSecondary)
			}
		}
		.formStyle(.grouped)
	}
}

struct HotkeySettings: View {
	var body: some View {
		Form {
			Section {
				ForEach(HotkeyAction.allCases) { a in
					LabeledContent(a.title) { HotkeyRecorder(action: a) }
				}
			} footer: {
				Text("Нажмите на сочетание и введите новое (нужен ⌘, ⌃ или ⌥); Esc — отмена. Остальные клавиши достаются терминалу и Claude.")
					.foregroundStyle(DS.Palette.textSecondary)
			}
			Section("Остальные (не меняются)") {
				ForEach(Shortcuts.fixed, id: \.0) { k in
					LabeledContent(k.1) { Text(k.0).font(DS.Typography.mono).foregroundStyle(DS.Palette.textSecondary) }
				}
			}
			Section { Button("Сбросить все") { Hotkeys.shared.resetAll() } }
		}
		.formStyle(.grouped)
	}
}

struct NotificationSettings: View {
	@AppStorage("notify.permission") private var permission = true
	@AppStorage("notify.blocked") private var blocked = true
	@AppStorage("notify.error") private var error = true

	var body: some View {
		Form {
			Section {
				Toggle("Агент просит разрешения", isOn: $permission)
				Toggle("Агент заблокирован или ему не хватает данных", isOn: $blocked)
				Toggle("Ход завершился ошибкой", isOn: $error)
			} header: {
				Text("Уведомлять, когда")
			} footer: {
				Text("Готовые ответы не уведомляют: у агента появляется точка «новое».")
					.foregroundStyle(DS.Palette.textSecondary)
			}
		}
		.formStyle(.grouped)
	}
}

struct ServerSettings: View {
	@Environment(AppModel.self) private var model
	@AppStorage("serverURL") private var url = "http://127.0.0.1:4337"

	var body: some View {
		Form {
			Section {
				TextField("Адрес оркестратора", text: $url)
				LabeledContent("Состояние") {
					switch model.store.daemon {
					case .online(let v): Text(v.isEmpty ? "На связи" : "На связи · \(v)")
					case .connecting: Text("Подключаюсь…")
					case .offline: Text("Нет связи").foregroundStyle(DS.Palette.danger)
					}
				}
			} footer: {
				Text("Новый адрес применится после перезапуска приложения.").foregroundStyle(DS.Palette.textSecondary)
			}
			Section {
				HStack {
					Button("Перезапустить службу") { Task { _ = await Daemon.kickstart() } }
					Button("Открыть логи") { Daemon.openLogs() }
				}
			}
		}
		.formStyle(.grouped)
	}
}
