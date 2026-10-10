import SwiftUI
import NessyKit

struct SettingsView: View {
	var body: some View {
		TabView {
			GeneralSettings().tabItem { Label("Основные", systemImage: "gearshape") }
			NotificationSettings().tabItem { Label("Уведомления", systemImage: "bell") }
			ServerSettings().tabItem { Label("Сервер", systemImage: "server.rack") }
		}
		.frame(width: 480, height: 320)
	}
}

struct GeneralSettings: View {
	@AppStorage("menuBarOnly") private var menuBarOnly = false
	@State private var login = LoginItem.isEnabled
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		Form {
			Toggle("Только в строке меню, без значка в Dock", isOn: $menuBarOnly)
				.onChange(of: menuBarOnly) { _, v in NSApp.setActivationPolicy(v ? .accessory : .regular) }
			Toggle("Открывать при входе в систему", isOn: $login)
				.onChange(of: login) { _, v in LoginItem.set(v); login = LoginItem.isEnabled }
			Button("Роли агентов…") { openWindow(id: "roles") }
		}
		.formStyle(.grouped)
	}
}

struct NotificationSettings: View {
	@AppStorage("notify.permission") private var permission = true
	@AppStorage("notify.blocked") private var blocked = true
	@AppStorage("notify.error") private var error = true
	@AppStorage("notify.sessionDone") private var sessionDone = true

	var body: some View {
		Form {
			Section {
				Toggle("Агент просит разрешения", isOn: $permission)
				Toggle("Агент заблокирован или ему не хватает данных", isOn: $blocked)
				Toggle("Ход завершился ошибкой", isOn: $error)
				Toggle("Сессия завершена", isOn: $sessionDone)
			} header: {
				Text("Уведомлять, когда")
			} footer: {
				Text("Готовые ответы не уведомляют: у агента и сессии появляется точка «новое».")
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
