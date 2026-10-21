import SwiftUI
import NessyKit

/// Чат объекта обучения (кейса `c-…` или плейбука `p-…`) с агентом-редактором: человек пишет, агент правит описание или плейбук
/// и в ответе перечисляет, что изменил («изменено: …»). Лента — `learning.chats[subject]`, ответ приходит событием `learning_chat`.
struct LearningChat: View {
	@Environment(AppModel.self) private var model
	var subject: String
	@State private var draft = ""
	@State private var sending = false

	private var learning: LearningStore { model.store.learning }
	private var messages: [ChatMessage] { learning.chats[subject] ?? [] }
	/// агент-редактор сейчас правит объект: задание `edit` стоит или идёт
	private var editing: Bool { learning.jobs.contains { $0.kind == .edit && $0.subject == subject && ($0.status == .queued || $0.status == .running) } }
	private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isOffline && !sending }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			DSGroupHeader(title: "Чат с агентом-редактором", count: messages.isEmpty ? nil : messages.count)
			VStack(alignment: .leading, spacing: DS.Metrics.s3) {
				if messages.isEmpty && !editing {
					Text("Напишите, что поправить: агент изменит описание или плейбук. Постоянные указания («всегда проверяй X») он запишет в заметки.")
						.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
				ForEach(messages) { m in message(m) }
				if editing {
					HStack(spacing: DS.Metrics.s2) {
						ProgressView().controlSize(.small)
						Text("Агент правит…").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					}
				}
				composer
			}
			.padding(DS.Metrics.s3)
			.frame(maxWidth: .infinity, alignment: .leading)
			.dsGroup()
		}
		.task(id: subject) { await learning.loadChat(subject) }
	}

	@ViewBuilder private func message(_ m: ChatMessage) -> some View {
		if m.from == .user {
			Text(m.text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
				.padding(DS.Metrics.s3)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous))
		} else {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				MarkdownView(text: m.text)
				if !m.changes.isEmpty {
					Label("изменено: " + m.changes.joined(separator: "; "), systemImage: "pencil")
						.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				}
			}
		}
	}

	private var composer: some View {
		HStack(alignment: .bottom, spacing: DS.Metrics.s2) {
			TextField("Написать агенту-редактору…", text: $draft, axis: .vertical)
				.textFieldStyle(.plain).font(DS.Typography.secondary).lineLimit(1...5)
				.onSubmit(send)
				.padding(.vertical, DS.Metrics.s1)
			PlainIconButton(systemImage: "arrow.up", help: model.isOffline ? "Нет связи" : "Отправить (↩)", size: 28, filled: true, action: send)
				.disabled(!canSend)
		}
		.padding(.leading, DS.Metrics.s3).padding(.trailing, DS.Metrics.s2).padding(.vertical, DS.Metrics.s1)
		.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous))
	}

	private func send() {
		guard canSend else { return }
		let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
		draft = ""
		sending = true
		Task {
			defer { sending = false }
			do { try await learning.sendChat(subject, text: text) }
			catch {
				if draft.isEmpty { draft = text }
				model.flash("Сообщение не отправлено: \(error.localizedDescription)", error: true)
			}
		}
	}
}
