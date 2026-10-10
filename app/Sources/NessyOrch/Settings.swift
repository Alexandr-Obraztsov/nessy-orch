import SwiftUI
import NessyKit

struct SettingsView: View {
	var body: some View {
		TabView {
			GeneralSettings().tabItem { Label("Основные", systemImage: "gearshape") }
			TerminalSettings().tabItem { Label("Терминал", systemImage: "terminal") }
			NotificationSettings().tabItem { Label("Уведомления", systemImage: "bell") }
			ServerSettings().tabItem { Label("Сервер", systemImage: "server.rack") }
		}
		.frame(width: 500, height: 360)
	}
}

struct GeneralSettings: View {
	@AppStorage("menuBarOnly") private var menuBarOnly = false
	@AppStorage("askFolderOnLaunch") private var askFolder = true
	@State private var login = LoginItem.isEnabled
	@State private var finder = FinderSupport.isEnabled
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Form {
			Section {
				Toggle("Спрашивать проект при запуске без папки", isOn: $askFolder)
				Toggle("Быстрое действие «Открыть в TClaude-Orch» в Finder", isOn: $finder)
					.onChange(of: finder) { _, v in if !FinderSupport.setEnabled(v) { finder = FinderSupport.isEnabled } }
			} footer: {
				Text("Без папки — Dock или Spotlight. Действие появится в меню правой кнопки Finder → «Быстрые действия»; кроме того, приложение можно перетащить на панель Finder с зажатым ⌘.")
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

	var body: some View {
		Form {
			Section {
				Stepper(value: $fontSize, in: 10...24, step: 1) { LabeledContent("Размер шрифта", value: "\(Int(fontSize)) pt") }
			} footer: {
				Text("Применяется ко всем открытым терминалам сразу. Оболочка — ваша login-оболочка ($SHELL); команда `claude` уже идёт с хуками оркестратора.")
					.foregroundStyle(DS.Palette.textSecondary)
			}
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
