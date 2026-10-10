import SwiftUI
import NessyKit

// MARK: - Горячие клавиши

enum Shortcuts {
	static let groups: [(String, [(String, String)])] = [
		("Окна и терминал", [("⌘N", "Новое окно в той же папке"), ("⇧⌘O", "Открыть папку…"), ("⌘W", "Закрыть окно"),
					  ("⌘⌥B", "Показать / скрыть панель агентов"), ("Esc, ↑↓, ⌃-клавиши", "Достаются терминалу, пока фокус в нём")]),
		("Сессии", [("⌘1…⌘9", "Открыть окно сессии по порядку"), ("⌘K", "Перейти к сессии или агенту"), ("⇧⌘R", "Роли")]),
		("Список агентов (фокус в списке: клик по нему)", [("↑ ↓  J K", "Выбрать агента"), ("↩", "Открыть карточку"), ("Esc", "Назад к списку из карточки"),
							("⌘O", "Открыть в отдельном окне"), ("⌘.", "Остановить ход")]),
		("Поле ввода", [("↩", "Отправить"), ("⇧↩", "Перенос строки")]),
		("Роли", [("⌘S", "Сохранить роль")]),
	]
}

struct ShortcutsView: View {
	@Environment(\.dismiss) private var dismiss
	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			HStack { Text("Горячие клавиши").font(DS.Typography.panelTitle); Spacer(); GlassIconButton(systemImage: "xmark", help: "Закрыть (Esc)") { dismiss() }.keyboardShortcut(.cancelAction) }
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
		.padding(DS.Metrics.s5).frame(width: 480, height: 540)
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

/// Окно «Роли» в духе системных Настроек: слева список (имя, одна строка описания, тихий счётчик агентов),
/// справа редактор — крупное имя, описание, просторное поле инструкций; одна заметная кнопка «Сохранить».
struct RolesView: View {
	@Environment(AppModel.self) private var model
	private enum Sel: Hashable { case new, role(String) }
	@State private var sel: Sel?
	@State private var draft = RoleDraft()
	@State private var pending: Sel?
	@State private var askDiscard = false
	@State private var askDelete = false
	@State private var showStyle = false

	private var roles: [RoleView] { model.store.roles.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending } }
	private var current: RoleView? { if case .role(let id) = sel { return model.store.role(id) } else { return nil } }
	private var isNew: Bool { sel == .new }
	private var dirty: Bool { sel != nil && draft.isChanged(from: current) }

