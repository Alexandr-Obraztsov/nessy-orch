import SwiftUI
import NessyKit

/// Карточка плейбука (спека §5): шапка, вкладки-разделы (Обзор, Кейсы, Правила, Заметки, Ревью, История) и чат с агентом-редактором.
struct PlaybookCard: View {
	@Environment(AppModel.self) private var model
	var id: String
	@State private var tab: PlaybookTab = .overview
	@State private var detail: PlaybookDetail?
	@State private var session: PlaybookEditSession?
	@State private var askDelete = false
	@State private var tabChosen = false

	private var learning: LearningStore { model.store.learning }
	private var playbook: PlaybookView? { learning.playbook(id) }

	var body: some View {
		if let p = playbook {
			let s = session ?? PlaybookEditSession(p)
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s4) {
					header(p)
					Picker("Раздел", selection: $tab) {
						ForEach(PlaybookTab.allCases, id: \.self) { Text(label($0, p)).tag($0) }
					}
					.pickerStyle(.segmented).labelsHidden()
					if s.editing, tab == .overview || tab == .rules { PlaybookEditBar(playbook: p, session: s) }
					content(p, s)
					LearningChat(subject: p.id).padding(.top, DS.Metrics.s3)
				}
				.padding(DS.Metrics.s5)
				.frame(maxWidth: 820, alignment: .leading)
				.frame(maxWidth: .infinity)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
			.task(id: loadKey(p)) { await reload() }
			.onAppear {
				if session == nil { session = s }
				if !tabChosen, PlaybookEditing.isWaiting(p) { tab = .review }
			}
			.confirmationDialog(PlaybookEditing.deleteTitle(p), isPresented: $askDelete) {
				Button("Удалить", role: .destructive) { delete(p) }
			} message: { Text(PlaybookEditing.deleteConfirm) }
		}
	}

	/// Подпись вкладки: у «Ревью» — сколько решений ждёт.
	private func label(_ t: PlaybookTab, _ p: PlaybookView) -> String {
		guard t == .review else { return t.title }
		let n = p.pendingEdits.count + (p.status == .review ? 1 : 0)
		return n > 0 ? "\(t.title) · \(n)" : t.title
	}

	/// Когда перечитывать подробности: новая версия, статус, правки, закончившееся ревью.
	private func loadKey(_ p: PlaybookView) -> String {
		let done = learning.jobs.filter { $0.subject == p.id && $0.status == .done }.count
		return "\(p.id)-\(p.version)-\(p.status.rawValue)-\(p.pendingEdits.count)-\(p.updatedAt)-\(done)"
	}

	private func reload() async {
		if let d = try? await model.store.client.playbookDetail(id) { detail = d }
	}

	// MARK: шапка

	private func header(_ p: PlaybookView) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			CardHeader(p.title, subtitle: [LearningText.playbookStatus(p.status), "v\(p.version)", p.taskType].filter { !$0.isEmpty }.joined(separator: " · ")) {
				if let t = PlaybookEditing.toggleStatus(p) {
					Button(t.title) { Task { await model.run("Статус не изменён") { _ = try await model.store.client.setPlaybookStatus(p.id, t.to) } } }
				}
				Button("Удалить") { askDelete = true }
			}
			if let line = PlaybookEditing.trialLine(p) {
				Text("Пробный режим: \(line)" + (PlaybookEditing.trialAverage(p).map { String(format: " · поправок на кейс %.1f (до плейбука %.1f)", $0, p.trial?.before ?? 0) } ?? ""))
					.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			}
		}
		.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline)
	}

	private func delete(_ p: PlaybookView) {
		Task {
			await model.run("Плейбук не удалён") {
				try await model.store.client.deletePlaybook(p.id)
				await MainActor.run { model.background.go(.playbooks) }
			}
		}
	}

	// MARK: содержимое

	@ViewBuilder private func content(_ p: PlaybookView, _ s: PlaybookEditSession) -> some View {
		switch tab {
		case .overview:
			if s.editing { OverviewEditor(session: s) } else { OverviewTab(playbook: p) { s.begin(p) } }
		case .cases: CasesTab(playbook: p)
		case .rules: RulesTab(playbook: p, session: s)
		case .notes: NotesTab(playbook: p, detail: detail, reload: reload)
		case .review: PlaybookReviewTab(playbook: p, detail: detail)
		case .history: HistoryTab(playbook: p, detail: detail)
		}
	}
}

