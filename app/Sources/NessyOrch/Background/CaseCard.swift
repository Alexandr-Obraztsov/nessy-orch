import SwiftUI
import NessyKit

/// Описание сессии (кейс), только чтение: цели, в каждой — план, действия, источники, поправки, вопросы; всё сворачивается.
/// Пока кейс дописывается, описание перечитывается по событиям `learning_case`.
struct CaseCard: View {
	@Environment(AppModel.self) private var model
	var item: CaseView

	@State private var detail: CaseDetail?
	@State private var parsed = CaseSummary()
	@State private var loadFailure: String?
	@State private var token = RequestToken()
	@State private var impact: CaseImpact?
	@State private var impactFailed = false
	@State private var confirmDelete = false

	private var learning: LearningStore { model.store.learning }
	private var client: OrchClient { model.store.client }

	var body: some View {
		VStack(spacing: 0) {
			header
			ScrollView {
				VStack(alignment: .leading, spacing: 0) {
					meta.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
					summarySection
				}
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
		}
		.task(id: "\(item.id)|\(item.updatedAt)|\(item.coveredUntil)|\(item.status)") { await load() }
		.confirmationDialog("Удалить кейс «\(model.title(ofCase: item))»?", isPresented: $confirmDelete, titleVisibility: .visible) {
			Button("Удалить", role: .destructive) { delete() }
			Button("Отмена", role: .cancel) {}
		} message: {
			Text(BackgroundLogic.deleteCaseMessage(impact: impact, failed: impactFailed))
		}
	}

	private var header: some View {
		PanelHeader(model.title(ofCase: item), subtitle: subtitle, onDelete: { askDelete() })
	}

	/// Одна строка: тип задачи (если цель одна — её тип, иначе типы через запятую) и «обновлён …».
	private var subtitle: String? {
		let types = Array(Set(parsed.goals.map(\.type).filter { !$0.isEmpty })).sorted().joined(separator: ", ")
		let stamp = ISO.parse(item.updatedAt).map { "обновлён " + $0.learningStamp }
		return [types, stamp].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
	}

	/// Сессии (клик — вкладка сессии) и плейбук «Название · v3» (клик — раздел «Плейбуки») — ссылки-строки.
	private var meta: some View {
		FlowLayout(spacing: DS.Metrics.s3) {
			let titles = model.sessionTitles(of: item)
			ForEach(Array(zip(item.sessions, titles)), id: \.0) { id, t in
				if model.store.session(id) != nil {
					LinkLine(text: t, systemImage: "bubble.left", help: "Открыть сессию") { model.show(session: id) }
				}
			}
			if let ref = item.playbookRef, let p = learning.playbook(ref.id) {
				LinkLine(text: p.title + (ref.version.map { " · v\($0)" } ?? ""), systemImage: "book.closed", help: "Открыть плейбук") { model.background.go(.playbooks, id: ref.id) }
			}
		}
	}

	@ViewBuilder private var summarySection: some View {
		if detail == nil {
			if let loadFailure { Label(loadFailure, systemImage: "exclamationmark.triangle").font(DS.Typography.secondary).foregroundStyle(DS.Palette.danger) }
			else { ProgressView().controlSize(.small) }
		} else if parsed.unparsed {
			if let text = detail?.summary, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				MarkdownView(text: text).padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading)
			} else {
				Text("Пока пусто").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).padding(.horizontal, DS.Metrics.s4)
			}
		} else {
			// цель одна — без отдельного блока с названием: сразу разделы; название — тихой строкой, только если не повторяет название кейса
			let single = parsed.goals.count == 1
			ForEach(Array(parsed.goals.enumerated()), id: \.offset) { _, g in
				CaseGoalView(caseId: item.id, goal: g, showTitle: !single, note: single && g.title != model.title(ofCase: item) ? g.title : nil)
			}
		}
	}

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
				await MainActor.run { if model.background.objectId == id { model.background.close() } }
			}
		}
	}
}

