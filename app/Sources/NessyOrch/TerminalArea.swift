import SwiftUI
import AppKit
import NessyKit

/// Центр окна: терминал на всю высоту окна. Пока боковая панель открыта, шапка (светофор и кнопка панели) лежит над панелью,
/// и верхнего отступа у терминала нет; панель свёрнута — отступ равен высоте шапки (анимируется вместе с панелью).
struct CenterView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.sessionWindow) private var win

	var body: some View {
		Group {
			if let tab = win?.terminal {
				TerminalHost(tab: tab, reserveHeader: win?.panelHidden ?? false)
					.id(tab.id)
					.accessibilityLabel("Терминал")
			} else {
				ProgressView().controlSize(.small)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.opacity(model.isOffline ? 0.6 : 1)
		.background(DS.Palette.windowBackground)
		.ignoresSafeArea(.container, edges: .top)
		.overlay(alignment: .bottom) {
			if model.isOffline { OfflineBanner().clipShape(RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous)).padding(DS.Metrics.s3) }
		}
		.overlay(alignment: .top) { ToastView().padding(.top, 56) }
	}
}

/// Пункты меню «⋯» сессии (внизу боковой панели).
struct SessionActionsItems: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openSettings) private var openSettings
	var session: SessionView?

	var body: some View {
		if let session {
			if session.status == .active { Button("Завершить сессию") { model.closeSession(session.id) } }
			else { Button("Вернуть в работу") { model.reopenSession(session.id) } }
			Button("Удалить сессию", role: .destructive) { model.deleteSession(session.id) }
			Divider()
		}
		Button("Настройки…") { openSettings(); NSApp.activate() }
		Button("Горячие клавиши") { model.showShortcuts = true }
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
