import SwiftUI
import NessyKit

/// Обучение в шапке панели сессии (спека §5): чип плейбука (если по кейсу сессии он есть) и меню «⋯».
struct SessionLearningControls: View {
	@Environment(AppModel.self) private var model
	var session: String
	@State private var impact: CaseImpact?
	@State private var askDelete = false

	private var learning: LearningStore { model.store.learning }
	private var caseView: CaseView? { learning.caseOf(session: session) }

	var body: some View {
		if learning.available, learning.loaded {
			HStack(spacing: DS.Metrics.s1) {
				if let p = learning.playbookOf(session: session) { chip(p) }
				menu
			}
			.confirmationDialog("Удалить кейс сессии?", isPresented: $askDelete) {
				Button("Удалить кейс", role: .destructive) { if let c = caseView { Task { await model.run("Кейс не удалён") { try await model.store.client.deleteCase(c.id) } } } }
			} message: { Text(impactText) }
		}
	}

	private func chip(_ p: PlaybookView) -> some View {
		Button { model.openBackground(.playbooks, id: p.id) } label: {
			LearningChip(p.title.isEmpty ? p.name : p.title, systemImage: "book.closed", tint: DS.Palette.accentText)
				.frame(maxWidth: 140)
		}
		.buttonStyle(.plain)
		.help("Плейбук «\(p.title)», версия \(p.version). Загружен Claude в этой сессии.")
	}

	private var menu: some View {
		let m = JournalLogic.SessionMenu(settings: learning.settings, caseView: caseView, session: session)
		return Menu {
			Toggle("Учиться на этой сессии", isOn: Binding(get: { m.learnsHere }, set: { learn in
				let list = JournalLogic.toggled(learning.settings?.disabledSessions ?? [], session: session, learn: learn)
				Task { await model.run("Настройка не сохранена") { _ = try await model.store.client.patchLearningSettings(["disabledSessions": .array(list.map { .string($0) })]) } }
			}))
			Divider()
			Button("Собрать кейс сейчас") { act("Кейс не собран") { _ = try await $0.runLearning(session: session) } }.disabled(!m.canRun)
			Button("Пересобрать кейс") { if let c = caseView { act("Кейс не пересобран") { _ = try await $0.rebuildCase(c.id) } } }.disabled(!m.canRebuild)
			Button("Остановить сборщика") { if let c = caseView { act("Сборщик не остановлен") { try await $0.stopCollector(c.id) } } }.disabled(!m.canStop)
			Button("Удалить кейс сессии…") { prepareDelete() }.disabled(!m.canDelete)
			Divider()
			Button("Открыть кейс") { if let c = caseView { model.openBackground(.cases, id: c.id) } }.disabled(!m.canOpen)
		} label: {
			Image(systemName: "ellipsis").font(.system(size: 12, weight: .semibold)).frame(width: 24, height: 24)
		}
		.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
		.tint(DS.Palette.textSecondary)
		.help("Обучение на этой сессии")
	}

	private func act(_ title: String, _ op: @escaping @Sendable (OrchClient) async throws -> Void) {
		Task { await model.run(title) { try await op(model.store.client) }; await learning.refresh() }
	}

	private func prepareDelete() {
		guard let c = caseView else { return }
		Task {
			impact = try? await model.store.client.caseImpact(c.id)
			askDelete = true
		}
	}

	private var impactText: String {
		guard let i = impact, !i.rules.isEmpty else { return "Правила плейбуков не потеряют доказательств." }
		let lost = i.rules.filter { $0.evidenceLeft == 0 }.count
		return "Затронуто правил: \(i.rules.count)" + (lost > 0 ? ", без доказательств останется \(lost)." : ".")
	}
}
