import SwiftUI
import AppKit
import NessyKit

/// Центр окна: терминал под шапкой, на всю оставшуюся высоту. Панель агентов слева меняет только его ширину.
struct CenterView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win

	var body: some View {
		Group {
			if win == nil {
				NoProjectView()
			} else if let tab = win?.terminal {
				TerminalHost(tab: tab, topInset: win?.barHeight ?? 44)
					.id(tab.id)
					.accessibilityLabel("Терминал")
					.overlay { if let win { LaunchOverlay(tab: tab, win: win) } }
			} else {
				ProgressView().controlSize(.small)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.opacity(model.isOffline ? 0.6 : 1)
		.background(DS.Palette.terminalBackground)
		.ignoresSafeArea(.container, edges: .top)
		.overlay(alignment: .bottom) {
			if model.isOffline { OfflineBanner().clipShape(RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous)).padding(DS.Metrics.s3) }
		}
		.overlay(alignment: .top) { ToastView().padding(.top, 48) }
	}
}

/// Пока агент не нарисовал первый экран — «Запуск агента…» (окно не показывает пустой терминал); не запустился — причина и «Повторить».
struct LaunchOverlay: View {
	var tab: TerminalTab
	var win: SessionWindowModel
	@State private var waited = false

	var body: some View {
		Group {
			if let f = win.launchFailure {
				VStack(spacing: DS.Metrics.s3) {
					Image(systemName: "exclamationmark.triangle").font(.system(size: 28, weight: .light)).foregroundStyle(DS.Palette.danger)
					Text("Агент не запустился").font(DS.Typography.panelTitle).foregroundStyle(DS.Palette.textPrimary)
					Text("Команда «\(f.command)» завершилась сразу\(f.code.map { " с кодом \($0)" } ?? ""). Проверьте, что она установлена и доступна в оболочке; команду можно поменять в Настройках.")
						.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).multilineTextAlignment(.center).frame(maxWidth: 380)
					HStack(spacing: DS.Metrics.s4) {
						Button("Повторить") { win.retryLaunch() }
						Button("Закрыть проект") { win.closed() }
					}
					.buttonStyle(.plain).foregroundStyle(DS.Palette.accentText).font(DS.Typography.secondary.weight(.medium)).padding(.top, DS.Metrics.s1)
				}
				.padding(DS.Metrics.s6)
			} else if !tab.hasOutput && !waited && tab.isAlive {
				VStack(spacing: DS.Metrics.s3) {
					ProgressView().controlSize(.small)
					Text("Запуск агента…").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background { if win.launchFailure != nil || (!tab.hasOutput && !waited && tab.isAlive) { DS.Palette.terminalBackground } }
		.task(id: tab.id) { try? await Task.sleep(for: .seconds(5)); waited = true } // молчаливый агент не прячется за заставкой вечно
		.animation(DS.Motion.fade, value: tab.hasOutput)
	}
}

/// Кнопка настроек в шапке: сразу открывает окно настроек (в нём же горячие клавиши).
struct SettingsButton: View {
	@Environment(\.openSettings) private var openSettings
	@State private var hover = false
	var body: some View {
		Button { openSettings(); NSApp.activate() } label: {
			Image(systemName: "gearshape").font(.system(size: 14, weight: .medium)).frame(width: 30, height: 26)
				.background(hover ? DS.Palette.hover : .clear, in: Capsule())
				.contentShape(Capsule())
		}
		.buttonStyle(.plain).focusEffectDisabled()
		.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
		.onHover { hover = $0 }
		.help("Настройки (⌘,)").accessibilityLabel("Настройки")
	}
}

/// Нет открытых проектов: две колонки — «Проекты» (открыть папку, недавние папки) и «Сессии» (продолжить чат агента).
/// Блок компактный и по центру: колонки не растягиваются на всю высоту окна, длинные списки прокручиваются внутри.
struct NoProjectView: View {
	@Environment(AppModel.self) private var model

	private var folders: [String] {
		model.recentProjects.filter { FileManager.default.fileExists(atPath: $0) }.prefix(12).map { $0 }
	}

	var body: some View {
		let sessions = model.recentSessions(limit: 12)
		HStack(alignment: .top, spacing: DS.Metrics.s5) {
			column("Проекты") {
				Button { model.openFolderPanel() } label: {
					Label("Открыть папку", systemImage: "folder.badge.plus").font(DS.Typography.caption.weight(.medium))
				}
				.buttonStyle(.plain).foregroundStyle(DS.Palette.textSecondary)
				.help("Открыть папку (\(Hotkeys.shared.display(.openFolder)))")
			} rows: {
				if folders.isEmpty { empty("Нет недавних проектов") }
				ForEach(Array(folders.enumerated()), id: \.element) { i, dir in
					if i > 0 { DSSeparator(leading: DS.Metrics.s3) }
					RecentRow(dir: dir) { model.openTerminal(dir: dir) }
				}
			}
			column("Сессии") {
				EmptyView()
			} rows: {
				if sessions.isEmpty { empty("Нет сессий") }
				ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
					if i > 0 { DSSeparator(leading: DS.Metrics.s3) }
					RecentSessionRow(session: s) { model.show(session: s.id) }
				}
			}
		}
		.frame(maxWidth: 900)
		.padding(DS.Metrics.s6)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	/// Колонка: заголовок с действием справа и список в группе; длинный список прокручивается (не выше ~6 строк).
	private func column<A: View, R: View>(_ title: String, @ViewBuilder action: () -> A, @ViewBuilder rows: () -> R) -> some View {
		let list = VStack(spacing: 0, content: rows)
		return VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			HStack {
				Text(title).font(DS.Typography.groupTitle).foregroundStyle(DS.Palette.textSecondary)
				Spacer(minLength: DS.Metrics.s2)
				action()
			}
			.padding(.horizontal, DS.Metrics.s3)
			ViewThatFits(in: .vertical) {
				list.dsGroup()
				ScrollView { list }.frame(maxHeight: 330).dsGroup()
			}
		}
		.frame(maxWidth: .infinity, alignment: .topLeading)
	}

	private func empty(_ text: String) -> some View {
		Text(text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textTertiary)
			.frame(maxWidth: .infinity, minHeight: 46, alignment: .center)
	}
}

/// Строка сессии: папка чата, сколько агентов и когда последний раз была активна.
private struct RecentSessionRow: View {
	@Environment(AppModel.self) private var model
	var session: SessionView
	var action: () -> Void
	@State private var hover = false

