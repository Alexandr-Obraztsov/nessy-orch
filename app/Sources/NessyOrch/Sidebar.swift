import SwiftUI
import NessyKit

/// Сайдбар: только сессии. «Активные» и «Завершённые» (свёрнута). Связь — только при обрыве (полоса над контентом).
struct SidebarView: View {
	@Environment(AppModel.self) private var model
	@State private var showDone = false
	@Environment(\.openWindow) private var openWindow

	var body: some View {
		let store = model.store
		List(selection: Binding<Route?>(get: { model.route }, set: { if let r = $0, r != model.route { model.open(agent: nil); model.route = r } })) {
			if !store.activeSessions.isEmpty {
				Section("Активные") {
					ForEach(store.activeSessions) { SessionRow(session: $0).tag(Route.session($0.id)) }
				}
			}
			if !store.doneSessions.isEmpty {
				Section(isExpanded: $showDone) {
					ForEach(store.doneSessions.prefix(50)) { SessionRow(session: $0).tag(Route.session($0.id)) }
				} header: {
					HStack { Text("Завершённые"); Spacer(); DSCount(value: store.doneSessions.count) }
				}
			}
		}
		.listStyle(.sidebar)
		// пункты крупнее и воздушнее, как в Finder macOS 26; плавающую стеклянную панель даёт сам NavigationSplitView
		.environment(\.sidebarRowSize, .medium)
		.safeAreaInset(edge: .bottom, spacing: 0) {
			Button { openWindow(id: "roles") } label: {
				Label("Роли", systemImage: "person.text.rectangle").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
					.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
			}
			.buttonStyle(.plain).padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
			.help("Роли агентов (⇧⌘R)")
		}
	}
}

/// Строка сессии: глиф сводного состояния · название (до 2 строк) · справа число ждущих (янтарь) или точка «новое».
struct SessionRow: View {
	@Environment(AppModel.self) private var model
	var session: SessionView

	var body: some View {
		let store = model.store
		let agents = store.agents(inSession: session.id)
		let sum = agents.summary
		let waiting = sum.needsYou
		let stale = store.isStale(session)
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
			DSStateGlyph(state: glyph(sum), size: DS.Metrics.glyphSidebar)
				.alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 3 }
			Text(session.title).font(.subheadline).lineLimit(2)
				.foregroundStyle(stale || session.status == .done ? DS.Palette.textSecondary : DS.Palette.textPrimary)
			Spacer(minLength: DS.Metrics.s1)
			if waiting > 0 {
				// «ждут вас» — залитый синий бейдж
				DSCount(value: waiting)
					.font(DS.Typography.caption.weight(.semibold))
					.foregroundStyle(.white)
					.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 1)
					.background(DS.Palette.accent, in: Capsule())
					.help("Ждут вас: \(waiting)")
			} else if store.hasNew(session: session.id) {
				DSNewDot()
			}
		}
		.help(help(agents.count))
		.contextMenu {
			Button("Скопировать ссылку") { Pasteboard.copy("nessy-orch://session/\(session.id)") }
			if session.status == .active { Button("Завершить сессию") { model.closeSession(session.id) } }
			else { Button("Вернуть в работу") { model.reopenSession(session.id) } }
			Divider()
			Button("Удалить", role: .destructive) { model.deleteSession(session.id) }
		}
		.accessibilityElement(children: .combine)
	}

	/// ✋ ждут вас · ⨯ ошибка · ◌ работают · ✓ завершена · пунктир — тихо.
	private func glyph(_ s: SessionSummary) -> DS.AgentState {
		if session.status == .done { return .done }
		if s.wait > 0 { return .wait }
		if s.needsYou > 0 { return .error }
		if s.working > 0 { return .working }
		return .idle
	}

	private func help(_ n: Int) -> String {
		var p = [Numbers.count(n, "агент", "агента", "агентов")]
		if let o = session.owner { p.append(o) }
		if let d = ISO.parse(session.updatedAt) { p.append(Durations.ago(d)) }
		return p.joined(separator: " · ")
	}
}
