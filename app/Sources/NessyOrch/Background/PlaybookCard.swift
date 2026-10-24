import SwiftUI
import NessyKit

/// Плейбук в блоке справа: шапка (название, «Одобрить»/«Отклонить» для ревью, «⋯» → «Удалить…») и markdown-документ
/// (просмотр, «Править», «Открыть в окне»).
struct PlaybookCard: View {
	@Environment(AppModel.self) private var model
	var id: String
	@State private var doc: PlaybookDocModel
	@State private var askDelete = false
	@State private var askApprove = false

	init(id: String) { self.id = id; _doc = State(initialValue: PlaybookDocModel(id: id)) }

	private var learning: LearningStore { model.store.learning }
	private var playbook: PlaybookView? { learning.playbook(id) }

	var body: some View {
		if let p = playbook {
			VStack(spacing: 0) {
				header(p)
				PlaybookDocView(doc: doc)
			}
			.task(id: loadKey(p)) { await doc.load(model.store.client) }
			.confirmationDialog(BackgroundLogic.deletePlaybookTitle(p), isPresented: $askDelete) {
				Button("Удалить", role: .destructive) { delete(p) }
			} message: { Text(BackgroundLogic.deletePlaybookMessage) }
			.confirmationDialog("Одобрить плейбук?", isPresented: $askApprove) {
				Button("Одобрить") { Task { await model.run("Плейбук не одобрен") { _ = try await model.store.client.approvePlaybook(p.id) } } }
			} message: { Text(BackgroundLogic.approveMessage(p)) }
		}
	}

	/// Когда перечитывать подробности: новая версия, статус, закончившееся задание.
	private func loadKey(_ p: PlaybookView) -> String {
		let done = learning.jobs.filter { $0.subject == p.id && $0.status == .done }.count
		return "\(p.id)-\(p.version)-\(p.status.rawValue)-\(p.updatedAt)-\(done)"
	}

	private func header(_ p: PlaybookView) -> some View {
		let meta = [p.taskType, LearningText.playbookStatus(p.status), "v\(p.version)", BackgroundLogic.trialLine(p).map { "пробный: \($0)" }]
			.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
		return PanelHeader(p.title, subtitle: meta, onDelete: { askDelete = true }) {
			if p.status == .review {
				Button("Одобрить") { askApprove = true }
				Button("Отклонить") { Task { await model.run("Плейбук не отклонён") { _ = try await model.store.client.rejectPlaybook(p.id) } } }
			}
		}
	}

	private func delete(_ p: PlaybookView) {
		Task {
			await model.run("Плейбук не удалён") {
				try await model.store.client.deletePlaybook(p.id)
				await MainActor.run { model.background.close() }
			}
		}
	}
}