// MARK: - Обзор

private struct OverviewTab: View {
	var playbook: PlaybookView
	var edit: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			HStack {
				Text("Когда применять").font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: 0)
				Button(action: edit) { Label("Править", systemImage: "pencil") }.buttonStyle(SettingsButtonStyle())
			}
			.padding(.bottom, -DS.Metrics.s3)
			LongText(playbook.description.isEmpty ? "Описание не задано." : playbook.description, lines: 6)
			if !playbook.params.isEmpty {
				section("Параметры") {
					ForEach(playbook.params) { p in
						HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
							Text(p.name).font(DS.Typography.mono)
							Text(p.description).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
							if !p.source.isEmpty { LearningChip(p.source) }
						}
					}
				}
			}
			if !playbook.sources.isEmpty { section("Источники") { SourceChips(sources: playbook.sources) } }
			if !playbook.files.isEmpty {
				section("Ключевые файлы") { ForEach(playbook.files, id: \.self) { Text($0).font(DS.Typography.mono).textSelection(.enabled) } }
			}
			if !playbook.behavior.isEmpty {
				section("Как себя вести") {
					ForEach(Array(playbook.behavior.enumerated()), id: \.offset) { _, b in
						Text("· " + b).font(DS.Typography.secondary).textSelection(.enabled)
					}
				}
			}
			section("Этапы") {
				if playbook.stages.isEmpty { Text("Этапов нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary) }
				ForEach(playbook.stages) { stage($0) }
			}
		}
	}

	private func section<C: View>(_ title: String, @ViewBuilder _ body: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(title).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
			body()
		}
	}

	private func stage(_ s: PlaybookStage) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(spacing: DS.Metrics.s2) {
				Text("\(s.n). \(s.title)").font(DS.Typography.agentName)
				if s.gate { LearningChip("гейт: показать вам", systemImage: "hand.raised", tint: DS.Palette.accentText) }
				if let r = s.role, !r.isEmpty { LearningChip(r, mono: true) }
				Spacer(minLength: 0)
			}
			ForEach([("где", s.where), ("выдаёт", s.produce), ("готово, когда", s.done)].filter { !$0.1.isEmpty }, id: \.0) { k, v in
				HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
					Text(k).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 90, alignment: .leading)
					Text(v).font(DS.Typography.secondary).textSelection(.enabled)
				}
			}
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}
}

// MARK: - Кейсы

private struct CasesTab: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			group("Кейсы сборки", playbook.cases, note: "По ним собран плейбук.")
			if let h = playbook.heldOut { group("Отложенный кейс", [h], note: "Не входил в сборку: на нём ревью сравнивало план с плейбуком и без.") }
			if let t = playbook.trial {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					DSGroupHeader(title: "Пробные кейсы", count: t.cases.count)
					Text("Поправок на кейс до плейбука: \(format(t.before)). \(PlaybookEditing.trialLine(playbook) ?? "")").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
					ForEach(Array(t.cases.enumerated()), id: \.offset) { i, c in
						row(c, trailing: i < t.corrections.count ? "поправок: \(format(t.corrections[i]))" : "считаются")
					}
				}
			}
		}
	}

	private func group(_ title: String, _ ids: [String], note: String) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			DSGroupHeader(title: title, count: ids.count)
			Text(note).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			ForEach(ids, id: \.self) { row($0, trailing: nil) }
		}
	}

	private func row(_ id: String, trailing: String?) -> some View {
		Button { model.background.go(.cases, id: id) } label: {
			HStack(spacing: DS.Metrics.s2) {
				Image(systemName: "tray.full").foregroundStyle(DS.Palette.textSecondary)
				Text(model.store.learning.caseView(id).map { model.title(ofCase: $0) } ?? id).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
				Spacer(minLength: 0)
				if let trailing { Text(trailing).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
				Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textTertiary)
			}
			.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
		}
		.buttonStyle(.plain).dsGroup().help("Открыть кейс")
	}

	private func format(_ x: Double) -> String { x == x.rounded() ? String(Int(x)) : String(format: "%.1f", x) }
}

