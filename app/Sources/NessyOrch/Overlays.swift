import SwiftUI
import NessyKit

// MARK: - Горячие клавиши

enum Shortcuts {
	static let groups: [(String, [(String, String)])] = [
		("Сессии", [("⌘1…⌘9", "Сессия по порядку"), ("⌘[  ⌘]", "Предыдущая / следующая сессия"),
					("⌥⌘1  ⌥⌘2  ⌥⌘3", "Агенты / Источники / Статистика"), ("⌘K", "Перейти к сессии или агенту"),
					("⌘F", "Поиск по источникам"), ("⇧⌘R", "Роли")]),
		("Список агентов", [("↑ ↓  J K", "Выбрать агента"), ("↩", "Открыть выбранного"), ("Esc", "Закрыть окно агента"),
							("⌘O", "Открыть в отдельном окне"), ("⌘.", "Остановить ход")]),
		("Запрос прав", [("⌘↩", "Разрешить"), ("⌘⌫", "Отклонить")]),
		("Поле ввода", [("↩", "Отправить"), ("⇧↩", "Перенос строки")]),
		("Роли", [("⌘S", "Сохранить роль")]),
	]
}

struct ShortcutsView: View {
	@Environment(\.dismiss) private var dismiss
	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			HStack { Text("Горячие клавиши").font(DS.Typography.panelTitle); Spacer(); Button("Готово") { dismiss() }.keyboardShortcut(.defaultAction) }
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s5) {
					ForEach(Shortcuts.groups, id: \.0) { g in
						VStack(alignment: .leading, spacing: DS.Metrics.s2) {
							DSGroupHeader(title: g.0, count: nil)
							ForEach(g.1, id: \.0) { k in
								HStack {
									Text(k.1).foregroundStyle(DS.Palette.textPrimary)
									Spacer()
									Text(k.0).font(DS.Typography.mono).foregroundStyle(DS.Palette.textSecondary)
								}.font(DS.Typography.secondary)
							}
						}
					}
				}.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.padding(DS.Metrics.s5).frame(width: 440, height: 480)
	}
}

// MARK: - Палитра ⌘K

struct PaletteView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var query = ""
	@State private var sel = 0

	private struct Item: Identifiable { var id: String; var title: String; var sub: String; var go: @MainActor () -> Void }

	private var items: [Item] {
		let store = model.store
		var out: [Item] = store.sessions.map { s in Item(id: "s" + s.id, title: s.title, sub: "Сессия") { [model] in model.show(session: s.id) } }
		out += store.allAgents.map { a in Item(id: "a" + a.id, title: a.name, sub: store.session(a.session)?.title ?? "Агент") { [model] in model.reveal(agent: a.id) } }
		let q = query.lowercased()
		return q.isEmpty ? out : out.filter { $0.title.lowercased().contains(q) || $0.sub.lowercased().contains(q) }
	}

	var body: some View {
		let list = items
		VStack(spacing: 0) {
			TextField("Перейти к сессии или агенту", text: $query).textFieldStyle(.plain).font(DS.Typography.body)
				.padding(DS.Metrics.s4)
				.onSubmit { pick(list) }
				.onKeyPress(.downArrow) { sel = min(sel + 1, max(0, list.count - 1)); return .handled }
				.onKeyPress(.upArrow) { sel = max(sel - 1, 0); return .handled }
				.onChange(of: query) { _, _ in sel = 0 }
			DSSeparator()
			ScrollView {
				VStack(spacing: 0) {
					ForEach(Array(list.prefix(30).enumerated()), id: \.element.id) { i, it in
						HStack {
							Text(it.title).lineLimit(1)
							Spacer()
							Text(it.sub).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
						}
						.font(DS.Typography.secondary)
						.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
						.background(i == sel ? DS.Palette.selection : .clear)
						.contentShape(Rectangle())
						.onTapGesture { sel = i; pick(list) }
					}
				}
			}
		}
		.frame(width: 440, height: 340)
	}

	private func pick(_ list: [Item]) {
		guard sel < list.count else { return }
		dismiss()
		list[sel].go()
	}
}

// MARK: - Роли

struct RolesView: View {
	@Environment(AppModel.self) private var model
	private enum Sel: Hashable { case new, role(String) }
	@State private var sel: Sel?
	@State private var draft = RoleDraft()
	@State private var pending: Sel?
	@State private var askDiscard = false
	@State private var askDelete = false

