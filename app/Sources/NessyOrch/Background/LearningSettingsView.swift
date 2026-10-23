import SwiftUI
import NessyKit

/// Вкладка «Фон» окна настроек приложения: форма как в `Settings.swift`; каждое изменение уходит в `PATCH /learning/settings`.
struct LearningSettingsView: View {
	@Environment(AppModel.self) private var model
	@State private var agents = 2
	@State private var idle = 120
	@State private var retry = 60
	@State private var stall = 20
	@State private var events = 80
	@State private var chars = 40000
	@State private var archive = 30
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
				row("Агентов одновременно", $agents, 1...6, step: 1, unit: "")
				row("Сессия закончена после простоя", $idle, 5...10080, step: 5, unit: "мин")
				row("Повтор после ошибки", $retry, 5...3600, step: 5, unit: "сек")
				row("Зависший агент снимается через", $stall, 0...720, step: 5, unit: "мин", zero: "не снимать")
			}
			Section {
				row("Событий в блоке", $events, 10...400, step: 10, unit: "")
				row("Знаков в блоке", $chars, 4000...200000, step: 4000, unit: "")
				row("Хранить архив событий", $archive, 0...365, step: 1, unit: "дн", zero: "не хранить")
			}
		}
		.formStyle(.grouped)
		.onAppear { configureQueue(); syncFromServer() }
		.onDisappear { Task { await queue.flush() } }
		.onChange(of: settings) { _, _ in syncFromServer() }
		.onChange(of: agents) { _, v in changed("maxAgents", v, settings?.maxAgents) }
		.onChange(of: idle) { _, v in changed("idleMin", v, settings?.idleMin) }
		.onChange(of: retry) { _, v in changed("retrySec", v, settings?.retrySec) }
		.onChange(of: stall) { _, v in changed("stallMin", v, settings?.stallMin) }
		.onChange(of: events) { _, v in changed("blockEvents", v, settings?.blockEvents) }
		.onChange(of: chars) { _, v in changed("blockChars", v, settings?.blockChars) }
		.onChange(of: archive) { _, v in changed("archiveDays", v, settings?.archiveDays) }
	}

	/// Строка: название слева, значение и единица справа; у нуля — короткая серая подпись.
	private func row(_ title: String, _ value: Binding<Int>, _ range: ClosedRange<Int>, step: Int, unit: String, zero: String? = nil) -> some View {
		Stepper(value: value, in: range, step: step) {
			LabeledContent(title) {
				if value.wrappedValue == 0, let zero { Text(zero).foregroundStyle(DS.Palette.textSecondary) }
				else { Text(unit.isEmpty ? "\(value.wrappedValue)" : "\(value.wrappedValue) \(unit)").monospacedDigit() }
			}
		}
	}

	private func flag(_ kp: KeyPath<LearningSettings, Bool>, _ key: String) -> Binding<Bool> {
		Binding(get: { settings?[keyPath: kp] ?? false }, set: { patchNow([key: .bool($0)]) })
	}

	private func changed(_ key: String, _ v: Int, _ server: Int?) {
		if synced, v != server { patch([key: .number(Double(v))]) }
	}

	/// Значения — с сервера; свои правки не затираются, пока совпадают с отправленными.
	private func syncFromServer() {
		guard let s = settings, !queue.isBusy else { return }
		synced = false
		agents = s.maxAgents; idle = s.idleMin; retry = s.retrySec; stall = s.stallMin
		events = s.blockEvents; chars = s.blockChars; archive = s.archiveDays
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
