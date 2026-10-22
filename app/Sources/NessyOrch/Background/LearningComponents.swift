import SwiftUI
import NessyKit

// Общие компоненты окна «Фон»: их используют все разделы. Раздел нужного себе не добавляет сюда, а держит у себя.

// MARK: - Чипы

/// Плашка-метка: источник, тип задачи, статус. Цвет — только у того, что требует внимания (`tint`).
struct LearningChip: View {
	var text: String
	var systemImage: String?
	var tint: Color = DS.Palette.textSecondary
	var mono = false
	/// точка-индикатор слева (акцентом): метка «ждёт вас» остаётся серой, цветом выделена только точка
	var dot: Color?

	init(_ text: String, systemImage: String? = nil, tint: Color = DS.Palette.textSecondary, mono: Bool = false, dot: Color? = nil) {
		self.text = text; self.systemImage = systemImage; self.tint = tint; self.mono = mono; self.dot = dot
	}

	var body: some View {
		HStack(spacing: 4) {
			if let dot { Circle().fill(dot).frame(width: 6, height: 6) }
			if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .semibold)) }
			Text(text).lineLimit(1)
		}
		.font(mono ? DS.Typography.monoCaption : DS.Typography.caption)
		.foregroundStyle(tint)
		.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 2)
		.background(DS.Palette.hover, in: Capsule())
	}
}

/// Ссылка-строка: значок и текст `textSecondary`; под курсором текст темнеет и подчёркивается.
struct LinkLine: View {
	var text: String
	var systemImage: String
	var help: String
	var action: () -> Void
	@State private var hover = false

	var body: some View {
		Button(action: action) {
			HStack(spacing: DS.Metrics.s1) {
				Image(systemName: systemImage).font(.system(size: 10, weight: .semibold))
				Text(text).lineLimit(1).underline(hover)
			}
			.font(DS.Typography.caption)
			.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.onHover { hover = $0 }
		.help(help)
	}
}

/// Чипы источников (`wiki`, `gitlab`, …): переносятся на следующую строку.
struct SourceChips: View {
	var sources: [String]
	var body: some View {
		if !sources.isEmpty {
			FlowLayout(spacing: DS.Metrics.s1) {
				ForEach(Array(sources.enumerated()), id: \.offset) { _, s in LearningChip(BackgroundLogic.plain(s), systemImage: Self.icon(s), mono: true) }
			}
		}
	}

	static func icon(_ s: String) -> String {
		let l = s.lowercased()
		if l.contains("gitlab") || l.contains("git") { return "arrow.triangle.branch" }
		if l.contains("jira") { return "ticket" }
		if l.contains("wiki") || l.contains("sage") { return "book" }
		return "doc.text"
	}
}

/// Перенос по строкам для рядов чипов.
struct FlowLayout: Layout {
	var spacing: CGFloat = DS.Metrics.s1

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		arrange(proposal.width ?? .infinity, subviews).size
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let r = arrange(bounds.width, subviews)
		for (i, f) in r.frames.enumerated() { subviews[i].place(at: CGPoint(x: bounds.minX + f.minX, y: bounds.minY + f.minY), proposal: .unspecified) }
	}

	private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
		var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
		var frames: [CGRect] = []
		for s in subviews {
			let sz = s.sizeThatFits(.unspecified)
			if x > 0, x + sz.width > width { x = 0; y += rowH + spacing; rowH = 0 }
			frames.append(CGRect(origin: CGPoint(x: x, y: y), size: sz))
			x += sz.width + spacing; rowH = max(rowH, sz.height); maxX = max(maxX, x - spacing)
		}
		return (CGSize(width: maxX, height: y + rowH), frames)
	}
}

// MARK: - Якорь и события кейса

/// Кнопка-якорь «n 3–7»: поповер с событиями кейса (`GET /learning/cases/:id/raw`), по ним видно место в сессии.
struct AnchorButton: View {
	var caseId: String
	var range: ClosedRange<Int>
	@State private var open = false

	/// Из строки доказательства «n 3–7»; не якорь — кнопки нет.
	init?(caseId: String, anchor: String) {
		guard let r = LearningText.parseAnchor(anchor) else { return nil }
		self.init(caseId: caseId, range: r)
	}
	init(caseId: String, range: ClosedRange<Int>) { self.caseId = caseId; self.range = range }

