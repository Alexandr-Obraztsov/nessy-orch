import SwiftUI
import NessyKit

// Правка плейбука блоками: черновик (`PlaybookDraft`) живёт в `BackgroundNav` по id плейбука и уходит одним `PATCH` по «Сохранить».

private struct PlaybookGone: LocalizedError { var errorDescription: String? { "Плейбук удалён" } }

/// Состояние правки карточки: общее для «Обзора» и «Правил».
@MainActor
@Observable
final class PlaybookEditSession {
	var editing = false
	var draft: PlaybookDraft
	var saving = false
	/// замечания lint сервера: показываются под панелью сохранения
	var lint: [String] = []
	/// «Плейбук занят…» пока идёт автоповтор
	var waiting: String?
	/// после 409 `stale`: «плейбук обновился, ваши правки перенесены — сохранить?»
	var notice: String?
	/// поля, изменённые и вами, и на сервере: по каждому выбор «оставить мои / взять новые»
	var conflicts: [PlaybookField] = []
	/// конфликты правил: подписи
	var ruleNotes: [String] = []
	/// свежая версия, на которую перенесены правки (откуда берутся «новые» поля)
	private var fresh: PlaybookView?

	init(_ p: PlaybookView) { draft = PlaybookDraft(p) }

	var isDirty: Bool { editing && draft.isDirty() }

	func begin(_ p: PlaybookView) {
		if !editing { draft = PlaybookDraft(p) }
		lint = []; waiting = nil; clearRebase()
		editing = true
	}

	func cancel(_ p: PlaybookView) {
		editing = false; draft = PlaybookDraft(p); lint = []; waiting = nil; clearRebase()
	}

	private func clearRebase() { notice = nil; conflicts = []; ruleNotes = []; fresh = nil }

	func keepMine(_ f: PlaybookField) { conflicts.removeAll { $0 == f } }

	func takeNew(_ f: PlaybookField) {
		if let fresh { draft.take(f, from: fresh) }
		conflicts.removeAll { $0 == f }
	}

	func save(_ model: AppModel, _ p: PlaybookView) async {
		guard draft.patch() != nil else { editing = false; return }
		saving = true; lint = []; waiting = nil; clearRebase()
		defer { saving = false; waiting = nil }
		let client = model.store.client, id = p.id
		let outcome = await PlaybookSaving.save(draft,
			send: { _ = try await client.patchPlaybook(id, $0) },
			fetch: {
				guard let f = try await client.playbooks().first(where: { $0.id == id }) else { throw PlaybookGone() }
				return f
			},
			onWait: { [weak self] n in Task { @MainActor in self?.waiting = "Плейбук занят фоновым агентом, повторяю (\(n))…" } })
		switch outcome {
		case .saved:
			editing = false
			model.flash("Плейбук обновлён")
		case .unchanged:
			editing = false
		case .lint(let l):
			lint = l
		case .busy:
			model.flash("Плейбук занят: правки остались в черновике, сохраните позже", error: true)
		case .rebased(let r):
			draft = r.draft; fresh = r.fresh; conflicts = r.fields; ruleNotes = r.ruleNotes
			notice = r.fields.isEmpty
				? "Плейбук обновился, ваши правки перенесены — сохранить?"
				: "Плейбук обновился, и вы правили то же, что и другие. По каждому полю выберите, чьё оставить."
		case .failed(let m):
			model.flash("Правка не сохранена: \(m)", error: true)
		}
	}
}

