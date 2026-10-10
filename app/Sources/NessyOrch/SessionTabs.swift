import SwiftUI
import NessyKit

// MARK: - Вкладка «Источники»

/// Источники сессии по виду: ссылки (по хостам) → файлы → команды. Дубликаты слиты (screens.md §3d).
struct SourcesTab: View {
	@Environment(AppModel.self) private var model
	var session: SessionView
	@State private var items: [SourceView] = []
	@State private var query = ""
	@State private var loaded = false
	@State private var searchShown = false

	var body: some View {
		let sections = SourceSections.build(items, query: query)
		Group {
			if loaded && items.isEmpty {
				ContentUnavailableView {
					Label("Источников пока нет", systemImage: "link")
				} description: {
					Text("Агенты ещё ничего не открывали.")
				}
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: DS.Metrics.s5) {
						// поиск — только когда источников много: при 5 строках он шум
						if items.count > 8 || searchShown { SearchField(text: $query, focusTick: model.searchTick) }
						if sections.isEmpty, !query.isEmpty {
							Text("Ничего не найдено").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
						}
						ForEach(sections) { sec in
							VStack(alignment: .leading, spacing: DS.Metrics.s2) {
								DSGroupHeader(title: sec.title, count: sec.items.count)
								VStack(spacing: 0) {
									ForEach(Array(sec.items.enumerated()), id: \.element.id) { i, s in
										if i > 0 { DSSeparator(leading: DS.Metrics.rowTextX) }
										SourceRowView(source: s)
									}
								}
								.dsGroup()
							}
						}
					}
					.padding(.horizontal, DS.Metrics.contentInset)
					.padding(.top, DS.Metrics.s4).padding(.bottom, DS.Metrics.s6)
				}
				.scrollEdgeEffectStyle(.soft, for: .top)
			}
		}
		.onChange(of: model.searchTick) { _, _ in searchShown = true }
		.task(id: session.id) { await load() }
		.onChange(of: session.sources) { _, _ in Task { await load() } }
	}

	private func load() async {
		if let list = try? await model.store.client.sources(session: session.id) { items = list }
		loaded = true
	}
}

