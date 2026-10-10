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
				TerminalHost(tab: tab)
					.id(tab.id)
					.accessibilityLabel("Терминал")
			} else {
				ProgressView().controlSize(.small)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.opacity(model.isOffline ? 0.6 : 1)
		.background(DS.Palette.terminalBackground)
		.overlay(alignment: .bottom) {
			if model.isOffline { OfflineBanner().clipShape(RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous)).padding(DS.Metrics.s3) }
		}
		.overlay(alignment: .top) { ToastView().padding(.top, 12) }
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