/// Панель над содержимым в режиме правки: «Сохранить», «Отменить», перенос на новую версию, замечания lint.
struct PlaybookEditBar: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView
	var session: PlaybookEditSession

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(spacing: DS.Metrics.s2) {
				Text(session.isDirty ? "Есть несохранённые правки" : "Режим правки").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: 0)
				if session.saving { ProgressView().controlSize(.small) }
				Button("Отменить") { session.cancel(playbook) }.disabled(session.saving)
				Button("Сохранить") { Task { await session.save(model, playbook) } }
					.disabled(session.saving || !session.isDirty || !session.conflicts.isEmpty || model.isOffline)
			}
			.buttonStyle(SettingsButtonStyle())
			if let w = session.waiting { Text(w).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
			if let n = session.notice {
				Label(n, systemImage: "arrow.triangle.2.circlepath").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
			}
			ForEach(session.conflicts, id: \.self) { f in
				HStack(spacing: DS.Metrics.s2) {
					Text(f.label).font(DS.Typography.secondary.weight(.semibold))
					Spacer(minLength: 0)
					Button("Оставить мои") { session.keepMine(f) }
					Button("Взять новые") { session.takeNew(f) }
				}
				.buttonStyle(SettingsButtonStyle())
			}
			ForEach(Array(session.ruleNotes.enumerated()), id: \.offset) { _, l in
				Label(l, systemImage: "exclamationmark.circle").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			}
			ForEach(Array(session.lint.enumerated()), id: \.offset) { _, l in
				Label(l, systemImage: "exclamationmark.triangle").font(DS.Typography.caption).foregroundStyle(DS.Palette.danger).textSelection(.enabled)
			}
		}
		.padding(DS.Metrics.s3)
		.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
	}
}

// MARK: - редакторы блоков

/// Подпись блока и поле, одинаковые в редакторах.
private func blockTitle(_ t: String) -> some View {
	Text(t).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
}

/// Список строк (источники, файлы, пункты поведения): правка на месте, ▲▼, удалить, добавить.
struct StringListEditor: View {
	var title: String
	var placeholder: String
	@Binding var items: [String]
	@State private var added = ""

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			blockTitle(title)
			ForEach(items.indices, id: \.self) { i in
				HStack(spacing: DS.Metrics.s1) {
					TextField(placeholder, text: $items[i], axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
					rowButtons(i)
				}
			}
			HStack(spacing: DS.Metrics.s1) {
				TextField(placeholder, text: $added).textFieldStyle(.roundedBorder).onSubmit(add)
				PlainIconButton(systemImage: "plus", help: "Добавить", size: 24, action: add).disabled(added.trimmingCharacters(in: .whitespaces).isEmpty)
			}
		}
	}

	private func rowButtons(_ i: Int) -> some View {
		HStack(spacing: 0) {
			PlainIconButton(systemImage: "chevron.up", help: "Выше", size: 24) { PlaybookDraft.move(&items, at: i, by: -1) }.disabled(i == 0)
			PlainIconButton(systemImage: "chevron.down", help: "Ниже", size: 24) { PlaybookDraft.move(&items, at: i, by: 1) }.disabled(i == items.count - 1)
			PlainIconButton(systemImage: "xmark", help: "Удалить", size: 24) { items.remove(at: i) }
		}
	}

	private func add() {
		let t = added.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { return }
		items.append(t); added = ""
	}
}

/// Параметры: имя, описание, откуда брать.
struct ParamsEditor: View {
	@Binding var params: [PlaybookParam]

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			blockTitle("Параметры")
			ForEach(params.indices, id: \.self) { i in
				HStack(spacing: DS.Metrics.s1) {
					TextField("имя", text: $params[i].name).textFieldStyle(.roundedBorder).frame(width: 120)
					TextField("что это", text: $params[i].description).textFieldStyle(.roundedBorder)
					TextField("откуда", text: $params[i].source).textFieldStyle(.roundedBorder).frame(width: 110)
					PlainIconButton(systemImage: "xmark", help: "Удалить параметр", size: 24) { params.remove(at: i) }
				}
			}
			Button { params.append(PlaybookParam(name: "")) } label: { Label("Добавить параметр", systemImage: "plus") }
				.buttonStyle(SettingsButtonStyle())
		}
	}
}

