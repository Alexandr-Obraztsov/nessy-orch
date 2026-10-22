import SwiftUI
import NessyKit

/// Вкладка «Фон» окна настроек приложения (спека §6): форма как в `Settings.swift`; каждое изменение уходит в `PATCH /learning/settings`.
struct LearningSettingsView: View {
	@Environment(AppModel.self) private var model
	@State private var agents = 2
	@State private var synced = false
	/// правки идут по одной очереди: последнее значение побеждает, быстрые нажатия степпера сливаются (400 мс)
	@State private var queue = SettingsPatchQueue()

	private var learning: LearningStore { model.store.learning }
	private var settings: LearningSettings? { learning.settings }

	var body: some View {
		Form {
			Section {
				Toggle("Фоновое обучение", isOn: flag(\.enabled, "enabled"))
			}
			Section {
				Stepper(value: $agents, in: 1...6) { LabeledContent("Фоновых агентов одновременно", value: "\(agents)") }
			}
		}
		.formStyle(.grouped)
		.onAppear { configureQueue(); syncFromServer() }
		.onDisappear { Task { await queue.flush() } }
		.onChange(of: settings) { _, _ in syncFromServer() }
		.onChange(of: agents) { _, v in if synced, v != settings?.maxAgents { patch(["maxAgents": .number(Double(v))]) } }
	}

	private func flag(_ kp: KeyPath<LearningSettings, Bool>, _ key: String) -> Binding<Bool> {
		Binding(get: { settings?[keyPath: kp] ?? false }, set: { patchNow([key: .bool($0)]) })
	}

	/// Значения степперов — с сервера; свои правки не затираются, пока совпадают с отправленными.
	private func syncFromServer() {
		guard let s = settings, !queue.isBusy else { return }
		synced = false
		agents = s.maxAgents
		DispatchQueue.main.async { synced = true }
	}

	private func configureQueue() {
		let model = model
		queue.send = { c in _ = try await model.store.client.patchLearningSettings(c) }
		queue.onError = { e in model.flash("Настройки не сохранены: \(e.localizedDescription)", error: true) }
		queue.onIdle = { await model.store.learning.refresh(); syncFromServer() }
	}

	/// степперы: накопить и отправить через паузу
	private func patch(_ changes: [String: JSONValue]) { queue.set(changes) }

	/// переключатели: отправить сразу
	private func patchNow(_ changes: [String: JSONValue]) {
		queue.set(changes)
		Task { await queue.flush() }
	}
}
