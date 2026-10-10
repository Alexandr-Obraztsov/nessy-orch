import SwiftUI
import AppKit
import NessyKit

/// Центр окна: терминал под шапкой, на всю оставшуюся высоту. Панель агентов слева меняет только его ширину.
struct CenterView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win

	var body: some View {
		Group {
			if win?.dir.isEmpty ?? false {
				NoProjectView()
			} else if let tab = win?.terminal {
				TerminalHost(tab: tab, topInset: (win?.isFullScreen ?? false) ? 8 : (win?.barHeight ?? 44))
					.id(tab.id)
					.accessibilityLabel("Терминал")
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

/// Состояние Claude по хукам: работает — лоадер, ждёт вас — синяя точка, завершил — тусклая; нет данных — пусто.
struct ClaudeStateIndicator: View {
	var state: ClaudeState.Run?
	var body: some View {
		Group {
			switch state {
			case .working: DSStateGlyph(state: .working, size: 14).help("Claude работает")
			case .idle: Circle().fill(DS.Palette.accent).frame(width: 8, height: 8).help("Claude ждёт вас")
			case .ended: Circle().fill(DS.Palette.quiet.opacity(0.5)).frame(width: 8, height: 8).help("Claude завершил работу")
			case nil: EmptyView()
			}
		}
		.frame(width: 14, height: 14)
		.accessibilityLabel(label)
	}
	private var label: String {
		switch state { case .working: "Claude работает"; case .idle: "Claude ждёт вас"; case .ended: "Claude завершил работу"; case nil: "" }
	}
}

/// «⋯» в стеклянной капсуле шапки: только горячие клавиши и настройки.
struct MoreMenu: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openSettings) private var openSettings
	@State private var hover = false
	var body: some View {
		Menu {
			Button("Горячие клавиши") { model.showShortcuts = true }
			Button("Настройки…") { openSettings(); NSApp.activate() }
		} label: {
			Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).frame(width: 30, height: 26)
				.background(hover ? DS.Palette.hover : .clear, in: Capsule())
				.contentShape(Capsule())
		}
		.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize().focusEffectDisabled()
		.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
		.onHover { hover = $0 }
		.help("Ещё").accessibilityLabel("Ещё")
	}
}

/// Окно без проекта: вместо терминала просьба открыть папку.
struct NoProjectView: View {
	@Environment(AppModel.self) private var model
	var body: some View {
		VStack(spacing: DS.Metrics.s3) {
			Image(systemName: "folder.badge.plus").font(.system(size: 34, weight: .light)).foregroundStyle(DS.Palette.textTertiary)
			Text("Проект не открыт").font(DS.Typography.panelTitle).foregroundStyle(DS.Palette.textPrimary)
			Text("Откройте папку проекта — в ней запустится терминал и сессия Claude.")
				.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).multilineTextAlignment(.center)
			Button("Открыть папку…") { model.openFolderPanel() }
				.buttonStyle(.plain).foregroundStyle(DS.Palette.accentText).font(DS.Typography.secondary.weight(.medium))
				.padding(.top, DS.Metrics.s1)
			Text("⇧⌘O").font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
		}
		.padding(DS.Metrics.s6)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}
