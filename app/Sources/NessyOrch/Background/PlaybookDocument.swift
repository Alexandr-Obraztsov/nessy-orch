import SwiftUI
import NessyKit

/// Состояние документа плейбука: просмотр или правка, черновик, замечания, конфликт версий. Общее для блока справа и отдельного окна.
@MainActor
@Observable
final class PlaybookDocModel {
	enum Conflict: Equatable { case stale, choose }

	let id: String
	private(set) var detail: PlaybookDetail?
	var editing = false
	var draft = ""
	var lint: [String] = []
	var notice: String?
	var conflict: Conflict?
	/// версия, на которой основан черновик
	private var base = 0
	/// мой текст, пока показана новая версия
	private var mine = ""
	private(set) var saving = false
	private var token = RequestToken()

	init(id: String) { self.id = id }

	var dirty: Bool { editing && draft != (detail?.markdown ?? "") }

	func load(_ client: OrchClient) async {
		let t = token.next()
		let d = try? await client.playbookDetail(id)
		// во время правки документ не подменяется: о новой версии скажет 409 при сохранении
		if token.isCurrent(t), let d, !editing { detail = d }
	}

	func edit() {
		guard let d = detail else { return }
		draft = d.markdown; base = d.view.version
		lint = []; notice = nil; conflict = nil
		editing = true
	}

	func cancel() { editing = false; lint = []; notice = nil; conflict = nil }

	func save(_ client: OrchClient) async {
		guard editing, !saving else { return }
		saving = true
		defer { saving = false }
		notice = nil
		do {
			detail = try await client.savePlaybookMarkdown(id, text: draft, baseVersion: base)
			editing = false; lint = []; conflict = nil
		} catch {
			switch PlaybookDocLogic.outcome(error) {
			case .stale:
				mine = draft
				conflict = .stale
				if let d = try? await client.playbookDetail(id) { detail = d }
			case .lint(let l): lint = l
			case .busy: notice = PlaybookDocLogic.busyMessage
			case .failed(let m): notice = m
			}
		}
	}

	/// «Загрузить новую версию»: черновик сохранён в буфере, показан новый текст.
	func loadNewer() {
		guard let d = detail else { return }
		draft = d.markdown; base = d.view.version
		conflict = .choose
	}

	func useMine() {
		draft = mine; base = detail?.view.version ?? base
		conflict = nil
	}

	func useNewer() {
		draft = detail?.markdown ?? ""; base = detail?.view.version ?? base
		conflict = nil
	}
}

/// Документ плейбука: просмотр (markdown) и правка (моноширинный редактор на весь блок). Сохранение — ⌘S.
struct PlaybookDocView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow
	@Bindable var doc: PlaybookDocModel
	var inWindow = false

	var body: some View {
		VStack(spacing: 0) {
			bar
			if let c = doc.conflict { conflictBar(c) }
			if let n = doc.notice { Text(n).font(DS.Typography.caption).foregroundStyle(DS.Palette.danger).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s2) }
			if doc.editing {
				TextEditor(text: $doc.draft)
					.font(.system(size: 12.5, design: .monospaced)).lineSpacing(2)
					.scrollContentBackground(.hidden)
					.padding(.horizontal, DS.Metrics.s3)
				if !doc.lint.isEmpty { lintList }
			} else if let d = doc.detail, !d.markdown.isEmpty {
				ScrollView {
					MarkdownView(text: d.markdown)
						.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s4)
				}
				.scrollEdgeEffectStyle(.soft, for: .top)
			} else {
				LearningEmptyState(doc.detail == nil ? "Загружаю…" : "Документ недоступен").frame(maxHeight: .infinity)
			}
		}
	}

	private var bar: some View {
		HStack(spacing: DS.Metrics.s2) {
			Spacer(minLength: 0)
			if doc.editing {
				Button("Отмена") { doc.cancel() }.keyboardShortcut(.cancelAction)
				Button("Сохранить") { Task { await doc.save(model.store.client) } }
					.keyboardShortcut("s", modifiers: .command)
					.disabled(!doc.dirty || doc.saving)
			} else {
				Button("Править") { doc.edit() }.disabled(doc.detail == nil || model.isOffline)
				if !inWindow { Button("Открыть в окне") { openWindow(id: "playbook", value: doc.id) } }
			}
		}
		.buttonStyle(SettingsButtonStyle())
		.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s2)
	}

	private func conflictBar(_ c: PlaybookDocModel.Conflict) -> some View {
		HStack(spacing: DS.Metrics.s2) {
			Text(c == .stale ? "Плейбук изменился" : "Загружена новая версия").font(DS.Typography.secondary)
			Spacer(minLength: 0)
			if c == .stale {
				Button("Загрузить новую версию") { doc.loadNewer() }
			} else {
				Button("Мой вариант") { doc.useMine() }
				Button("Новая версия") { doc.useNewer() }
			}
		}
		.buttonStyle(SettingsButtonStyle())
		.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s2)
	}

	private var lintList: some View {
		VStack(alignment: .leading, spacing: 2) {
			ForEach(Array(doc.lint.enumerated()), id: \.offset) { _, l in
				Text(l).font(DS.Typography.caption).foregroundStyle(DS.Palette.danger).textSelection(.enabled)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
	}
}

/// Отдельное окно плейбука (образец — «Роли»): слева документ и инструменты `tools/*`, справа содержимое; инструменты — только просмотр.
struct PlaybookWindow: View {
	@Environment(AppModel.self) private var model
	var id: String?

	var body: some View {
		if let id { PlaybookWindowBody(id: id).id(id) }
		else { LearningEmptyState("Плейбук не выбран") }
	}
}

private struct PlaybookWindowBody: View {
	@Environment(AppModel.self) private var model
	@State private var doc: PlaybookDocModel
	@State private var selected = "SKILL.md"

	init(id: String) { _doc = State(initialValue: PlaybookDocModel(id: id)) }

	private var title: String { model.store.learning.playbook(doc.id)?.title ?? "Плейбук" }

	var body: some View {
		let entries = doc.detail.map(PlaybookDocLogic.entries) ?? [PlaybookDocLogic.Entry(path: "SKILL.md", title: "Документ", isDocument: true)]
		NavigationSplitView {
			List(selection: Binding<String?>(get: { selected }, set: { if let s = $0 { selected = s } })) {
				ForEach(entries) { e in
					Label(e.title, systemImage: e.isDocument ? "doc.text" : "terminal")
						.font(e.isDocument ? .body : DS.Typography.mono)
						.tag(e.path)
				}
			}
			.listStyle(.sidebar)
			.navigationSplitViewColumnWidth(min: 170, ideal: 200, max: 260)
		} detail: {
			if selected == "SKILL.md" || doc.detail == nil {
				PlaybookDocView(doc: doc, inWindow: true)
			} else if let d = doc.detail {
				ScrollView([.vertical, .horizontal]) {
					Text(PlaybookDocLogic.toolText(d, path: selected))
						.font(.system(size: 12.5, design: .monospaced)).textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading).padding(DS.Metrics.s4)
				}
			}
		}
		.navigationTitle(title)
		.frame(minWidth: 700, minHeight: 440)
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.task(id: model.store.learning.playbook(doc.id)?.updatedAt) { await doc.load(model.store.client) }
	}
}