// MARK: - Заметки

private struct NotesTab: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView
	var detail: PlaybookDetail?
	var reload: () async -> Void
	@State private var lines: [String] = []
	@State private var loadedFrom: String?
	@State private var added = ""
	@State private var saving = false

	private var original: [String] { PlaybookEditing.noteLines(detail?.notes ?? "") }
	private var dirty: Bool { PlaybookEditing.notesText(lines) != PlaybookEditing.notesText(original) }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			Text("Постоянные указания к плейбуку: Claude читает их вместе с ним. Агент-редактор дописывает сюда сам.").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			if detail == nil { ProgressView().controlSize(.small) }
			ForEach(lines.indices, id: \.self) { i in
				HStack(spacing: DS.Metrics.s1) {
					TextField("заметка", text: $lines[i], axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
					PlainIconButton(systemImage: "xmark", help: "Удалить", size: 24) { lines.remove(at: i) }
				}
			}
			HStack(spacing: DS.Metrics.s1) {
				TextField("новая заметка", text: $added).textFieldStyle(.roundedBorder).onSubmit(add)
				PlainIconButton(systemImage: "plus", help: "Добавить", size: 24, action: add).disabled(added.trimmingCharacters(in: .whitespaces).isEmpty)
			}
			HStack(spacing: DS.Metrics.s2) {
				Button("Сохранить") { save() }.disabled(!dirty || saving || model.isOffline)
				Button("Отменить") { lines = original }.disabled(!dirty || saving)
				if saving { ProgressView().controlSize(.small) }
			}
			.buttonStyle(SettingsButtonStyle())
		}
		.onAppear { sync() }
		.onChange(of: detail?.notes) { sync() }
	}

	/// Свежий текст с сервера подставляется, пока человек ничего не менял.
	private func sync() {
		guard let d = detail, !dirty || loadedFrom == nil else { return }
		lines = PlaybookEditing.noteLines(d.notes); loadedFrom = d.notes
	}

	private func add() {
		let t = added.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { return }
		lines.append(t); added = ""
	}

	private func save() {
		let text = PlaybookEditing.notesText(lines), client = model.store.client, id = playbook.id
		saving = true
		Task {
			defer { saving = false }
			do {
				try await PlaybookEditing.retryingWhileBusy { try await client.putPlaybookNotes(id, text: text) }
				await reload()
				model.flash("Заметки сохранены")
			} catch { model.flash("Заметки не сохранены: \(error.localizedDescription)", error: true) }
		}
	}
}

// MARK: - История

private struct HistoryTab: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView
	var detail: PlaybookDetail?
	@State private var revert: Int?

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				DSGroupHeader(title: "Версии", count: detail?.versions.count)
				if let d = detail {
					ForEach(d.versions.sorted { $0.version > $1.version }) { v in row(v) }
					if d.versions.isEmpty { Text("Версий пока нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary) }
				} else { ProgressView().controlSize(.small) }
			}
			if let c = detail?.changelog, !c.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					DSGroupHeader(title: "CHANGELOG")
					LongText(c, lines: 12, markdown: true).padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
				}
			}
		}
		.confirmationDialog("Откатить плейбук?", isPresented: Binding(get: { revert != nil }, set: { if !$0 { revert = nil } })) {
			if let v = revert {
				Button("Откатить к v\(v)") { Task { await model.run("Откат не выполнен") { _ = try await model.store.client.revertPlaybook(playbook.id, version: v) } } }
			}
		} message: { Text(PlaybookEditing.revertConfirm(revert ?? 0)) }
	}

	private func row(_ v: PlaybookDetail.Version) -> some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			Text("v\(v.version)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textSecondary).frame(width: 36, alignment: .leading)
			VStack(alignment: .leading, spacing: 2) {
				Text(v.message.isEmpty ? "Без описания" : v.message).font(DS.Typography.secondary).textSelection(.enabled)
				if let t = ISO.parse(v.ts) { Text(t.learningStamp).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
			}
			Spacer(minLength: 0)
			if v.version == playbook.version { LearningChip("текущая") }
			else { Button("Откатить к этой") { revert = v.version }.buttonStyle(SettingsButtonStyle()).disabled(model.isOffline) }
		}
		.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
	}
}
