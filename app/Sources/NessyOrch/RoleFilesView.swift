import SwiftUI
import AppKit
import NessyKit

/// Файлы роли в окне ролей: скрипты, шаблоны, справочники, которые агент читает и запускает по `{{role_dir}}`. Список, правка текста,
/// новый файл или скрипт (в папке лежит и role.md — описание и инструкции роли, правки двусторонние), быстрый переход в Finder и редактор кода. Правка пишется прямо на диск и сразу видна агентам.
struct RoleFilesSection: View {
	@Environment(AppModel.self) private var model
	var role: RoleView

	@State private var files: [RolePackageFiles.Entry] = []
	@State private var selected: String?
	@State private var text = ""
	@State private var saved = ""
	@State private var error: String?
	@State private var askName = false
	@State private var newName = ""
	@State private var newHint = ""

	private var store: RolePackageFiles { RolePackageFiles(root: OrchToken.rolePackage(role.id)) }
	private var dirty: Bool { selected != nil && text != saved }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack(spacing: DS.Metrics.s2) {
				Text("Файлы роли").font(DS.Typography.caption.weight(.medium)).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: 0)
				if role.package == true {
					Menu {
						Button("Новый скрипт…") { ask("scripts/run.sh", "Скрипт получит права на запуск") }
						Button("Новый шаблон…") { ask("assets/template.md", "Шаблон, справочник или любой текстовый файл") }
						Button("Другой файл…") { ask("notes.md", "Путь внутри папки роли") }
						Divider()
						Button("Показать в Finder") { model.revealRoleFolder(role) }
						Button("Открыть в редакторе кода") { model.openRoleInEditor(role) }
					} label: { Label("Добавить", systemImage: "plus") }
						.menuStyle(.button).controlSize(.small).fixedSize()
				}
			}
			if role.package == true {
				content
			} else {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					Text("У роли пока нет файлов. Добавьте папку, чтобы класть в неё скрипты, шаблоны и справочники: агент получит к ним путь во вводной.")
						.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					HStack(spacing: DS.Metrics.s2) {
						Button("Добавить файлы роли") { Task { _ = await model.roleFolder(role) } }
						// сразу открыть папку-плагин: в ней role.md (описание и инструкции) рядом со скриптами, правки видны и в этом окне
						Button("Создать и открыть в редакторе") { model.openRoleInEditor(role) }
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(DS.Metrics.s3).background(DS.Palette.hover.opacity(0.6), in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
			}
		}
		.task(id: role.id + (role.package == true ? "+" : "-")) { reload() }
		.alert("Новый файл", isPresented: $askName) {
			TextField("scripts/run.sh", text: $newName)
			Button("Создать") { create() }
			Button("Отмена", role: .cancel) {}
		} message: { Text(newHint) }
	}

	@ViewBuilder private var content: some View {
		VStack(spacing: 0) {
			if files.isEmpty {
				Text("Папка пуста: добавьте скрипт или шаблон.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					.frame(maxWidth: .infinity, alignment: .leading).padding(DS.Metrics.s3)
			} else {
				ForEach(Array(files.enumerated()), id: \.element.id) { i, f in
					if i > 0 { DSSeparator(leading: DS.Metrics.s3) }
					row(f)
				}
			}
		}
		.background(DS.Palette.surface, in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
		.overlay(RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous).stroke(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
		if let sel = selected {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				HStack(spacing: DS.Metrics.s2) {
					Text(sel).font(DS.Typography.mono).foregroundStyle(DS.Palette.textPrimary).lineLimit(1).truncationMode(.middle)
					Spacer(minLength: 0)
					Button("Сохранить файл") { saveFile() }.disabled(!dirty).controlSize(.small)
					Button(role: .destructive) { deleteFile(sel) } label: { Image(systemName: "trash") }.controlSize(.small).help("Удалить файл")
				}
				TextEditor(text: $text)
					.font(.system(size: 12.5, design: .monospaced)).lineSpacing(2)
					.scrollContentBackground(.hidden)
					.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
					.frame(minHeight: 140, maxHeight: 320)
					.background(DS.Palette.surface, in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
					.overlay(RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous).stroke(dirty ? DS.Palette.accent : DS.Palette.separator, lineWidth: DS.Metrics.hairline))
			}
			.padding(.top, DS.Metrics.s1)
		}
		if let error { Text(error).font(DS.Typography.caption).foregroundStyle(DS.Palette.danger) }
		Text("Путь к папке в инструкциях: `{{role_dir}}`. Изменения сохраняются сразу на диск и видны агентам при следующем запуске скрипта или чтении файла.")
			.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
	}

	private func row(_ f: RolePackageFiles.Entry) -> some View {
		Button { open(f) } label: {
			HStack(spacing: DS.Metrics.s3) {
				Image(systemName: f.isExecutable ? "terminal" : "doc.text").foregroundStyle(DS.Palette.textSecondary).frame(width: DS.Metrics.glyphRow)
				VStack(alignment: .leading, spacing: 1) {
					Text(f.name).font(DS.Typography.mono).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					if !f.folder.isEmpty { Text(f.folder).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1) }
				}
				Spacer(minLength: DS.Metrics.s2)
				Text(ByteCountFormatter.string(fromByteCount: Int64(f.size), countStyle: .file)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
			}
			.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
			.background(selected == f.path ? DS.Palette.selection : .clear)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
	}

	private func reload() {
		files = role.package == true ? store.list() : []
		if let s = selected, !files.contains(where: { $0.path == s }) { selected = nil; text = ""; saved = "" }
	}

	private func open(_ f: RolePackageFiles.Entry) {
		if dirty { saveFile() }
		do {
			text = try store.read(f.path)
			saved = text
			selected = f.path
			error = nil
		} catch {
			self.error = error.localizedDescription
			selected = nil
		}
	}

	private func saveFile() {
		guard let s = selected else { return }
		do { try store.write(s, text); saved = text; error = nil; reload() } catch { self.error = error.localizedDescription }
	}

	private func ask(_ suggestion: String, _ hint: String) {
		newName = suggestion
		newHint = hint
		askName = true
	}

	private func create() {
		do {
			let e = try store.create(newName)
			reload()
			open(e)
		} catch { self.error = error.localizedDescription }
	}

	private func deleteFile(_ path: String) {
		do { try store.delete(path); selected = nil; text = ""; saved = ""; error = nil; reload() } catch { self.error = error.localizedDescription }
	}
}