/// Этапы: название, где, что выдаёт, когда готово, гейт, роль; добавить, удалить, переставить.
struct StagesEditor: View {
	@Binding var draft: PlaybookDraft
	@State private var added = ""

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			blockTitle("Этапы")
			ForEach(draft.stages.indices, id: \.self) { i in
				VStack(alignment: .leading, spacing: DS.Metrics.s1) {
					HStack(spacing: DS.Metrics.s1) {
						Text("\(i + 1)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary).frame(width: 18)
						TextField("название этапа", text: $draft.stages[i].title).textFieldStyle(.roundedBorder)
						Toggle("гейт", isOn: $draft.stages[i].gate).toggleStyle(.checkbox).font(DS.Typography.caption).help("Перед этапом показать результат вам")
						PlainIconButton(systemImage: "chevron.up", help: "Выше", size: 24) { draft.moveStage(at: i, by: -1) }.disabled(i == 0)
						PlainIconButton(systemImage: "chevron.down", help: "Ниже", size: 24) { draft.moveStage(at: i, by: 1) }.disabled(i == draft.stages.count - 1)
						PlainIconButton(systemImage: "xmark", help: "Удалить этап", size: 24) { draft.removeStage(at: i) }
					}
					Group {
						TextField("где выполняется", text: $draft.stages[i].where)
						TextField("что выдаёт", text: $draft.stages[i].produce)
						TextField("когда готово", text: $draft.stages[i].done)
					}
					.textFieldStyle(.roundedBorder).font(DS.Typography.caption).padding(.leading, 22)
				}
				.padding(DS.Metrics.s2)
				.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			}
			HStack(spacing: DS.Metrics.s1) {
				TextField("новый этап", text: $added).textFieldStyle(.roundedBorder).onSubmit(add)
				PlainIconButton(systemImage: "plus", help: "Добавить этап", size: 24, action: add).disabled(added.trimmingCharacters(in: .whitespaces).isEmpty)
			}
		}
	}

	private func add() {
		let t = added.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { return }
		draft.addStage(title: t); added = ""
	}
}

/// Все редакторы «Обзора» в одном блоке.
struct OverviewEditor: View {
	@Bindable var session: PlaybookEditSession

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				blockTitle("Название")
				TextField("название", text: $session.draft.title).textFieldStyle(.roundedBorder)
				blockTitle("Когда применять")
				TextField("Use when …", text: $session.draft.description, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...8)
			}
			ParamsEditor(params: $session.draft.params)
			StringListEditor(title: "Источники", placeholder: "wiki, gitlab, …", items: $session.draft.sources)
			StringListEditor(title: "Ключевые файлы", placeholder: "путь или имя файла", items: $session.draft.files)
			StringListEditor(title: "Как себя вести", placeholder: "пункт поведения", items: $session.draft.behavior)
			StagesEditor(draft: $session.draft)
		}
	}
}

// MARK: - вкладка «Правила»

/// Правила: активные, кандидаты, архив (свёрнут). Счётчики, этап, доказательства чипами кейсов с якорем; в режиме правки — текст,
/// этап, удаление (= архив) и новое правило.
struct RulesTab: View {
	@Environment(AppModel.self) private var model
	var playbook: PlaybookView
	@Bindable var session: PlaybookEditSession
	@State private var archiveOpen = false
	@State private var newText = ""

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			if session.editing { editBody } else { readBody }
		}
	}

	// MARK: чтение

	private func rules(_ s: RuleStatus) -> [RuleView] { playbook.rules.filter { $0.status == s } }

	private var readBody: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			HStack {
				Text("Правило включает судья по кейсам; текст можно править вручную.").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: 0)
				Button { session.begin(playbook) } label: { Label("Править правила", systemImage: "pencil") }.buttonStyle(SettingsButtonStyle())
			}
			ruleGroup("Активные", rules(.active))
			ruleGroup("Кандидаты", rules(.candidate))
			let archived = rules(.archived)
			if !archived.isEmpty {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					DSGroupHeader(title: "Архив", count: archived.count, expanded: $archiveOpen)
					if archiveOpen { ForEach(archived) { RuleReadRow(rule: $0, stageTitle: stageTitle($0.stage)).opacity(0.65) } }
				}
			}
			if playbook.rules.isEmpty { Text("Правил пока нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary) }
		}
	}

	@ViewBuilder private func ruleGroup(_ title: String, _ list: [RuleView]) -> some View {
		if !list.isEmpty {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				DSGroupHeader(title: title, count: list.count)
				ForEach(list) { RuleReadRow(rule: $0, stageTitle: stageTitle($0.stage)) }
			}
		}
	}

	private func stageTitle(_ n: Int?) -> String? {
		guard let n, let s = playbook.stages.first(where: { $0.n == n }) else { return nil }
		return "\(n). \(s.title)"
	}

	// MARK: правка

	private var editBody: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			Text("Удалённое правило уходит в архив; новое станет кандидатом и пройдёт проверку судьёй.").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			ForEach($session.draft.rules) { $r in
				RuleEditRow(draft: $r, stages: session.draft.stages, view: playbook.rules.first { $0.id == r.ruleId }) { session.draft.removeRule(key: r.key) }
			}
			HStack(spacing: DS.Metrics.s1) {
				TextField("новое правило", text: $newText, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
				PlainIconButton(systemImage: "plus", help: "Добавить правило", size: 24, action: add).disabled(newText.trimmingCharacters(in: .whitespaces).isEmpty)
			}
		}
	}

	private func add() {
		let t = newText.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { return }
		session.draft.addRule(text: t); newText = ""
	}
}

