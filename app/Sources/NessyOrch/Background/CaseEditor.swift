import SwiftUI
import NessyKit

/// Список, который правится на месте: у строки — поднять, опустить, убрать; внизу «Добавить».
/// Состав и порядок меняет только эта вьюшка; что в строке — решает `row`.
struct EditableList<Item, Row: View>: View {
	@Binding var items: [Item]
	var addTitle: String
	var make: () -> Item
	@ViewBuilder var row: (Binding<Item>) -> Row

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			ForEach(Array(items.enumerated()), id: \.offset) { i, _ in
				HStack(alignment: .top, spacing: DS.Metrics.s1) {
					row(binding(i)).frame(maxWidth: .infinity, alignment: .leading)
					PlainIconButton(systemImage: "chevron.up", help: "Выше", size: 24) { items = CaseEditing.moved(items, at: i, by: -1) }
						.disabled(i == 0)
					PlainIconButton(systemImage: "chevron.down", help: "Ниже", size: 24) { items = CaseEditing.moved(items, at: i, by: 1) }
						.disabled(i == items.count - 1)
					PlainIconButton(systemImage: "trash", help: "Убрать", size: 24) { if items.indices.contains(i) { items.remove(at: i) } }
				}
			}
			Button { items.append(make()) } label: { Label(addTitle, systemImage: "plus").font(DS.Typography.caption) }
				.buttonStyle(.plain).foregroundStyle(DS.Palette.accentText)
		}
	}

	/// Привязка к элементу, переживающая удаление: после удаления строки кадр ещё читает старый индекс.
	private func binding(_ i: Int) -> Binding<Item> {
		Binding(
			get: { items.indices.contains(i) ? items[i] : make() },
			set: { if items.indices.contains(i) { items[i] = $0 } }
		)
	}
}

/// Правка описания блоками: пункты плана, действий, источников, поправок и открытых вопросов внутри каждой цели.
/// Якоря пунктов сохраняются; формат собирается обратно `CaseSummary.render()`.
struct CaseEditor: View {
	@Binding var summary: CaseSummary

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s5) {
			ForEach(Array(summary.goals.indices), id: \.self) { gi in
				goalEditor(gi)
			}
			if summary.goals.isEmpty {
				Text("В описании нет целей.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
			}
		}
	}

	private func goalEditor(_ gi: Int) -> some View {
		let g = Binding<CaseSummary.Goal>(
			get: { summary.goals.indices.contains(gi) ? summary.goals[gi] : CaseSummary.Goal(title: "") },
			set: { if summary.goals.indices.contains(gi) { summary.goals[gi] = $0 } }
		)
		return VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s2) {
				TextField("Цель", text: g.title).textFieldStyle(.roundedBorder).font(DS.Typography.agentName)
				TextField("Тип задачи", text: g.type).textFieldStyle(.roundedBorder).frame(width: 170)
			}
			block("План") {
				EditableList(items: g.plan, addTitle: "Добавить строку", make: { "" }) { s in
					TextField("Строка плана", text: s, axis: .vertical).textFieldStyle(.roundedBorder)
				}
			}
			block("Действия") {
				EditableList(items: g.actions, addTitle: "Добавить действие", make: { CaseSummary.Action(what: "") }) { a in
					VStack(spacing: DS.Metrics.s1) {
						TextField("Что поручено", text: a.what, axis: .vertical).textFieldStyle(.roundedBorder)
						HStack(spacing: DS.Metrics.s1) {
							TextField("Кому (агент, роль)", text: a.agent).textFieldStyle(.roundedBorder).frame(width: 190)
							TextField("Итог", text: a.result, axis: .vertical).textFieldStyle(.roundedBorder)
						}
					}
				}
			}
			block("Источники") {
				EditableList(items: g.sources, addTitle: "Добавить источник", make: { "" }) { s in
					TextField("wiki, gitlab …", text: s).textFieldStyle(.roundedBorder)
				}
			}
			block("Поправки") {
				EditableList(items: g.corrections, addTitle: "Добавить поправку", make: { CaseSummary.Correction(proposed: "", user: "") }) { c in
					VStack(spacing: DS.Metrics.s1) {
						TextField("Что предлагал оркестратор", text: c.proposed, axis: .vertical).textFieldStyle(.roundedBorder)
						TextField("Что сказали вы", text: c.user, axis: .vertical).textFieldStyle(.roundedBorder)
					}
				}
			}
			block("Открытые вопросы") {
				EditableList(items: g.open, addTitle: "Добавить вопрос", make: { "" }) { s in
					TextField("Вопрос", text: s, axis: .vertical).textFieldStyle(.roundedBorder)
				}
			}
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.dsGroup()
	}

	private func block<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(title).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
			content()
		}
	}
}

/// Заметки кейса: правка списком строк.
struct NotesEditor: View {
	@Binding var notes: [String]
	var body: some View {
		EditableList(items: $notes, addTitle: "Добавить заметку", make: { "" }) { s in
			TextField("Заметка", text: s, axis: .vertical).textFieldStyle(.roundedBorder)
		}
	}
}