	var body: some View {
		Button { open.toggle() } label: {
			Text(LearningText.anchor(range)).font(DS.Typography.monoCaption)
				.foregroundStyle(DS.Palette.textSecondary)
				.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 2)
				.background(DS.Palette.hover, in: Capsule())
				.contentShape(Capsule())
		}
		.buttonStyle(.plain)
		.help("Показать события сессии")
		.popover(isPresented: $open, arrowEdge: .bottom) {
			RawEventsList(caseId: caseId, range: range).frame(width: 460, height: 340)
		}
	}
}

/// События кейса `from…to` списком: номер, кто кому, время, текст (длинный раскрывается). Грузится, когда появляется на экране.
struct RawEventsList: View {
	@Environment(AppModel.self) private var model
	var caseId: String
	var range: ClosedRange<Int>
	@State private var events: [RawEvent]?
	@State private var failure: String?

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s3) {
				if let events {
					if events.isEmpty { Text("В этом диапазоне событий нет.").font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary) }
					ForEach(events) { e in event(e) }
					if let note = LearningText.rawLimitNote(count: events.count) { Text(note).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
				} else if let failure {
					Label(failure, systemImage: "exclamationmark.triangle").font(DS.Typography.secondary).foregroundStyle(DS.Palette.danger)
				} else {
					ProgressView().controlSize(.small).frame(maxWidth: .infinity)
				}
			}
			.padding(DS.Metrics.s3)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.task(id: "\(caseId)#\(range)") {
			events = nil; failure = nil
			do { events = try await model.store.client.caseRaw(caseId, from: range.lowerBound, to: range.upperBound) }
			catch { failure = error.localizedDescription }
		}
	}

	private func event(_ e: RawEvent) -> some View {
		VStack(alignment: .leading, spacing: 2) {
			HStack(spacing: DS.Metrics.s2) {
				Text("n \(e.n)").font(DS.Typography.monoCaption).foregroundStyle(DS.Palette.textTertiary)
				Text(e.to.map { "\(e.from) → \($0)" } ?? e.from).font(DS.Typography.caption.weight(.semibold)).foregroundStyle(DS.Palette.textSecondary).lineLimit(1)
				Text(LearningText.rawKind(e.kind)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
				Spacer(minLength: 0)
				Text(e.date.formatted(date: .omitted, time: .shortened)).font(DS.Typography.timer).foregroundStyle(DS.Palette.textTertiary)
			}
			LongText(e.text, lines: 4)
		}
	}
}

// MARK: - Заголовок карточки

/// Шапка правого блока: название, под ним одна строка метаданных, справа действия, «⋯» (если есть удаление) и ✕ (Esc тоже закрывает).
struct PanelHeader<Actions: View>: View {
	@Environment(AppModel.self) private var model
	var title: String
	var subtitle: String?
	var onDelete: (() -> Void)?
	@ViewBuilder var actions: Actions

	init(_ title: String, subtitle: String? = nil, onDelete: (() -> Void)? = nil, @ViewBuilder actions: () -> Actions) {
		self.title = title; self.subtitle = subtitle; self.onDelete = onDelete; self.actions = actions()
	}

	var body: some View {
		HStack(alignment: .top, spacing: DS.Metrics.s3) {
			VStack(alignment: .leading, spacing: 2) {
				Text(title).font(DS.Typography.panelTitle).lineLimit(2).textSelection(.enabled)
				if let subtitle, !subtitle.isEmpty { Text(subtitle).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).lineLimit(1) }
			}
			Spacer(minLength: DS.Metrics.s2)
			HStack(spacing: DS.Metrics.s2) {
				actions.buttonStyle(SettingsButtonStyle())
				if let onDelete {
					Menu {
						Button("Удалить…", role: .destructive, action: onDelete)
					} label: { Image(systemName: "ellipsis").foregroundStyle(DS.Palette.textSecondary) }
						.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
						.help("Ещё")
				}
			}
			.disabled(model.isOffline)
			PlainIconButton(systemImage: "xmark", help: "Закрыть", size: 24) { model.background.close() }
				.keyboardShortcut(.cancelAction)
		}
		.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
	}
}

extension PanelHeader where Actions == EmptyView {
	init(_ title: String, subtitle: String? = nil, onDelete: (() -> Void)? = nil) { self.init(title, subtitle: subtitle, onDelete: onDelete) { EmptyView() } }
}

// MARK: - Длинный текст

/// Блок длинного текста: свёрнут до `lines` строк, раскрывается по кнопке. Ленивый: полный текст строится, только когда раскрыт,
/// пока свёрнут — выводится его начало (`preview` знаков), так что сотни килобайт ответа агента не тормозят список.
struct LongText: View {
	var text: String
	var lines: Int
	var markdown: Bool
	var preview = 600
	@State private var open = false