	var body: some View {
		NavigationSplitView {
			list
				.navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 320)
		} detail: {
			editor
		}
		.navigationTitle("Роли")
		.frame(minWidth: 720, minHeight: 480)
		// кнопки — круглые иконки справа в шапке окна; подписи в подсказках
		.toolbar {
			ToolbarItemGroup(placement: .primaryAction) {
				Button { askDelete = true } label: { Label("Удалить роль", systemImage: "trash") }
					.help("Удалить роль").disabled(sel == nil || isNew)
				Button { request(.new) } label: { Label("Новая роль", systemImage: "plus") }.help("Новая роль")
				Button { save() } label: { Label("Сохранить", systemImage: "checkmark") }
					.buttonStyle(.borderedProminent).keyboardShortcut("s")
					.help("Сохранить (⌘S)").disabled(!dirty || !draft.isValid)
			}
		}
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.onAppear {
			if sel == nil, let r = roles.first { go(.role(r.id)) }
			// для снимков: `-debug.rolesPopover YES` — попап цвета и иконки открыт сразу
			if UserDefaults.standard.bool(forKey: "debug.rolesPopover") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { showStyle = true } }
		}
		// роли могут приехать позже окна: первая выбирается, когда список появился
		.onChange(of: roles.count) { _, _ in if sel == nil, let r = roles.first { go(.role(r.id)) } }
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
		List(selection: Binding<Sel?>(get: { sel }, set: { if let n = $0 { request(n) } })) {
			if isNew {
				HStack(spacing: DS.Metrics.s3) {
					RoleIconTile(icon: draft.icon, hue: draft.color)
					Text(draft.name.isEmpty ? "Новая роль" : draft.name).font(.body.weight(.medium)).lineLimit(1)
				}
				.padding(.vertical, 2).tag(Sel.new)
			}
			ForEach(roles) { r in
				let n = RoleUsage.count(r, in: model.store.allAgents)
				HStack(spacing: DS.Metrics.s3) {
					RoleIconTile(icon: r.icon, hue: r.color)
					VStack(alignment: .leading, spacing: 2) {
						Text(r.name).font(.body.weight(.medium)).lineLimit(1)
						Text(r.description.isEmpty ? "Без описания" : r.description)
							.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
					}
					Spacer(minLength: DS.Metrics.s1)
					if n > 0 { Text("\(n)").font(DS.Typography.caption).monospacedDigit().foregroundStyle(DS.Palette.textTertiary).help(Numbers.count(n, "агент", "агента", "агентов")) }
				}
				.padding(.vertical, 2)
				.tag(Sel.role(r.id))
			}
		}
		.listStyle(.sidebar)
	}

	@ViewBuilder private var editor: some View {
		if sel == nil {
			ContentUnavailableView {
				Label("Ролей пока нет", systemImage: "person.text.rectangle")
			} description: { Text("Роль задаёт агенту инструкции.") } actions: {
				Button("Новая роль") { request(.new) }.buttonStyle(.borderedProminent).controlSize(.large)
			}
		} else {
			VStack(spacing: 0) {
				ScrollView {
					VStack(alignment: .leading, spacing: DS.Metrics.s5) {
						// превью — как роль выглядит у агента; меняется вживую
						// слева — круглая кнопка-иконка роли (её цвет), справа имя и описание: имя показано один раз.
						// По нажатию на иконку — попап с цветом и иконкой.
						HStack(alignment: .center, spacing: DS.Metrics.s4) {
							Button { showStyle.toggle() } label: {
								RoleIconTile(icon: draft.icon, hue: draft.color, size: 64)
							}
							.buttonStyle(.plain).help("Цвет и иконка")
							.popover(isPresented: $showStyle, arrowEdge: .bottom) {
								VStack(alignment: .leading, spacing: DS.Metrics.s4) {
									colorPicker
									iconGrid
								}
								.padding(DS.Metrics.s4)
							}
							VStack(alignment: .leading, spacing: DS.Metrics.s1) {
								TextField("Имя роли", text: $draft.name)
									.textFieldStyle(.plain).font(.system(size: 26, weight: .semibold))
								TextField("Описание в одну строку", text: $draft.description)
									.textFieldStyle(.plain).font(.body).foregroundStyle(DS.Palette.textSecondary)
							}
						}

						section("Инструкции") {
							TextEditor(text: $draft.instructions)
								.font(.system(size: 13, design: .monospaced)).lineSpacing(3)
								.scrollContentBackground(.hidden)
								.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
								.frame(minHeight: 180)
								.background(DS.Palette.surface, in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
								.overlay(RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous).stroke(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
							Text("Markdown. Эти инструкции агент получает в начале работы.")
								.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
						}
					}
					.padding(.horizontal, DS.Metrics.s8).padding(.top, DS.Metrics.s4).padding(.bottom, DS.Metrics.s4)
				}
				.scrollEdgeEffectStyle(.soft, for: .bottom)
			}
		}
	}

	private func section<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			Text(title).font(DS.Typography.caption.weight(.medium)).foregroundStyle(DS.Palette.textSecondary)
			c()
		}
	}

	/// Ряд круглых образцов (серый + 11 оттенков) и слайдер для тонкой настройки.
	private var colorPicker: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s1) {
				ForEach(RolePalette.swatches, id: \.self) { h in
					let on = abs(draft.color - h) < 0.5
					Button { draft.color = h } label: {
						Circle().fill(h <= 0 ? Color.gray.opacity(0.55) : Color(hue: h / 360, saturation: 0.55, brightness: 0.9))
							.frame(width: 22, height: 22)
							.overlay(Circle().strokeBorder(DS.Palette.textPrimary, lineWidth: on ? 2 : 0).padding(-3))
							.padding(3)
					}
					.buttonStyle(.plain).help(h <= 0 ? "Серый" : "Оттенок \(Int(h))")
				}
			}
			HStack(spacing: DS.Metrics.s3) {
				Text("Оттенок").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
				Slider(value: Binding(get: { draft.color }, set: { draft.color = $0.rounded() }), in: 0...360).frame(width: 190)
				Text("\(Int(draft.color))").font(DS.Typography.caption).monospacedDigit().foregroundStyle(DS.Palette.textTertiary).frame(width: 30, alignment: .trailing)
			}
		}
	}

	private var iconGrid: some View {
		LazyVGrid(columns: Array(repeating: GridItem(.fixed(36), spacing: DS.Metrics.s2), count: 6), alignment: .leading, spacing: DS.Metrics.s2) {
			ForEach(RolePalette.icons, id: \.self) { name in
				let on = draft.icon == name
				Button { draft.icon = name } label: {
					Image(systemName: name).font(.system(size: 15))
						.foregroundStyle(on ? DS.Palette.textPrimary : DS.Palette.textSecondary)
						.frame(width: 36, height: 32)
						.background(on ? DS.Palette.selection : DS.Palette.hover.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
						.overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(on ? DS.Palette.accent : .clear, lineWidth: 1.5))
				}
				.buttonStyle(.plain).help(name)
			}
		}
	}

	private func request(_ n: Sel) {
		if n == sel { return }
		if dirty { pending = n; askDiscard = true } else { go(n) }
	}
	private func go(_ n: Sel) {
		sel = n
		if case .role(let id) = n, let r = model.store.role(id) { draft = RoleDraft(r) } else { var g = SystemRandomNumberGenerator(); draft = RoleDraft.fresh(using: &g) }
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

/// Квадратик с иконкой роли в списке: подложка и значок её оттенка.
struct RoleIconTile: View {
	@Environment(\.colorScheme) private var scheme
	var icon: String?
	var hue: Double
	var size: CGFloat = 28
	var body: some View {
		let dark = scheme == .dark
		Image(systemName: icon ?? RolePalette.defaultIcon).font(.system(size: size * 0.46, weight: .semibold))
			.foregroundStyle(RoleTint.foreground(hue, dark: dark))
			.frame(width: size, height: size)
			.background(RoleTint.background(hue, dark: dark), in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
	}
}