/// Счётчики ▲▼ правила.
private struct RuleCounters: View {
	var rule: RuleView
	var body: some View {
		Text("▲\(rule.up) ▼\(rule.down)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary)
	}
}

/// Доказательства правила: кейс (клик — карточка кейса) и якорь (клик — события сессии); «против» отдельной строкой.
private struct EvidenceChips: View {
	@Environment(AppModel.self) private var model
	var rule: RuleView

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			line("за", rule.evidence)
			line("против", rule.against)
		}
	}

	@ViewBuilder private func line(_ label: String, _ list: [Evidence]) -> some View {
		if !list.isEmpty {
			FlowLayout(spacing: DS.Metrics.s1) {
				Text(label).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
				ForEach(list) { e in
					HStack(spacing: 2) {
						Button { model.background.go(.cases, id: e.caseId) } label: { LearningChip(caseName(e.caseId), systemImage: "tray.full") }
							.buttonStyle(.plain).help("Открыть кейс")
						if let a = AnchorButton(caseId: e.caseId, anchor: e.anchor) { a } else if !e.anchor.isEmpty { LearningChip(e.anchor, mono: true) }
					}
				}
			}
		}
	}

	private func caseName(_ id: String) -> String {
		model.store.learning.caseView(id).map { model.title(ofCase: $0) } ?? id
	}
}

private struct RuleReadRow: View {
	var rule: RuleView
	var stageTitle: String?

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(rule.text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
			HStack(spacing: DS.Metrics.s2) {
				LearningChip(stageTitle.map { "этап \($0)" } ?? "без этапа")
				RuleCounters(rule: rule)
				if let t = ISO.parse(rule.lastAppliedAt) { Text("применялось \(t.learningStamp)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
				Spacer(minLength: 0)
			}
			EvidenceChips(rule: rule)
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsGroup()
	}
}

private struct RuleEditRow: View {
	@Binding var draft: RuleDraft
	var stages: [PlaybookStage]
	var view: RuleView?
	var remove: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(alignment: .top, spacing: DS.Metrics.s1) {
				TextField("текст правила", text: $draft.text, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...6)
				PlainIconButton(systemImage: "xmark", help: draft.ruleId == nil ? "Убрать" : "В архив", size: 24, action: remove)
			}
			HStack(spacing: DS.Metrics.s2) {
				Picker("Этап", selection: $draft.stage) {
					Text("без этапа").tag(Int?.none)
					ForEach(stages) { s in Text("\(s.n). \(s.title)").tag(Int?.some(s.n)) }
				}
				.labelsHidden().fixedSize()
				if draft.ruleId == nil { LearningChip("новое", tint: DS.Palette.accentText) }
				else if draft.status == .candidate { LearningChip("кандидат") }
				if let view { RuleCounters(rule: view) }
				Spacer(minLength: 0)
			}
			if let view { EvidenceChips(rule: view) }
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsGroup()
	}
}