	private var dir: String { session.cwd ?? "" }
	private var sub: String {
		var p: [String] = []
		let n = model.store.agents(inSession: session.id).count
		if n > 0 { p.append(Numbers.count(n, "агент", "агента", "агентов")) }
		if let d = ISO.parse(session.updatedAt) { p.append(Durations.ago(d)) }
		return p.joined(separator: " · ")
	}

	var body: some View {
		Button(action: action) {
			HStack(spacing: DS.Metrics.s3) {
				Image(systemName: "bubble.left").foregroundStyle(DS.Palette.textSecondary)
				VStack(alignment: .leading, spacing: 1) {
					Text(session.title).font(DS.Typography.secondary.weight(.medium)).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
					if !dir.isEmpty {
						Text(dir.replacingOccurrences(of: NSHomeDirectory(), with: "~")).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
							.lineLimit(1).truncationMode(.head)
					}
				}
				Spacer(minLength: DS.Metrics.s2)
				Text(sub).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary).lineLimit(1)
			}
			.padding(.horizontal, DS.Metrics.s3).frame(height: 46)
			.background(hover ? DS.Palette.hover : .clear)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain).focusEffectDisabled()
		.onHover { hover = $0 }
		.help("Продолжить сессию")
	}
}

private struct RecentRow: View {
	var dir: String
	var action: () -> Void
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			HStack(spacing: DS.Metrics.s3) {
				Image(systemName: "folder").foregroundStyle(DS.Palette.textSecondary)
				Text(Projects.name(ofPath: dir)).font(DS.Typography.secondary.weight(.medium)).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
				Spacer(minLength: DS.Metrics.s2)
				Text(dir.replacingOccurrences(of: NSHomeDirectory(), with: "~")).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
					.lineLimit(1).truncationMode(.head)
			}
			.padding(.horizontal, DS.Metrics.s3).frame(height: 38)
			.background(hover ? DS.Palette.hover : .clear)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain).focusEffectDisabled()
		.onHover { hover = $0 }
	}
}
