import SwiftUI
import NessyKit

/// Карточка кейса (спека §5): шапка с действиями, описание по целям (таблица действий, источники, поправки, вопросы),
/// правка описания и заметок, чат с агентом-редактором. Пока кейс собирается, описание перечитывается по событиям `learning_case`.
struct CaseCard: View {
	@Environment(AppModel.self) private var model
	var item: CaseView

	@State private var detail: CaseDetail?
	@State private var parsed = CaseSummary()
	@State private var loadFailure: String?
	@State private var token = RequestToken()
	@State private var saving = false
	/// сборщик занят: черновик остаётся, сохранение повторится, когда по кейсу не будет работы
	@State private var waiting = false
	@State private var impact: CaseImpact?
	@State private var impactFailed = false
	@State private var confirmDelete = false

	private var learning: LearningStore { model.store.learning }
	private var client: OrchClient { model.store.client }
	/// черновики живут в `BackgroundNav` по id кейса
	private var draft: CaseDraftState { model.background.caseDraft(item.id) }
	private var building: Bool { item.status == .collecting || item.status == .closing }

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s5) {
				header
				meta
				if building { banner }
				summarySection
				notesSection
				LearningChat(subject: item.id)
			}
			.padding(DS.Metrics.s5)
			.frame(maxWidth: 820, alignment: .leading)
			.frame(maxWidth: .infinity)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.task(id: "\(item.id)|\(item.updatedAt)|\(item.coveredUntil)|\(item.status)") { await load() }
		.task(id: waiting) {
			while waiting && !Task.isCancelled {
				try? await Task.sleep(for: .seconds(4))
				if waiting, CaseEditing.canRetry(jobs: learning.jobs, caseId: item.id) { await save() }
			}
		}
		.onChange(of: learning.jobs) { _, jobs in
			if waiting, CaseEditing.canRetry(jobs: jobs, caseId: item.id) { Task { await save() } }
		}
		.confirmationDialog("Удалить кейс «\(model.title(ofCase: item))»?", isPresented: $confirmDelete, titleVisibility: .visible) {
			Button("Удалить", role: .destructive) { delete() }
			Button("Отмена", role: .cancel) {}
		} message: {
			Text(CaseDeleteText.message(impact: impact, failed: impactFailed))
		}
	}

	// MARK: шапка

	private var header: some View {
		CardHeader(model.title(ofCase: item), subtitle: subtitle) {
			Button("Пересобрать") { act("Пересборка") { _ = try await client.rebuildCase(item.id) } }
				.disabled(model.isOffline || building)
			if building {
				Button("Остановить сборщика") { act("Остановка") { try await client.stopCollector(item.id) } }
					.disabled(model.isOffline)
			}
			Button("Удалить…", role: .destructive) { askDelete() }.disabled(model.isOffline)
		}
		.buttonStyle(SettingsButtonStyle())
	}

	private var subtitle: String {
		var p = [LearningText.caseStatus(item.status)]
		if item.source == .backfill { p.append("из прошлых сессий") }
		if let d = ISO.parse(item.updatedAt) { p.append("обновлён " + d.learningStamp) }
		p.append("событий: \(item.events)")
		return p.joined(separator: " · ")
	}

	/// Цели с типами, сессии (клик — вкладка сессии), плейбук@версия (клик — раздел «Плейбуки»).
	private var meta: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			if !item.goals.isEmpty {
				FlowLayout(spacing: DS.Metrics.s1) {
					ForEach(Array(item.goals.enumerated()), id: \.offset) { _, g in
						LearningChip(g.type.isEmpty ? g.title : "\(g.title) · \(g.type)", systemImage: "target")
					}
				}
			}
			let titles = model.sessionTitles(of: item)
			if !titles.isEmpty {
				FlowLayout(spacing: DS.Metrics.s1) {
					ForEach(Array(zip(item.sessions, titles)), id: \.0) { id, t in
						Button { model.show(session: id) } label: { LearningChip(t, systemImage: "bubble.left") }
							.buttonStyle(.plain).help("Открыть сессию")
					}
				}
			}
			if let ref = item.playbookRef {
				Button { model.background.go(.playbooks, id: ref.id) } label: {
					LearningChip("\(learning.playbook(ref.id)?.title ?? ref.id)" + (ref.version.map { "@\($0)" } ?? ""), systemImage: "book.closed", tint: DS.Palette.accentText)
				}
				.buttonStyle(.plain).help("Открыть плейбук")
			}
		}
	}

	private var banner: some View {
		HStack(spacing: DS.Metrics.s2) {
			ProgressView().controlSize(.small)
			Text("Описание дописывается — разделы появляются по мере работы сборщика.")
				.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
		}
	}

	// MARK: описание

	private var editing: Bool { draft.editingSummary }

	private var summarySection: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s2) {
				DSGroupHeader(title: "Описание", count: nil)
				Spacer(minLength: 0)
				if editing {
					Button("Отмена") { draft.summary = nil; draft.text = nil; draft.staleServerText = nil; if draft.notes == nil { waiting = false } }
					Button("Сохранить") { Task { await save() } }.disabled(saving || model.isOffline)
				} else if detail != nil {
					if building { Text("сборщик пишет описание").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
					if parsed.editable {
						Button("Править") { draft.summary = parsed }.disabled(building)
					} else {
						Button("Править текстом") { draft.text = detail?.summary ?? "" }.disabled(building)
							.help("В описании есть то, что блоками не показать: правится текстом целиком")
					}
				}
			}
			.buttonStyle(SettingsButtonStyle())
			saveStatus
			staleCompare
			if detail == nil {
				if let loadFailure { Label(loadFailure, systemImage: "exclamationmark.triangle").font(DS.Typography.secondary).foregroundStyle(DS.Palette.danger) }
				else { ProgressView().controlSize(.small) }
			} else if draft.text != nil {
				TextEditor(text: Binding(get: { draft.text ?? "" }, set: { draft.text = $0 }))
					.font(DS.Typography.mono).frame(minHeight: 280)
					.scrollContentBackground(.hidden).padding(DS.Metrics.s2).dsGroup()
			} else if draft.summary != nil {
				CaseEditor(summary: Binding(get: { draft.summary ?? parsed }, set: { draft.summary = $0 }))
			} else if parsed.unparsed {
				if let text = detail?.summary, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					MarkdownView(text: text).padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
				} else {
					Text(building ? "Описания пока нет." : "Описание пусто.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
			} else {
				ForEach(Array(parsed.goals.enumerated()), id: \.offset) { _, g in CaseGoalView(caseId: item.id, goal: g) }
			}
		}
	}

	/// 409 `stale`: описание изменилось, пока вы правили — новое и ваш черновик рядом.
	@ViewBuilder private var staleCompare: some View {
		if let server = draft.staleServerText {
			VStack(alignment: .leading, spacing: DS.Metrics.s3) {
				Label("Описание изменилось, пока вы правили", systemImage: "arrow.triangle.2.circlepath").font(DS.Typography.secondary.weight(.semibold))
				HStack(alignment: .top, spacing: DS.Metrics.s3) {
					compareColumn("Сейчас на сервере", server)
					compareColumn("Ваш черновик", draftMarkdown)
				}
				HStack(spacing: DS.Metrics.s2) {
					Button("Заменить моим") { draft.staleServerText = nil; Task { await save() } }.disabled(saving || model.isOffline)
					Button("Отменить") { draft.staleServerText = nil }
					Text("«Отменить» закрывает сравнение, черновик остаётся.").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
				}
				.buttonStyle(SettingsButtonStyle())
			}
			.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading)
			.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
		}
	}

	private func compareColumn(_ title: String, _ text: String) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(title).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
			LongText(text, lines: 14)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// Текст описания из черновика (блоки собираются в markdown).
	private var draftMarkdown: String {
		if let s = draft.summary { return CaseEditing.markdown(s) }
		return draft.text ?? ""
	}

	@ViewBuilder private var saveStatus: some View {
		if waiting {
			Label("Сборщик работает, сохраню после — черновик останется здесь.", systemImage: "hourglass")
				.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
		}
	}

	// MARK: заметки

	private var notesSection: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s2) {
				DSGroupHeader(title: "Заметки", count: nil)
				Spacer(minLength: 0)
				if draft.notes != nil {
					Button("Отмена") { draft.notes = nil; if !draft.editingSummary { waiting = false } }
					Button("Сохранить") { Task { await save() } }.disabled(saving || model.isOffline)
				} else if detail != nil {
					Button("Править") { draft.notes = CaseEditing.notes(from: detail?.notes ?? "") }
				}
			}
			.buttonStyle(SettingsButtonStyle())
			if draft.notes != nil {
				NotesEditor(notes: Binding(get: { draft.notes ?? [] }, set: { draft.notes = $0 }))
			} else {
				let lines = CaseEditing.notes(from: detail?.notes ?? "")
				if lines.isEmpty {
					Text("Заметок нет. Постоянные указания агенты записывают сюда сами.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				} else {
					VStack(alignment: .leading, spacing: DS.Metrics.s1) {
						ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
							Text("• " + l).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
	}

	// MARK: загрузка и действия

	private func load() async {
		let t = token.next()
		do {
			let d = try await client.caseDetail(item.id)
			guard token.isCurrent(t) else { return }
			detail = d; loadFailure = nil
			parsed = CaseSummary.parse(d.summary)
		} catch {
			if token.isCurrent(t), detail == nil { loadFailure = error.localizedDescription }
		}
	}

	private func save() async {
		let d = draft
		guard !saving, d.editingSummary || d.notes != nil else { return }
		saving = true
		defer { saving = false }
		do {
			if d.editingSummary {
				let text = d.summary.map(CaseEditing.markdown) ?? d.text ?? ""
				try await client.putCaseSummary(item.id, text: text, base: detail?.summaryHash ?? "")
				detail?.summaryHash = TextHash.sha1(text)
				d.summary = nil; d.text = nil; d.staleServerText = nil
			}
			if let n = d.notes {
				try await client.putCaseNotes(item.id, text: CaseEditing.text(fromNotes: n))
				d.notes = nil
			}
			waiting = false
			await load()
		} catch let e as APIError where e.isBusy {
			waiting = true
		} catch let e as APIError where e.isStale {
			waiting = false
			do {
				let fresh = try await client.caseDetail(item.id)
				detail = fresh; parsed = CaseSummary.parse(fresh.summary)
				d.staleServerText = fresh.summary
			} catch { model.flash("Описание изменилось, но перечитать не удалось: \(error.localizedDescription)", error: true) }
		} catch {
			waiting = false
			model.flash("Не сохранено: \(error.localizedDescription)", error: true)
		}
	}

	private func act(_ title: String, _ op: @escaping () async throws -> Void) {
		Task { await model.run(title, op) }
	}

	/// Влияние удаления грузится заново при каждом открытии диалога; не удалось — об этом сказано в диалоге, удалить всё равно можно.
	private func askDelete() {
		impact = nil; impactFailed = false
		Task {
			do { impact = try await client.caseImpact(item.id) } catch { impactFailed = true }
			confirmDelete = true
		}
	}

	private func delete() {
		let id = item.id
		Task {
			await model.run("Удаление кейса") {
				try await client.deleteCase(id)
				await MainActor.run {
					model.background.discardDrafts(id)
					if model.background.objectId == id { model.background.forceGo(.cases) }
				}
			}
		}
	}
}

// MARK: - Цель

/// Одна цель описания: план, таблица действий, источники, поправки, открытые вопросы.
private struct CaseGoalView: View {
	var caseId: String
	var goal: CaseSummary.Goal

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			HStack(spacing: DS.Metrics.s2) {
				Text(goal.title.isEmpty ? "Цель" : goal.title).font(DS.Typography.panelTitle).textSelection(.enabled)
				if !goal.type.isEmpty { LearningChip(goal.type, mono: true) }
			}
			if !goal.plan.isEmpty {
				section("План") {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(Array(goal.plan.enumerated()), id: \.offset) { _, l in
							Text(l).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			if !goal.actions.isEmpty { section("Действия") { ActionsTable(caseId: caseId, actions: goal.actions) } }
			if !goal.sources.isEmpty { section("Источники") { SourceChips(sources: goal.sources) } }
			if !goal.corrections.isEmpty {
				section("Поправки") {
					VStack(spacing: DS.Metrics.s2) { ForEach(Array(goal.corrections.enumerated()), id: \.offset) { _, c in correction(c) } }
				}
			}
			if !goal.open.isEmpty {
				section("Открытые вопросы") {
					VStack(alignment: .leading, spacing: DS.Metrics.s1) {
						ForEach(Array(goal.open.enumerated()), id: \.offset) { _, q in
							Label(q, systemImage: "questionmark.circle").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.padding(DS.Metrics.s4)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsGroup()
	}

	private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(title).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
			content()
		}
	}

	/// «предлагал → вы сказали»
	private func correction(_ c: CaseSummary.Correction) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(alignment: .top, spacing: DS.Metrics.s2) {
				Text("Предлагал").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 78, alignment: .leading)
				Text(c.proposed).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
				Spacer(minLength: 0)
				if let a = c.anchor { AnchorButton(caseId: caseId, range: a) }
			}
			HStack(alignment: .top, spacing: DS.Metrics.s2) {
				Text("Вы сказали").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 78, alignment: .leading)
				Text(c.user).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
			}
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
	}
}

// MARK: - Таблица действий

/// Что поручено, кому, итог; строка раскрывает события сессии по якорю, якорь-кнопка открывает их поповером.
private struct ActionsTable: View {
	var caseId: String
	var actions: [CaseSummary.Action]
	@State private var expanded: Set<Int> = []

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .top, spacing: DS.Metrics.s3) {
				Text("Поручено").frame(maxWidth: .infinity, alignment: .leading)
				Text("Кому").frame(width: 140, alignment: .leading)
				Text("Итог").frame(maxWidth: .infinity, alignment: .leading)
				Color.clear.frame(width: 60, height: 1)
			}
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
			.padding(.bottom, DS.Metrics.s1)
			ForEach(Array(actions.enumerated()), id: \.offset) { i, a in
				DSSeparator()
				row(i, a)
			}
		}
	}

	private func row(_ i: Int, _ a: CaseSummary.Action) -> some View {
		let open = expanded.contains(i)
		return VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(alignment: .top, spacing: DS.Metrics.s3) {
				Text(a.what).frame(maxWidth: .infinity, alignment: .leading)
				Text(a.agent).foregroundStyle(DS.Palette.textSecondary).frame(width: 140, alignment: .leading)
				Text(a.result).foregroundStyle(DS.Palette.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
				Group {
					if let r = a.anchor { AnchorButton(caseId: caseId, range: r) } else { Color.clear }
				}
				.frame(width: 60, alignment: .trailing)
			}
			.font(DS.Typography.secondary)
			.textSelection(.enabled)
			if open, let r = a.anchor {
				RawEventsList(caseId: caseId, range: r).frame(maxHeight: 280)
					.background(DS.Palette.hover, in: RoundedRectangle(cornerRadius: DS.Metrics.s2, style: .continuous))
			}
		}
		.padding(.vertical, DS.Metrics.s2)
		.contentShape(Rectangle())
		.onTapGesture {
			guard a.anchor != nil else { return }
			withAnimation(dsAnimation(DS.Motion.disclosure)) { if open { expanded.remove(i) } else { expanded.insert(i) } }
		}
		.help(a.anchor == nil ? "" : "Нажмите, чтобы раскрыть события сессии")
	}
}