/// Строка источника (44): символ вида · заголовок / адрес · справа агенты и время. Ссылка открывается, файл и команда копируются.
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
			if hovering {
				Image(systemName: source.kind == .link ? "arrow.up.right" : "doc.on.doc")
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
			if let h = source.href, let u = URL(string: h) { openURL(u) } else { copy() }
		}
		.contextMenu { Button(source.kind == .link ? "Скопировать ссылку" : "Скопировать") { copy() } }
		.help(source.href ?? source.title)
	}

	private func copy() {
		Pasteboard.copy(source.href ?? (source.kind == .file ? source.title : source.title))
		model.flash("Скопировано")
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

// MARK: - Вкладка «Статистика»

/// Четыре числа и таблица по агентам; сортировка по клику на столбец. Цвета нет.
struct StatsTab: View {
	var agents: [AgentView]
	@State private var sort: StatColumn = .time
	@State private var ascending = false
	@State private var width: CGFloat = 800
	/// узко: плитки по 2, в таблице только имя, токены и время
	private var narrow: Bool { width < 520 }
	private var columns: [StatColumn] { narrow ? [.name, .tokens, .time] : StatColumn.allCases }

	var body: some View {
		let roll = SessionRollup(agents)
		let missing = agents.count - roll.tokenAgents
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s6) {
				LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: DS.Metrics.s3), count: narrow ? 2 : 4), spacing: DS.Metrics.s3) {
					StatTile(value: roll.tokens.map { Numbers.compact($0.total) } ?? "—", caption: "токенов", number: roll.tokens?.total)
						.help(roll.tokens.map { "вход \(Numbers.compact($0.input)) · выход \(Numbers.compact($0.output)) · кэш \(Numbers.compact($0.cached))" } ?? "")
					StatTile(value: "\(roll.turns)", caption: Durations.plural(roll.turns, "ход", "хода", "ходов"), number: roll.turns)
					StatTile(value: "\(roll.toolCalls)", caption: Durations.plural(roll.toolCalls, "вызов", "вызова", "вызовов"), number: roll.toolCalls)
					StatTile(value: Durations.clock(roll.workMs), caption: "работы", number: Int(roll.workMs / 1000))
				}

				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					DSGroupHeader(title: "По агентам", count: nil)
					VStack(spacing: 0) {
						header
						DSSeparator()
						ForEach(Array(sorted.enumerated()), id: \.element.id) { i, a in
							if i > 0 { DSSeparator(leading: DS.Metrics.rowTextX) }
							row(a)
						}
					}
					.dsGroup()
					if missing > 0, roll.tokenAgents > 0 || agents.count > 0 {
						Text("nessy не сообщил токены для \(Numbers.count(missing, "агента", "агентов", "агентов"))")
							.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
							.padding(.horizontal, DS.Metrics.s1)
					}
				}
			}
			.padding(.horizontal, DS.Metrics.contentInset)
			.padding(.top, DS.Metrics.s4).padding(.bottom, DS.Metrics.s6)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
	}

	private var sorted: [AgentView] {
		agents.sorted { a, b in
			let (x, y) = (sort.key(a), sort.key(b))
			if x != y { return ascending ? x < y : x > y }
			return a.name < b.name
		}
	}

	private var header: some View {
		HStack(spacing: DS.Metrics.s3) {
			ForEach(columns) { c in
				Button {
					if sort == c { ascending.toggle() } else { sort = c; ascending = c == .name }
				} label: {
					HStack(spacing: DS.Metrics.s1) {
						Text(c.title).lineLimit(1).fixedSize()
						if sort == c { Image(systemName: ascending ? "chevron.up" : "chevron.down").font(DS.Typography.caption.weight(.semibold)) }
					}
					.frame(maxWidth: c == .name ? .infinity : c.width, alignment: c == .name ? .leading : .trailing)
					.contentShape(Rectangle())
				}
				.buttonStyle(.plain)
			}
		}
		.font(DS.Typography.caption.weight(.medium))
		.foregroundStyle(DS.Palette.textSecondary)
		.padding(.leading, DS.Metrics.rowTextX).padding(.trailing, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
	}

	private func row(_ a: AgentView) -> some View {
		HStack(spacing: DS.Metrics.s3) {
			HStack(spacing: DS.Metrics.s3) {
				DSStateGlyph(state: a.ds)
				Text(a.name).foregroundStyle(DS.Palette.textPrimary).lineLimit(1)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			cell(a.stats.tokens.map { Numbers.compact($0.total) } ?? "—", .tokens)
			if !narrow { cell("\(a.stats.turns)", .turns); cell("\(a.stats.toolCalls)", .calls) }
			cell(a.stats.workMs >= 1000 ? Durations.clock(a.stats.workMs) : "—", .time)
		}
		.font(DS.Typography.secondary)
		.padding(.leading, DS.Metrics.s3).padding(.trailing, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
	}

	private func cell(_ t: String, _ c: StatColumn) -> some View {
		Text(t).monospacedDigit().lineLimit(1).foregroundStyle(DS.Palette.textSecondary).frame(width: c.width, alignment: .trailing)
	}
}

enum StatColumn: String, CaseIterable, Identifiable {
	case name, tokens, turns, calls, time
	var id: String { rawValue }
	var title: String {
		switch self {
		case .name: "Агент"
		case .tokens: "Токены"
		case .turns: "Ходы"
		case .calls: "Вызовы"
		case .time: "Время"
		}
	}
	var width: CGFloat {
		switch self {
		case .name: 0
		case .tokens: 76
		case .turns, .calls: 56
		case .time: 68
		}
	}
	func key(_ a: AgentView) -> String {
		switch self {
		case .name: a.name
		case .tokens: String(format: "%012d", a.stats.tokens?.total ?? -1)
		case .turns: String(format: "%08d", a.stats.turns)
		case .calls: String(format: "%08d", a.stats.toolCalls)
		case .time: String(format: "%016.0f", a.stats.workMs)
		}
	}
}

/// Плитка (88): число сверху, подпись снизу.
struct StatTile: View {
	var value: String
	var caption: String
	var number: Int?
	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			Text(value).font(DS.Typography.metric).foregroundStyle(DS.Palette.textPrimary).lineLimit(1).minimumScaleFactor(0.5)
				.contentTransition(.numericText(value: Double(number ?? 0)))
				.animation(DS.Motion.counter, value: number)
			Text(caption).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
		}
		.padding(DS.Metrics.s4)
		.frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
		.dsGroup()
	}
}

/// Поиск по источникам: поле на поверхности группы, ⌘F фокусирует.
struct SearchField: View {
	@Binding var text: String
	var focusTick = 0
	@FocusState private var focused: Bool
	var body: some View {
		HStack(spacing: DS.Metrics.s2) {
			Image(systemName: "magnifyingglass").foregroundStyle(DS.Palette.textSecondary)
			TextField("Поиск в источниках", text: $text).textFieldStyle(.plain).focused($focused)
			if !text.isEmpty {
				Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }
					.buttonStyle(.borderless).foregroundStyle(DS.Palette.textSecondary)
			}
		}
		.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
		.dsGroup()
		.onAppear { if focusTick > 0 { focused = true } }
		.onChange(of: focusTick) { _, _ in focused = true }
	}
}