	private var roles: [RoleView] { model.store.roles.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending } }
	private var current: RoleView? { if case .role(let id) = sel { return model.store.role(id) } else { return nil } }
	private var isNew: Bool { sel == .new }
	private var dirty: Bool { sel != nil && draft.isChanged(from: current) }

	var body: some View {
		HStack(spacing: 0) {
			list.frame(width: 230)
			Divider()
			editor.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(minWidth: 640, minHeight: 420)
		.background(DS.Palette.windowBackground)
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.onAppear { if sel == nil, let r = roles.first { go(.role(r.id)) } }
		.onChange(of: current?.updatedAt) { _, _ in if !dirty, let r = current { draft = RoleDraft(r) } }
		.confirmationDialog("Отменить несохранённые изменения?", isPresented: $askDiscard) {
			Button("Отменить изменения", role: .destructive) { if let p = pending { go(p) }; pending = nil }
			Button("Остаться", role: .cancel) { pending = nil }
		}
		.confirmationDialog("Удалить роль?", isPresented: $askDelete) {
			Button("Удалить роль", role: .destructive) { remove() }
		} message: { Text("Агенты с этой ролью продолжат работать.") }
	}

	private var list: some View {
		VStack(spacing: 0) {
			List(selection: Binding<Sel?>(get: { sel }, set: { if let n = $0 { request(n) } })) {
				ForEach(roles) { r in
					let n = RoleUsage.count(r, in: model.store.allAgents)
					VStack(alignment: .leading, spacing: 1) {
						Text(r.name).font(DS.Typography.secondary.weight(.medium)).lineLimit(1)
						Text(r.description.isEmpty ? "Без описания" : r.description).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
						if n > 0 { Text(Numbers.count(n, "агент", "агента", "агентов")).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
					}.tag(Sel.role(r.id))
				}
			}.listStyle(.sidebar)
			DSSeparator()
			Button { request(.new) } label: {
				Label("Новая роль", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading)
			}
			.buttonStyle(.plain).foregroundStyle(DS.Palette.textSecondary).padding(DS.Metrics.s3)
		}
	}

	@ViewBuilder private var editor: some View {
		if sel == nil {
			ContentUnavailableView {
				Label("Ролей пока нет", systemImage: "person.text.rectangle")
			} description: { Text("Роль задаёт агенту инструкции.") } actions: {
				Button("Новая роль") { request(.new) }.buttonStyle(.borderedProminent)
			}
		} else {
			VStack(alignment: .leading, spacing: DS.Metrics.s3) {
				field("Имя") { TextField("Например, ревьюер", text: $draft.name).textFieldStyle(.roundedBorder) }
				field("Описание") { TextField("Одна строка", text: $draft.description).textFieldStyle(.roundedBorder) }
				field("Инструкции (markdown)") {
					TextEditor(text: $draft.instructions).font(DS.Typography.mono).scrollContentBackground(.hidden)
						.padding(DS.Metrics.s2).background(DS.Palette.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
						.overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
						.frame(minHeight: 160)
				}
				HStack {
					if !isNew { Button("Удалить роль") { askDelete = true }.buttonStyle(.bordered) }
					Spacer()
					Button("Сохранить") { save() }.buttonStyle(.borderedProminent).keyboardShortcut("s")
						.disabled(!dirty || !draft.isValid)
				}
			}
			.padding(DS.Metrics.s5)
		}
	}

	private func field<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(title).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			c()
		}
	}

	private func request(_ n: Sel) {
		if n == sel { return }
		if dirty { pending = n; askDiscard = true } else { go(n) }
	}
	private func go(_ n: Sel) {
		sel = n
		if case .role(let id) = n, let r = model.store.role(id) { draft = RoleDraft(r) } else { draft = RoleDraft() }
	}
	private func save() {
		let id = current?.id
		Task { if let r = await model.saveRole(id: id, draft) { sel = .role(r.id); draft = RoleDraft(r); model.flash("Роль сохранена") } }
	}
	private func remove() {
		guard let id = current?.id else { return }
		Task {
			if await model.deleteRole(id) {
				sel = nil; draft = RoleDraft()
				if let r = roles.first(where: { $0.id != id }) { go(.role(r.id)) }
			}
		}
	}
}
