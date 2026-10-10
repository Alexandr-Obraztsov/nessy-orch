import SwiftUI
import AppKit
import NessyKit

/// Центр окна: терминал под шапкой, на всю оставшуюся высоту. Панель агентов слева меняет только его ширину.
struct CenterView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win

	var body: some View {
		Group {
			if let tab = win?.terminal {
				TerminalHost(tab: tab, topInset: (win?.isFullScreen ?? false) || !(win?.panelHidden ?? false) ? 8 : (win?.headerHeight ?? 52))
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
		.overlay(alignment: .topTrailing) { if win?.isFullScreen ?? false { MoreMenu(glass: true).padding(.trailing, 14).padding(.top, 10) } }
		.toolbar {
			// «⋯» — стеклянная кнопка шапки справа: только горячие клавиши и настройки
			ToolbarSpacer(.flexible, placement: .primaryAction)
			ToolbarItem(placement: .primaryAction) { MoreMenu() }
		}
		.overlay(alignment: .top) { ToastView().padding(.top, 56) }
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

/// «⋯» в шапке справа: только горячие клавиши и настройки.
struct MoreMenu: View {
	/// вне тулбара (полный экран): кнопка рисует стеклянный круг сама
	var glass = false
	@Environment(AppModel.self) private var model
	@Environment(\.openSettings) private var openSettings
	var body: some View {
		Menu {
			Button("Горячие клавиши") { model.showShortcuts = true }
			Button("Настройки…") { openSettings(); NSApp.activate() }
		} label: {
			Image(systemName: "ellipsis")
		}
		.menuIndicator(.hidden)
		.modifier(FloatingGlass(on: glass))
		.tint(DS.Palette.textSecondary)
		.help("Ещё").accessibilityLabel("Ещё")
	}
}

private struct FloatingGlass: ViewModifier {
	var on: Bool
	func body(content: Content) -> some View {
		if on { content.menuStyle(.button).buttonStyle(GlassCircleStyle(size: 34, prominent: false)).fixedSize() } else { content }
	}
}
