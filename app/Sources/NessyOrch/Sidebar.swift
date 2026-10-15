import SwiftUI
import AppKit
import NessyKit

/// Строка сессии: глиф сводного состояния · название в одну строку · справа число ждущих или точка «новое».
struct SessionRow: View {
	@Environment(AppModel.self) private var model
	var session: SessionView

	var body: some View {
		let store = model.store
		let agents = store.agents(inSession: session.id)
		let sum = agents.summary
		let waiting = sum.needsYou
		let stale = store.isStale(session)
		HStack(spacing: DS.Metrics.s2) {
			DSStateGlyph(state: glyph(sum), size: DS.Metrics.glyphSidebar)
			Text(session.title).font(.subheadline).lineLimit(1).truncationMode(.tail)
				.foregroundStyle(stale || session.status == .done ? DS.Palette.textSecondary : DS.Palette.textPrimary)
			Spacer(minLength: DS.Metrics.s1)
			if waiting > 0 {
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
		.padding(.horizontal, DS.Metrics.s3)
		.frame(minHeight: DS.Metrics.button)
		.contentShape(Rectangle())
		.onTapGesture { model.show(session: session.id) }
		.help(help(agents.count))
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
