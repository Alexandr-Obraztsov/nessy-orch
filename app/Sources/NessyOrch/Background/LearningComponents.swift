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

	init(_ text: String, systemImage: String? = nil, tint: Color = DS.Palette.textSecondary, mono: Bool = false) {
		self.text = text; self.systemImage = systemImage; self.tint = tint; self.mono = mono
	}

	var body: some View {
		HStack(spacing: 4) {
			if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .semibold)) }
			Text(text).lineLimit(1)
		}
		.font(mono ? DS.Typography.monoCaption : DS.Typography.caption)
		.foregroundStyle(tint)
		.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 2)
		.background(DS.Palette.hover, in: Capsule())
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
				.foregroundStyle(DS.Palette.accentText)
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

/// Шапка карточки: крупное название, строка-подпись (статусы, даты) и справа действия.
struct CardHeader<Actions: View>: View {
	var title: String
	var subtitle: String?
	@ViewBuilder var actions: Actions

	init(_ title: String, subtitle: String? = nil, @ViewBuilder actions: () -> Actions) {
		self.title = title; self.subtitle = subtitle; self.actions = actions()
	}

	var body: some View {
		HStack(alignment: .top, spacing: DS.Metrics.s3) {
			VStack(alignment: .leading, spacing: 2) {
				Text(title).font(.system(size: 22, weight: .semibold)).lineLimit(2).textSelection(.enabled)
				if let subtitle, !subtitle.isEmpty { Text(subtitle).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).lineLimit(2) }
			}
			Spacer(minLength: DS.Metrics.s2)
			HStack(spacing: DS.Metrics.s2) { actions }
		}
	}
}

extension CardHeader where Actions == EmptyView {
	init(_ title: String, subtitle: String? = nil) { self.init(title, subtitle: subtitle) { EmptyView() } }
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

/// Пустое состояние раздела: значок, фраза и, если нужно, подсказка.
struct LearningEmptyState: View {
	var systemImage: String
	var title: String
	var message: String?
	init(_ title: String, systemImage: String, message: String? = nil) { self.title = title; self.systemImage = systemImage; self.message = message }
	var body: some View {
		ContentUnavailableView {
			Label(title, systemImage: systemImage)
		} description: {
			if let message { Text(message) }
		}
		.frame(maxWidth: .infinity, minHeight: 220)
	}
}

/// Объект, который выбран, но его больше нет (удалён).
struct DeletedObjectView: View {
	@Environment(AppModel.self) private var model
	var title: String

	var body: some View {
		VStack(spacing: DS.Metrics.s3) {
			LearningEmptyState(title, systemImage: "trash", message: "Его больше нет на сервере.")
			Button("Закрыть") { model.background.forceGo(model.background.section) }.buttonStyle(SettingsButtonStyle())
		}
		.frame(maxWidth: .infinity)
	}
}

// MARK: - Сворачиваемый блок

/// Блок с заголовком-шевроном: сворачивается и разворачивается; `open` — каким он стартует.
struct Collapsible<Content: View>: View {
	var title: String
	var count: Int?
	@State private var open: Bool
	@ViewBuilder var content: Content

	init(_ title: String, count: Int? = nil, open: Bool = true, @ViewBuilder content: () -> Content) {
		self.title = title; self.count = count; self._open = State(initialValue: open); self.content = content()
	}

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s2) {
			DSGroupHeader(title: title, count: count, expanded: $open)
			if open { content.transition(.opacity) }
		}
	}
}

/// Строка списка слева: выделение и подсветка при наведении; содержимое — снаружи.
struct ListRowButton<Content: View>: View {
	var selected: Bool
	var action: () -> Void
	@ViewBuilder var content: Content
	@State private var hover = false

	var body: some View {
		Button(action: action) {
			content
				.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(selected ? DS.Palette.selection : (hover ? DS.Palette.hover : .clear), in: RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous))
				.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.onHover { hover = $0 }
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
		LearningEmptyState("Фоновое обучение недоступно на этом сервере", systemImage: "graduationcap", message: "Обновите службу оркестратора до версии с обучением.")
	}
}

// MARK: - Данные для разделов

extension AppModel {
	/// Названия сессий кейса (без дублей, порядок кейса); сессия, которой нет в оркестраторе, — по id.
	func sessionTitles(of c: CaseView) -> [String] {
		c.sessions.map { id in
			let t = store.session(id)?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			return t.isEmpty ? id : t
		}
	}

	/// Заголовок кейса: свой, иначе название первой сессии, иначе id.
	func title(ofCase c: CaseView) -> String {
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
