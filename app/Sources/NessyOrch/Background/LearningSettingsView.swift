import SwiftUI
import NessyKit

/// Вкладка «Фон» окна настроек приложения (спека §6): форма как в `Settings.swift`; каждое изменение уходит в `PATCH /learning/settings`.
struct LearningSettingsView: View {
	@Environment(AppModel.self) private var model
	@State private var interval = 10
	@State private var idle = 60
	@State private var agents = 2
	@State private var synced = false
	@State private var backfillOpen = false
	/// правки идут по одной очереди: последнее значение побеждает, быстрые нажатия степпера сливаются (400 мс)
	@State private var queue = SettingsPatchQueue()

	private var learning: LearningStore { model.store.learning }
	private var settings: LearningSettings? { learning.settings }
	/// папка данных — как её отдаёт сервер (`status().home`)
	private var home: String { model.store.serverHome ?? NSHomeDirectory() + "/.nessy-orch" }

	var body: some View {
		Form {
			Section {
				Toggle("Фоновое обучение", isOn: flag(\.enabled, "enabled"))
				Toggle("Авто-ревью", isOn: flag(\.autoReview, "autoReview"))
			} footer: {
				Text("Без авто-ревью плейбуки и правки ждут вас во вкладке «Ревью».").foregroundStyle(DS.Palette.textSecondary)
			}
			Section {
				Stepper(value: $interval, in: 1...120) { LabeledContent("Интервал описания сессии", value: "\(interval) мин") }
				Stepper(value: $idle, in: 5...1440, step: 5) { LabeledContent("Сессия закончена после простоя", value: "\(idle) мин") }
				Stepper(value: $agents, in: 1...6) { LabeledContent("Фоновых агентов одновременно", value: "\(agents)") }
			}
			Section {
				let off = settings?.disabledSessions ?? []
				if off.isEmpty {
					Text("Нет").foregroundStyle(DS.Palette.textSecondary)
				}
				ForEach(off, id: \.self) { id in
					LabeledContent {
						Button("Включить обратно") { patchNow(["disabledSessions": .array(off.filter { $0 != id }.map { .string($0) })]) }
					} label: { Text(sessionTitle(id)).lineLimit(1) }
				}
			} header: { Text("Сессии без обучения") }
			Section {
				Button("Разобрать прошлые сессии…") { backfillOpen = true }
			} footer: {
				Text("Кейсы из уже закончившихся сессий и транскриптов: список кандидатов, вы отмечаете нужные.").foregroundStyle(DS.Palette.textSecondary)
			}
			Section {
				pathRow("learning.json", home + "/learning.json")
				pathRow("Кейсы", home + "/cases")
			} header: { Text("Где лежит") }
		}
		.formStyle(.grouped)
		.sheet(isPresented: $backfillOpen) { BackfillSheet() }
		.onAppear { configureQueue(); syncFromServer() }
		.onDisappear { Task { await queue.flush() } }
		.onChange(of: settings) { _, _ in syncFromServer() }
		.onChange(of: interval) { _, v in if synced, v != settings?.intervalMin { patch(["intervalMin": .number(Double(v))]) } }
		.onChange(of: idle) { _, v in if synced, v != settings?.idleMin { patch(["idleMin": .number(Double(v))]) } }
		.onChange(of: agents) { _, v in if synced, v != settings?.maxAgents { patch(["maxAgents": .number(Double(v))]) } }
	}

	private func flag(_ kp: KeyPath<LearningSettings, Bool>, _ key: String) -> Binding<Bool> {
		Binding(get: { settings?[keyPath: kp] ?? false }, set: { patchNow([key: .bool($0)]) })
	}

	/// Значения степперов — с сервера; свои правки не затираются, пока совпадают с отправленными.
	private func syncFromServer() {
		guard let s = settings, !queue.isBusy else { return }
		synced = false
		interval = s.intervalMin; idle = s.idleMin; agents = s.maxAgents
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

	private func sessionTitle(_ id: String) -> String {
		let t = model.store.session(id)?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return t.isEmpty ? id : t
	}

	private func pathRow(_ name: String, _ path: String) -> some View {
		LabeledContent(name) {
			HStack(spacing: DS.Metrics.s2) {
				Text(path.replacingOccurrences(of: NSHomeDirectory(), with: "~")).font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textSecondary)
					.lineLimit(1).truncationMode(.middle).textSelection(.enabled)
				Button("Показать в Finder") {
					let url = URL(fileURLWithPath: path)
					if FileManager.default.fileExists(atPath: path) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
					else { NSWorkspace.shared.open(url.deletingLastPathComponent()) }
				}
			}
		}
	}
}
