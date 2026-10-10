import SwiftUI
import NessyKit

/// Значок в строке меню: ✋ с числом — ждут вас; восьмиугольник — ошибка; иначе монохромный знак (screens.md §3f).
struct MenuBarLabel: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		let store = model.store
		let n = store.attentionCount
		HStack(spacing: DS.Metrics.s1) {
			Image(systemName: symbol)
			if n > 0 { Text("\(n)").monospacedDigit() }
		}
		.help(n > 0 ? "nessy — ждут вас: \(n)" : store.workingCount > 0 ? "nessy — работают: \(store.workingCount)" : "nessy — всё спокойно")
	}

	private var symbol: String {
		let store = model.store
		if case .offline = store.daemon { return "bolt.slash" }
		if store.allAgents.contains(where: { $0.state == .wait }) { return "hand.raised.fill" }
		if store.allAgents.contains(where: { $0.needsYou }) { return "xmark.octagon" }
		return store.workingCount > 0 ? "asterisk.circle.fill" : "asterisk"
	}
}

/// Панель menu bar (320): «Нужны вы» с кнопками, «В работе» до 5 строк, внизу «Открыть nessy». Готовых нет.
struct MenuBarPanel: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openWindow) private var openWindow
	@Environment(\.openSettings) private var openSettings
	@AppStorage("notify.pausedUntilTick") private var pauseTick = 0

	var body: some View {
		let store = model.store
		let needs = AgentGrouping.sections(store.allAgents).first { $0.group == .needsYou }?.agents ?? []
		let working = AgentGrouping.sections(store.allAgents).first { $0.group == .working }?.agents ?? []
		let firstRequest = needs.first { !$0.pendingPermissions.isEmpty }?.pendingPermissions.first?.requestId

		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			if model.isOffline {
				HStack(spacing: DS.Metrics.s2) {
					Image(systemName: "bolt.slash.fill").foregroundStyle(DS.Palette.danger)
					Text("Нет связи с оркестратором").font(DS.Typography.secondary)
					Spacer(minLength: DS.Metrics.s2)
					Button("Запустить") {
						Task { _ = await Daemon.kickstart(); try? await Task.sleep(for: .seconds(2)); await store.refreshStatus() }
					}
					.buttonStyle(.bordered)
				}
				.padding(DS.Metrics.s3)
				.dsGroup()
			}

			if needs.isEmpty && working.isEmpty && !model.isOffline {
				VStack(spacing: DS.Metrics.s1) {
					Text("Всё спокойно").font(DS.Typography.agentName)
					Text("Агенты не работают.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
				}
				.frame(maxWidth: .infinity)
				.padding(.vertical, DS.Metrics.s5)
			}

			if !needs.isEmpty {
				section("Нужны вы", count: needs.count) {
					ForEach(Array(needs.prefix(4).enumerated()), id: \.element.id) { i, a in
						if i > 0 { DSSeparator(leading: DS.Metrics.rowTextX) }
						AgentRow(agent: a, prominentRequest: firstRequest, compact: true)
					}
				}
			}
			if !working.isEmpty {
				section("В работе", count: working.count) {
					ForEach(Array(working.prefix(5).enumerated()), id: \.element.id) { i, a in
						if i > 0 { DSSeparator(leading: DS.Metrics.rowTextX) }
						AgentRow(agent: a, prominentRequest: nil, compact: true)
					}
					if working.count > 5 {
						DSSeparator(leading: DS.Metrics.rowTextX)
						Text("ещё \(working.count - 5)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
							.frame(maxWidth: .infinity, alignment: .leading)
							.padding(.leading, DS.Metrics.rowTextX).padding(.vertical, DS.Metrics.s2)
					}
				}
			}

			// низ — как Dock: стеклянная капсула «Открыть nessy» и плотные круглые кнопки-иконки
			GlassEffectContainer(spacing: DS.Metrics.s2) {
				HStack(spacing: DS.Metrics.s2) {
					Button { activate() } label: { Label("Открыть nessy", systemImage: "macwindow").padding(.horizontal, DS.Metrics.s1) }
						.buttonStyle(.glass)
					Spacer(minLength: 0)
					Menu {
						Button("Не беспокоить 1 час") { pause(3600) }
						Button("Не беспокоить до завтра") { pause(until: Calendar.current.startOfDay(for: Date().addingTimeInterval(86400))) }
						if isPaused { Divider(); Button("Включить уведомления") { UserDefaults.standard.removeObject(forKey: "notify.pausedUntil"); pauseTick += 1 } }
					} label: { Image(systemName: isPaused ? "bell.slash" : "bell").frame(width: DS.Metrics.s4, height: DS.Metrics.s4) }
						.menuStyle(.button).menuIndicator(.hidden).buttonStyle(.glass).buttonBorderShape(.circle).fixedSize()
						.help(isPaused ? "Уведомления на паузе" : "Уведомления")
					Button { openSettings(); NSApp.activate() } label: { Image(systemName: "gearshape").frame(width: DS.Metrics.s4, height: DS.Metrics.s4) }
						.buttonStyle(.glass).buttonBorderShape(.circle).help("Настройки")
					Button { NSApp.terminate(nil) } label: { Image(systemName: "power").frame(width: DS.Metrics.s4, height: DS.Metrics.s4) }
						.buttonStyle(.glass).buttonBorderShape(.circle).help("Выйти")
				}
			}
			.tint(nil as Color?)
			.foregroundStyle(DS.Palette.textPrimary)
		}
		.padding(DS.Metrics.s3)
		.frame(width: 320)
		.onAppear { model.openMainWindow = { activate() } }
	}

	private var isPaused: Bool { _ = pauseTick; return (UserDefaults.standard.object(forKey: "notify.pausedUntil") as? Date).map { $0 > Date() } ?? false }
	private func pause(_ s: TimeInterval) { pause(until: Date().addingTimeInterval(s)) }
	private func pause(until d: Date) { UserDefaults.standard.set(d, forKey: "notify.pausedUntil"); pauseTick += 1 }

	private func activate() {
		openWindow(id: "main")
		NSApp.activate()
	}

	@ViewBuilder private func section<C: View>(_ title: String, count: Int, @ViewBuilder content: () -> C) -> some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			DSGroupHeader(title: title, count: count)
			VStack(spacing: 0) { content() }.dsGroup()
		}
	}
}
