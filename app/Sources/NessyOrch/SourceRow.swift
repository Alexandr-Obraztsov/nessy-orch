import SwiftUI
import NessyKit

/// Строка источника (44): символ вида · заголовок / адрес · справа агенты и время. Ссылка открывается; файл и команда — только текст (выделяется).
struct SourceRowView: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openURL) private var openURL
	var source: MergedSource
	@State private var hovering = false

	var body: some View {
		HStack(alignment: .center, spacing: DS.Metrics.s3) {
			Image(systemName: SourceIcon.of(source))
				.font(DS.Typography.secondary)
				.foregroundStyle(DS.Palette.textSecondary)
				.frame(width: DS.Metrics.glyphRow)
			VStack(alignment: .leading, spacing: 2) {
				Text(source.title)
					.font(source.kind == .link ? DS.Typography.body : DS.Typography.mono)
					.foregroundStyle(DS.Palette.textPrimary)
					.lineLimit(1).truncationMode(.middle)
				if !source.detail.isEmpty {
					Text(source.detail).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
						.lineLimit(1).truncationMode(.middle)
				}
			}
			Spacer(minLength: DS.Metrics.s3)
			if hovering, source.kind == .link {
				Image(systemName: "arrow.up.right")
					.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			} else if !source.agents.isEmpty {
				Text(source.agents.joined(separator: ", ") + " · " + Durations.ago(source.date))
					.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
			}
		}
		.padding(.leading, DS.Metrics.s3).padding(.trailing, DS.Metrics.s4).padding(.vertical, DS.Metrics.s1)
		.frame(minHeight: 44)
		.background {
			ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.groupRadius - DS.Metrics.rowInset)), isUniform: true)
				.fill(hovering ? DS.Palette.hover : .clear)
				.padding(DS.Metrics.rowInset)
		}
		.contentShape(Rectangle())
		.onHover { h in withAnimation(h ? DS.Motion.hoverIn : DS.Motion.hoverOut) { hovering = h } }
		.onTapGesture {
			if let h = source.href, let u = URL(string: h) { openURL(u) }
		}
		.help(source.href ?? source.title)
	}
}

enum SourceIcon {
	/// GitLab — код, Jira — задачи, Wiki — книга, прочее — сеть; файл — документ, команда — терминал.
	static func of(_ s: MergedSource) -> String {
		switch s.kind {
		case .file: return "doc.text"
		case .command: return "terminal"
		case .link:
			let h = (s.href.map(ReplyParser.hostOf) ?? "").lowercased()
			if h.contains("gitlab") || h.contains("github") { return "chevron.left.forwardslash.chevron.right" }
			if h.contains("jira") { return "checklist" }
			if h.contains("wiki") || h.contains("confluence") || h.contains("sage") { return "book" }
			return "globe"
		}
	}
}