	init(_ text: String, lines: Int = 6, markdown: Bool = false) { self.text = text; self.lines = lines; self.markdown = markdown }

	var body: some View {
		// длину и строки меряет `LongTextMeasure`: стоимость ограничена `preview`, как бы ни был велик текст
		let long = LongTextMeasure.isLong(text, preview: preview, lines: lines)
		return VStack(alignment: .leading, spacing: DS.Metrics.s1) {
			if open {
				if markdown { MarkdownView(text: text) }
				else { Text(text).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
			} else {
				Text(long ? String(text.prefix(preview)) : text)
					.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary)
					.lineLimit(lines).frame(maxWidth: .infinity, alignment: .leading)
			}
			if long {
				Button(open ? "Свернуть" : "Показать полностью") { withAnimation(dsAnimation(DS.Motion.disclosure)) { open.toggle() } }
					.buttonStyle(.plain).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
			}
		}
	}
}

// MARK: - Пустые и служебные состояния

/// Пустое состояние: одна строка.
struct LearningEmptyState: View {
	var title: String
	init(_ title: String) { self.title = title }
	var body: some View {
		Text(title).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
			.frame(maxWidth: .infinity, minHeight: 120)
	}
}

// MARK: - Сворачиваемый блок

/// Раздел правого блока: тонкий разделитель сверху, заголовок со стрелкой слева и счётчиком; `open` — каким стартует.
/// Лежит прямо на поверхности панели (без рамок), поля — `s4`.
struct Collapsible<Content: View>: View {
	var title: String
	var count: Int?
	@State private var open: Bool
	@ViewBuilder var content: Content

	init(_ title: String, count: Int? = nil, open: Bool = true, @ViewBuilder content: () -> Content) {
		self.title = title; self.count = count; self._open = State(initialValue: open); self.content = content()
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			DSSeparator()
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				DSGroupHeader(title: title, count: count, expanded: $open)
				if open { content }
			}
			.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
		}
	}
}

/// Карточка списка: скруглённая поверхность, у выбранной — рамка акцентом, при наведении — лёгкая подсветка.
/// Все карточки окна «Фон» — одной высоты (список ровный, как в сетке плиток).
enum CardMetrics { static let height: CGFloat = 96 }

struct CardButton<Content: View>: View {
	var selected: Bool
	var action: () -> Void
	@ViewBuilder var content: Content
	@State private var hover = false

	var body: some View {
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous)
		Button(action: action) {
			content
				.padding(DS.Metrics.s4)
				.frame(maxWidth: .infinity, minHeight: CardMetrics.height, maxHeight: CardMetrics.height, alignment: .topLeading)
				.background(DS.Palette.surface, in: shape)
				.background(hover && !selected ? DS.Palette.hover : .clear, in: shape)
				.overlay(shape.strokeBorder(selected ? DS.Palette.accent : DS.Palette.border, lineWidth: selected ? 1.5 : DS.Metrics.hairline))
				.contentShape(shape)
		}
		.buttonStyle(.plain)
		.onHover { hover = $0 }
		.accessibilityAddTraits(selected ? .isSelected : [])
	}
}

/// Сетка карточек: столбцы подстраиваются под ширину.
struct CardGrid<Item: Identifiable, Card: View>: View {
	var items: [Item]
	@ViewBuilder var card: (Item) -> Card

	var body: some View {
		LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: DS.Metrics.s3, alignment: .top)], alignment: .leading, spacing: DS.Metrics.s3) {
			ForEach(items) { card($0) }
		}
	}
}

/// Группа карточек с заголовком; пустая не показывается.
struct CardGroup<Item: Identifiable, Card: View>: View {
	var title: String
	var items: [Item]
	@ViewBuilder var card: (Item) -> Card

	var body: some View {
		if !items.isEmpty {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				DSGroupHeader(title: title, count: items.count)
				CardGrid(items: items, card: card)
			}
		}
	}
}

/// Полоса прогресса чтения сессии.
struct ProgressBar: View {
	var progress: JobProgress?

	var body: some View {
		GeometryReader { geo in
			ZStack(alignment: .leading) {
				Capsule().fill(DS.Palette.separator)
				Capsule().fill(DS.Palette.textSecondary).frame(width: max(DS.Metrics.progressSize.height, geo.size.width * BackgroundLogic.progressFraction(progress)))
			}
		}
		.frame(height: DS.Metrics.progressSize.height)
		.animation(DS.Motion.progress, value: BackgroundLogic.progressFraction(progress))
	}
}