// MARK: - Цель

/// Одна цель описания: заголовок (если целей несколько), под ним разделы «План», «Действия», «Источники», «Поправки», «Вопросы».
private struct CaseGoalView: View {
	var caseId: String
	var goal: CaseSummary.Goal
	var showTitle: Bool
	var note: String?

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if showTitle {
				DSSeparator()
				Text(BackgroundLogic.inline(goal.title.isEmpty ? "Цель" : goal.title)).font(DS.Typography.agentName)
					.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
			} else if let note, !note.isEmpty {
				Text(BackgroundLogic.inline(note)).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					.padding(.horizontal, DS.Metrics.s4).padding(.bottom, DS.Metrics.s3)
			}
			if !goal.plan.isEmpty {
				Collapsible("План") {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(Array(goal.plan.enumerated()), id: \.offset) { _, l in
							Text(BackgroundLogic.inline(BackgroundLogic.planLine(l))).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
								.textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
						}
					}
				}
			}
			if !goal.actions.isEmpty { Collapsible("Действия", count: goal.actions.count) { ActionsList(caseId: caseId, actions: goal.actions) } }
			if !goal.sources.isEmpty { Collapsible("Источники", count: goal.sources.count) { SourceChips(sources: goal.sources) } }
			if !goal.corrections.isEmpty {
				Collapsible("Поправки", count: goal.corrections.count) {
					VStack(alignment: .leading, spacing: DS.Metrics.s3) { ForEach(Array(goal.corrections.enumerated()), id: \.offset) { _, c in correction(c) } }
				}
			}
			if !goal.open.isEmpty {
				Collapsible("Вопросы", count: goal.open.count) {
					VStack(alignment: .leading, spacing: DS.Metrics.s1) {
						ForEach(Array(goal.open.enumerated()), id: \.offset) { _, q in
							Label { Text(BackgroundLogic.inline(q)) } icon: { Image(systemName: "questionmark.circle") }
								.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	/// «предлагал → вы сказали»
	private func correction(_ c: CaseSummary.Correction) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			HStack(alignment: .top, spacing: DS.Metrics.s2) {
				Text("Предлагал").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 78, alignment: .leading)
				Text(BackgroundLogic.inline(c.proposed)).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
				Spacer(minLength: 0)
				if let a = c.anchor { AnchorButton(caseId: caseId, range: a) }
			}
			HStack(alignment: .top, spacing: DS.Metrics.s2) {
				Text("Вы сказали").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).frame(width: 78, alignment: .leading)
				Text(BackgroundLogic.inline(c.user)).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

// MARK: - Действия

/// Что поручено, кому, итог — карточками друг под другом (таблица в узком окне рвалась); якорь-кнопка открывает события поповером,
/// нажатие на строку раскрывает их под ней.
private struct ActionsList: View {
	var caseId: String
	var actions: [CaseSummary.Action]
	@State private var expanded: Set<Int> = []

	var body: some View {
		VStack(spacing: 0) {
			ForEach(Array(actions.enumerated()), id: \.offset) { i, a in
				if i > 0 { DSSeparator() }
				row(i, a)
			}
		}
	}

	private func row(_ i: Int, _ a: CaseSummary.Action) -> some View {
		let open = expanded.contains(i)
		return VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(alignment: .top, spacing: DS.Metrics.s3) {
				VStack(alignment: .leading, spacing: 2) {
					Text(BackgroundLogic.inline(a.what)).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
					if !a.agent.isEmpty { Text(BackgroundLogic.inline("Кому: " + a.agent)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
					if !a.result.isEmpty { Text(BackgroundLogic.inline("Итог: " + a.result)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				if let r = a.anchor { AnchorButton(caseId: caseId, range: r) }
			}
			.textSelection(.enabled)
			if open, let r = a.anchor {
				RawEventsList(caseId: caseId, range: r).frame(height: 280)
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