/// Область раздела: карточки на всю ширину и, когда объект выбран, справа выезжающий блок. Левый край блока тянется мышью;
/// двойной щелчок по нему — ширина по умолчанию.
struct BackgroundSplit<Cards: View, Panel: View>: View {
	@Environment(AppModel.self) private var model
	var open: Bool
	@ViewBuilder var cards: Cards
	@ViewBuilder var panel: Panel
	@State private var start: CGFloat?

	private let minCards: CGFloat = 320

	var body: some View {
		GeometryReader { geo in
			let nav = model.background
			let width = min(nav.panelWidth, max(DS.Metrics.sidePanelWidth.min, geo.size.width - minCards))
			let shape = RoundedRectangle(cornerRadius: DS.Metrics.panelRadius, style: .continuous)
			HStack(spacing: 0) {
				cards.frame(maxWidth: .infinity, maxHeight: .infinity)
				if open {
					panel
						.frame(width: width).frame(maxHeight: .infinity)
						.background(DS.Palette.surface, in: shape)
						.overlay(shape.strokeBorder(DS.Palette.border, lineWidth: DS.Metrics.hairline))
						.clipShape(shape)
						.overlay(alignment: .leading) {
							Color.clear.frame(width: 8).contentShape(Rectangle())
								.pointerStyle(.columnResize)
								.gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
									.onChanged { g in
										if start == nil { start = width }
										nav.setPanelWidth((start ?? width) - g.translation.width)
									}
									.onEnded { _ in start = nil })
								.onTapGesture(count: 2) { nav.setPanelWidth(DS.Metrics.sidePanelWidth.ideal) }
								.help("Потяните, чтобы изменить ширину")
						}
						.padding(.trailing, DS.Metrics.s2).padding(.vertical, DS.Metrics.s2)
						.transition(.move(edge: .trailing).combined(with: .opacity))
				}
			}
			.animation(start == nil ? dsAnimation(DS.Motion.panel) : nil, value: open)
		}
	}
}

/// Строка «нет связи»: данные остаются прежними, поверх них — тихая полоса со временем последних данных.
struct LearningOfflineLine: View {
	@Environment(AppModel.self) private var model
	var body: some View {
		if model.isOffline {
			HStack(spacing: DS.Metrics.s2) {
				Image(systemName: "bolt.slash.fill").foregroundStyle(DS.Palette.danger)
				Text("Нет связи с оркестратором").foregroundStyle(DS.Palette.textPrimary)
				if let t = model.frozenAt { Text("· данные на \(t.formatted(date: .omitted, time: .shortened))").foregroundStyle(DS.Palette.textSecondary) }
				Spacer(minLength: 0)
			}
			.font(DS.Typography.secondary)
			.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s2)
			.background(DS.Palette.dangerTint)
		}
	}
}

/// Сервер не умеет обучение (старая версия) — вместо содержимого окна.
struct LearningUnavailableView: View {
	var body: some View {
		LearningEmptyState("Фоновое обучение недоступно: обновите службу оркестратора")
	}
}

// MARK: - Данные для разделов

extension AppModel {
	/// Названия сессий кейса (порядок кейса); сессия, которой нет в оркестраторе, — по id.
	func sessionTitles(of c: CaseView) -> [String] {
		c.sessions.map { id in
			let t = store.session(id)?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			return t.isEmpty ? id : t
		}
	}

	/// Название кейса — название его сессии (как в списке сессий); своё название кейса — только если сессии нет в оркестраторе.
	func title(ofCase c: CaseView) -> String {
		if let id = c.sessions.first(where: { store.session($0).map { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? false }),
			let t = store.session(id)?.title.trimmingCharacters(in: .whitespacesAndNewlines) { return t }
		if let t = c.title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
		return sessionTitles(of: c).first ?? c.id
	}
}

extension Date {
	/// «сегодня 14:05» / «вчера 09:10» / «12 окт, 09:10» — дата в строках разделов.
	var learningStamp: String {
		let cal = Calendar.current
		let time = formatted(date: .omitted, time: .shortened)
		if cal.isDateInToday(self) { return "сегодня \(time)" }
		if cal.isDateInYesterday(self) { return "вчера \(time)" }
		return formatted(.dateTime.day().month(.abbreviated)) + ", " + time
	}
}
