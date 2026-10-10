import SwiftUI
import AppKit
import NessyKit

/// Дизайн-система nessy (docs/design/design-system.md). Цвет — только у того, что требует внимания.
enum DS {
	enum AgentState { case idle, working, wait, error, done }
	enum Tone { case neutral, accent, attention, danger }
}

// MARK: - Цвет

extension DS {
	enum Palette {
		static let windowBackground = Color.ds(0xF2F2F4, 0x1B1B1D)
		/// фон терминала и окна-терминала: один цвет (шапка, углы за панелью и терминал не выделяются)
		/// колонка боковой панели: чуть светлее терминала
		static let sidebarSurface = Color.ds(0xF3F3F5, 0x1C1C1E)
		/// плитка боковой панели: один ровный цвет
		static let panelSurface = Color.ds(0xF7F7F9, 0x242427)
		static let terminalBackground = Color.ds(0xFBFBFC, 0x1C1C1E)
		static let surface = Color.ds(0xFFFFFF, 0x262628)
		static let panel = Color.ds(0xFFFFFF, 0x2C2C2F)
		static let separator = Color.ds(0x000000, 0xFFFFFF, alpha: 0.10, hcAlpha: 0.28)
		static let hover = Color.ds(0x000000, 0xFFFFFF, alpha: 0.06, hcAlpha: 0.10)
		static let selection = Color.ds(0xE3EEFC, 0x2A2E38)
		static let textPrimary = Color.ds(0x1D1D1F, 0xF2F2F4, hc: (0x000000, 0xFFFFFF))
		static let textSecondary = Color.ds(0x5F5F66, 0xA3A3AA, hc: (0x3A3A3F, 0xD0D0D5))
		static let textTertiary = Color.ds(0x86868C, 0x76767C, hc: (0x5F5F66, 0xA3A3AA))
		static let accent = Color.ds(0x0A6CE0, 0x1F6FE0)
		static let accentText = Color.ds(0x0066D6, 0x4CA2FF, hc: (0x004FA8, 0x7DBBFF))
		/// «ждёт вас» — тот же синий nessy, что и акцент (оранжевого в интерфейсе нет)
		static let attention = Color.ds(0x0066D6, 0x4CA2FF, hc: (0x004FA8, 0x7DBBFF))
		/// подложка запроса прав: акцент 10 % (HC — 16 %) + обводка attentionStroke
		static let attentionTint = Color.ds(0x0A6CE0, 0x1F6FE0, alpha: 0.10, hcAlpha: 0.16)
		static let attentionStroke = Color.ds(0x0A6CE0, 0x4CA2FF, alpha: 0.35, hcAlpha: 0.6)
		static let danger = Color.ds(0xC9001A, 0xFF5C52, hc: (0x9E0014, 0xFF8A82))
		static let dangerTint = Color.ds(0xFDECEC, 0x3A1C1C)
		static let quiet = Color.ds(0x8E8E93, 0x7C7C82, hc: (0x5F5F66, 0xA3A3AA))

		static func tone(_ t: Tone) -> Color {
			switch t {
			case .neutral: textSecondary
			case .accent: accentText
			case .attention: attention
			case .danger: danger
			}
		}
	}
}

extension Color {
	/// Динамический цвет: светлая/тёмная тема и «Увеличить контраст» (hc) — через NSColor(name:).
	static func ds(_ light: UInt32, _ dark: UInt32, alpha: Double = 1, hcAlpha: Double? = nil, hc: (UInt32, UInt32)? = nil) -> Color {
		Color(nsColor: NSColor(name: nil) { appearance in
			let match = appearance.bestMatch(from: [.aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua])
			let isDark = match == .darkAqua || match == .accessibilityHighContrastDarkAqua
			let isHC = match == .accessibilityHighContrastAqua || match == .accessibilityHighContrastDarkAqua
			let hex = isHC ? (hc.map { isDark ? $0.1 : $0.0 } ?? (isDark ? dark : light)) : (isDark ? dark : light)
			let a = isHC ? (hcAlpha ?? alpha) : alpha
			return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
						   blue: CGFloat(hex & 0xFF) / 255, alpha: CGFloat(a))
		})
	}
}

// MARK: - Типографика (только системные стили: трекинг и оптический размер подставляет SF)

extension DS {
	enum Typography {
		static let panelTitle = Font.title3.weight(.semibold)
		static let groupTitle = Font.subheadline.weight(.semibold)
		static let agentName = Font.body.weight(.semibold)
		static let body = Font.body
		/// первая фраза ответа в окне агента — крупнее остального текста, тем же весом
		static let lead = Font.title3
		static let secondary = Font.callout
		static let caption = Font.subheadline
		static let mono = Font.system(.callout, design: .monospaced)
		static let monoCaption = Font.system(.subheadline, design: .monospaced)
		static let metric = Font.title.weight(.semibold).monospacedDigit()
		static let timer = Font.callout.monospacedDigit()
		static let readingLineSpacing: CGFloat = 3
	}
}

// MARK: - Сетка и размеры (шаг 4 pt)

extension DS {
	enum Metrics {
		static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24, s8: CGFloat = 32
		static let contentInset: CGFloat = 20
		static let sidebarWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (240, 264, 300)
		/// окно агента: screens.md §2 (400, 360…480) — под окно 900×600
		static let agentPanelWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (360, 400, 480)
		/// левая панель агентов (layout-v2.md, итог): 300…440, по умолчанию 340
		static let sidePanelWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) = (240, 300, 520)
		static let panelInset: CGFloat = 8
		static let panelRadius: CGFloat = 22
		/// круглые кнопки: 36 — везде, 40 — в тулбаре; иконка 16–17 pt (layout-v2.md, «Кнопки»)
		static let button: CGFloat = 36, toolbarButton: CGFloat = 40, buttonIcon: CGFloat = 16.5
		static let groupRadius: CGFloat = 12
		/// плавающие карточки панели агента (шапка, цель, план, поле ввода)
		static let cardRadius: CGFloat = 16
		static let rowInset: CGFloat = 4
		static let panelRadiusFallback: CGFloat = 18
		static let glyphRow: CGFloat = 16, glyphSidebar: CGFloat = 14, glyphHeader: CGFloat = 20
		static let progressSize = CGSize(width: 48, height: 3)
		/// отступ текста строки агента от левого края: 12 + глиф 16 + 12
		static let rowTextX: CGFloat = 40
		static let hairline: CGFloat = 0.5
		static let hairlineHC: CGFloat = 1
	}
}

// MARK: - Движение (всё критически задемпфировано; без отскоков — нет жестов с инерцией)

extension DS {
	enum Motion {
		static let panel = Animation.spring(response: 0.35, dampingFraction: 1.0)
		static let layout = Animation.spring(response: 0.4, dampingFraction: 1.0)
		static let disclosure = Animation.snappy(duration: 0.25)
		static let progress = Animation.spring(response: 0.5, dampingFraction: 1.0)
		static let counter = Animation.snappy(duration: 0.25)
		static let fade = Animation.smooth(duration: 0.2)
		static let hoverIn = Animation.easeOut(duration: 0.12)
		static let hoverOut = Animation.easeOut(duration: 0.2)
		static let reduced = Animation.easeInOut(duration: 0.15)

		static func pick(_ a: Animation, reduceMotion: Bool) -> Animation { reduceMotion ? reduced : a }

		/// Окно агента: приходит справа и уходит туда же (симметрично).
		static func panelTransition(reduceMotion: Bool) -> AnyTransition {
			reduceMotion ? .opacity : .opacity.combined(with: .offset(x: 24)).combined(with: .scale(scale: 0.98, anchor: .trailing))
		}

		/// Боковая панель: выезжает от своего края и уходит туда же.
		static func sideTransition(edge: Edge, reduceMotion: Bool) -> AnyTransition {
			reduceMotion ? .opacity : .move(edge: edge).combined(with: .opacity)
		}

		static func rowTransition(reduceMotion: Bool) -> AnyTransition {
			reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top))
		}
	}
}

/// Пружина с учётом Reduce Motion — для withAnimation вне View.
@MainActor
func dsAnimation(_ a: Animation) -> Animation {
	DS.Motion.pick(a, reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
}

// MARK: - Модификаторы

extension View {
	/// Контентная группа: непрозрачная поверхность + волосяная обводка (HC — 1 pt). Внутренние формы — концентричные.
	func dsGroup() -> some View { modifier(DSGroup()) }

	/// Плавающее окно агента: непрозрачная поверхность, тень, форма концентрична окну.
	func dsPanel() -> some View { modifier(DSPanelSurface()) }

	/// Карточка панели агента: стеклянный слой поверх чата, одинаковый радиус у всех карточек.
	func dsFloatingCard() -> some View {
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.cardRadius, style: .continuous)
		// непрозрачный слой: чат прокручивается под карточкой и не должен просвечивать сквозь текст
		return self
			.background(.regularMaterial, in: shape)
			.background(DS.Palette.hover, in: shape)
			.overlay(shape.strokeBorder(DS.Palette.separator, lineWidth: DS.Metrics.hairline))
	}

	/// Плавающая панель на Liquid Glass, как системный сайдбар.
	func dsGlassPanel() -> some View { modifier(DSGlassPanel()) }

	/// Стекло — только слой управления (тосты, плавающие кнопки). Тинт — только у главного действия.
	func dsControlGlass(prominent: Bool = false) -> some View {
		self.glassEffect(.regular.tint(prominent ? DS.Palette.accent : nil).interactive(), in: Capsule())
	}

	func dsHover(active: Bool = true) -> some View { modifier(DSHover(active: active)) }
}

private struct DSGroup: ViewModifier {
	@Environment(\.colorSchemeContrast) private var contrast
	func body(content: Content) -> some View {
		let shape = RoundedRectangle(cornerRadius: DS.Metrics.groupRadius, style: .continuous)
		content
			.background(DS.Palette.surface, in: shape)
			.clipShape(shape)
			.overlay(shape.strokeBorder(DS.Palette.separator, lineWidth: contrast == .increased ? DS.Metrics.hairlineHC : DS.Metrics.hairline))
			.containerShape(shape)
	}
}

private struct DSPanelSurface: ViewModifier {
	@Environment(\.colorSchemeContrast) private var contrast
	func body(content: Content) -> some View {
		let shape = ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.panelRadiusFallback)), isUniform: true)
		content
			.background(DS.Palette.panel, in: shape)
			.clipShape(shape)
			.overlay(shape.stroke(DS.Palette.separator, lineWidth: contrast == .increased ? DS.Metrics.hairlineHC : DS.Metrics.hairline))
			.shadow(color: .black.opacity(0.18), radius: 24, y: 8)
			.shadow(color: .black.opacity(0.08), radius: 2, y: 1)
	}
}

private struct DSGlassPanel: ViewModifier {
	func body(content: Content) -> some View {
		let shape = ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.panelRadiusFallback)), isUniform: true)
		content
			.clipShape(shape)
			.glassEffect(.regular, in: shape)
	}
}

private struct DSHover: ViewModifier {
	var active: Bool
	@State private var hovering = false
	func body(content: Content) -> some View {
		content
			.background {
				ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.groupRadius - DS.Metrics.rowInset)), isUniform: true)
					.fill(hovering && active ? DS.Palette.hover : .clear)
					.padding(DS.Metrics.rowInset)
			}
			.onHover { h in withAnimation(h ? DS.Motion.hoverIn : DS.Motion.hoverOut) { hovering = h } }
	}
}

/// Волосяная линия-разделитель с учётом Increase Contrast.
struct DSSeparator: View {
	var leading: CGFloat = 0
	@Environment(\.colorSchemeContrast) private var contrast
	var body: some View {
		Rectangle().fill(DS.Palette.separator)
			.frame(height: contrast == .increased ? DS.Metrics.hairlineHC : DS.Metrics.hairline)
			.padding(.leading, leading)
	}
}

// MARK: - Связка с моделью

extension AgentView {
	/// Состояние для глифа: блокировка — «ждёт вас» с причиной (design-system.md §6).
	var ds: DS.AgentState {
		if isBlocked { return .error }
		switch state {
		case .wait: return .wait
		case .working, .starting: return .working
		case .error: return .error
		case .done: return .done
		case .idle: return .idle
		}
	}

	/// Слово состояния по словарю (screens.md §6).
	var stateWord: String {
		if let c = replyCode, c != .done, state == .done || state == .idle { return c.label }
		return state.label
	}
}

extension NessyKit.AgentState {
	var ds: DS.AgentState {
		switch self {
		case .wait: .wait
		case .working, .starting: .working
		case .error: .error
		case .done: .done
		case .idle: .idle
		}
	}
}

// MARK: - Примитивы

/// Глиф состояния: форма различает состояния без цвета. «Работает» — серое вращение, «ждёт» — синяя рука с мягкой пульсацией.
struct DSStateGlyph: View {
	var state: DS.AgentState
	var size: CGFloat = DS.Metrics.glyphRow
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var bounce = 0

	var body: some View {
		Group {
			switch state {
			case .working:
				DSSpinner(size: size, still: reduceMotion)
			case .wait:
				Image(systemName: "hand.raised.fill").foregroundStyle(DS.Palette.attention)
					.symbolEffect(.bounce, value: bounce)
					.modifier(SoftPulse(active: !reduceMotion))
					.onAppear { if !reduceMotion { bounce += 1 } }
			case .error:
				Image(systemName: "xmark.octagon.fill").foregroundStyle(DS.Palette.danger)
			case .done:
				Image(systemName: "checkmark.circle").foregroundStyle(DS.Palette.quiet)
			case .idle:
				Image(systemName: "circle.dashed").foregroundStyle(DS.Palette.quiet)
			}
		}
		.font(.system(size: size, weight: .medium))
		.frame(width: size, height: size)
		.accessibilityHidden(true)
	}
}

/// Кольцо «работает»: дуга 28 %, 1 об/с. Угол считается от времени — вращение не «съезжает» при перестройке списка.
private struct DSSpinner: View {
	var size: CGFloat
	var still: Bool
	var body: some View {
		TimelineView(.animation(paused: still)) { ctx in
			let angle = still ? 0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) * 360
			ZStack {
				Circle().stroke(DS.Palette.separator, lineWidth: size * 0.14)
				Circle().trim(from: 0, to: 0.28)
					.stroke(DS.Palette.textSecondary, style: StrokeStyle(lineWidth: size * 0.14, lineCap: .round))
					.rotationEffect(.degrees(angle))
			}
			.padding(size * 0.07)
		}
	}
}

/// Бейдж: слово + (необязательно) символ; заливка только у attention/danger.
struct DSBadge: View {
	var text: String
	var tone: DS.Tone = .neutral
	var systemImage: String?
	var body: some View {
		Label {
			Text(text)
		} icon: {
			if let systemImage { Image(systemName: systemImage) }
		}
		.labelStyle(.titleAndIcon)
		.font(DS.Typography.caption.weight(.medium))
		.foregroundStyle(DS.Palette.tone(tone))
		.padding(.horizontal, DS.Metrics.s2).padding(.vertical, 2)
		.background(background, in: Capsule())
	}
	private var background: Color {
		switch tone {
		case .attention: DS.Palette.attentionTint
		case .danger: DS.Palette.dangerTint
		case .neutral, .accent: DS.Palette.hover
		}
	}
}

/// Мини-прогресс шага плана (48×3), растёт пружиной.
struct DSProgress: View {
	var fraction: Double
	var body: some View {
		ZStack(alignment: .leading) {
			Capsule().fill(DS.Palette.separator)
			Capsule().fill(DS.Palette.textSecondary)
				.frame(width: max(DS.Metrics.progressSize.height, DS.Metrics.progressSize.width * min(max(fraction, 0), 1)))
		}
		.frame(width: DS.Metrics.progressSize.width, height: DS.Metrics.progressSize.height)
		.animation(DS.Motion.progress, value: fraction)
		.accessibilityValue(Text("\(Int(fraction * 100)) %"))
	}
}

/// Сегменты плана (≤ 8 шагов): выполнено — тихо, текущий — основным цветом, впереди — пусто (работа нейтральна). Больше 8 — полоса.
struct DSPlanSegments: View {
	var steps: [PlanStatus]
	var body: some View {
		if steps.count > 8 || steps.isEmpty {
			DSProgress(fraction: steps.isEmpty ? 0 : Double(steps.filter { $0 == .completed }.count) / Double(steps.count))
		} else {
			let current = steps.firstIndex(of: .inProgress) ?? steps.firstIndex(of: .pending)
			HStack(spacing: 2) {
				ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
					Capsule().fill(i == current ? DS.Palette.textPrimary : s == .completed ? DS.Palette.quiet : DS.Palette.separator)
				}
			}
			.frame(width: DS.Metrics.progressSize.width, height: DS.Metrics.progressSize.height)
			.animation(DS.Motion.progress, value: steps)
			.accessibilityElement()
			.accessibilityValue(Text("\(steps.filter { $0 == .completed }.count) из \(steps.count)"))
		}
	}
}

/// Счётчик: цифры меняются «прокруткой» (numericText), моноширинные.
struct DSCount: View {
	var value: Int
	var body: some View {
		Text(value, format: .number).monospacedDigit()
			.contentTransition(.numericText(value: Double(value)))
			.animation(DS.Motion.counter, value: value)
	}
}

/// Точка «новое»: непросмотренный результат. Не бейдж и не счётчик.
struct DSNewDot: View {
	var body: some View {
		Circle().fill(DS.Palette.accent).frame(width: DS.Metrics.s2, height: DS.Metrics.s2)
			.accessibilityLabel("Новое")
	}
}

/// Заголовок группы вне поверхности: «Нужны вы  2», шеврон у сворачиваемых.
struct DSGroupHeader: View {
	var title: String
	var count: Int?
	var expanded: Binding<Bool>?
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		let content = HStack(spacing: DS.Metrics.s2) {
			if let expanded {
				Image(systemName: "chevron.right").font(DS.Typography.caption.weight(.semibold))
					.rotationEffect(.degrees(expanded.wrappedValue ? 90 : 0))
			}
			Text(title)
			if let count { DSCount(value: count).foregroundStyle(DS.Palette.textTertiary) }
			Spacer(minLength: 0)
		}
		.font(DS.Typography.groupTitle)
		.foregroundStyle(DS.Palette.textSecondary)
		.padding(.horizontal, DS.Metrics.s1)
		.contentShape(Rectangle())
		if let expanded {
			Button { withAnimation(DS.Motion.pick(DS.Motion.disclosure, reduceMotion: reduceMotion)) { expanded.wrappedValue.toggle() } } label: { content }
				.buttonStyle(.plain)
				.accessibilityLabel("\(title), \(expanded.wrappedValue ? "развёрнуто" : "свёрнуто")")
		} else {
			content.accessibilityAddTraits(.isHeader)
		}
	}
}

/// Таймер: тикает раз в секунду, пока виден; при обрыве связи замирает на времени последних данных.
struct DSTimer: View {
	var agent: AgentView
	var frozenAt: Date?
	var body: some View {
		TimelineView(.periodic(from: .now, by: 1)) { ctx in
			let now = frozenAt ?? ctx.date
			if let ms = agent.state == .wait ? agent.lastActivity.map({ max(0, now.timeIntervalSince($0) * 1000) }) : agent.elapsedMs(now: now) {
				let stalled = agent.isStalled(now: now)
				Text(prefix + Durations.clock(ms))
					.foregroundStyle(stalled ? DS.Palette.textPrimary : DS.Palette.textSecondary)
					.help(stalled ? "Нет событий \(Durations.clock(now.timeIntervalSince(agent.lastActivity ?? now) * 1000))" : "")
			}
		}
		.font(DS.Typography.timer).lineLimit(1).fixedSize()
	}
	private var prefix: String { agent.state == .wait ? "ждёт " : "" }
}

/// Мягкая пульсация «ждёт вас»: прозрачность 1 → 0.55 за 1.2 с туда-обратно. С Reduce Motion — нет.
private struct SoftPulse: ViewModifier {
	var active: Bool
	func body(content: Content) -> some View {
		if active {
			TimelineView(.animation) { ctx in
				let t = ctx.date.timeIntervalSinceReferenceDate
				content.opacity(0.775 + 0.225 * cos(t * .pi / 1.2))
			}
		} else {
			content
		}
	}
}

// MARK: - Круглые стеклянные кнопки

/// Круглая кнопка на Liquid Glass: размер задан точно (36 pt, в тулбаре 40), иконка 16,5 pt semibold.
/// Главное действие экрана — `prominent`: стекло с акцентным тоном. Область нажатия равна видимому кругу.
struct GlassCircleStyle: ButtonStyle {
	var size: CGFloat = DS.Metrics.button
	var prominent = false
	@Environment(\.isEnabled) private var enabled

	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.font(.system(size: DS.Metrics.buttonIcon, weight: .semibold))
			.foregroundStyle(prominent ? Color.white : DS.Palette.textPrimary)
			.frame(width: size, height: size)
			.contentShape(Circle())
			.glassEffect(prominent ? .regular.tint(DS.Palette.accent).interactive() : .regular.interactive(), in: Circle())
			.opacity(enabled ? 1 : 0.4)
			.scaleEffect(configuration.isPressed ? 0.94 : 1)
			.animation(DS.Motion.hoverIn, value: configuration.isPressed)
	}
}

/// Кнопка-иконка: подпись только в подсказке и для VoiceOver.
struct GlassIconButton: View {
	var systemImage: String
	var help: String
	var size: CGFloat = DS.Metrics.button
	var prominent = false
	var action: () -> Void
	var body: some View {
		Button(action: action) { Image(systemName: systemImage) }
			.buttonStyle(GlassCircleStyle(size: size, prominent: prominent))
			.help(help).accessibilityLabel(help)
	}
}

/// Меню в виде круглой стеклянной кнопки-иконки.
struct GlassIconMenu<Content: View>: View {
	var systemImage: String
	var help: String
	var size: CGFloat = DS.Metrics.button
	var prominent = false
	@ViewBuilder var content: Content
	var body: some View {
		Menu { content } label: { Image(systemName: systemImage) }
			.menuStyle(.button).menuIndicator(.hidden)
			.buttonStyle(GlassCircleStyle(size: size, prominent: prominent))
			.fixedSize()
			.help(help).accessibilityLabel(help)
	}
}

// MARK: - Простые кнопки внутри панели (без стекла)

/// Иконка без плашки: при наведении лёгкая подложка. Внутри панели агентов стеклянных кнопок нет — стекло только у шапки и самой панели.
struct PlainIconButton: View {
	var systemImage: String
	var help: String
	var size: CGFloat = 28
	var filled = false
	var action: () -> Void
	@Environment(\.isEnabled) private var enabled
	@State private var hover = false
	var body: some View {
		Button(action: action) {
			Image(systemName: systemImage)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(filled ? Color.white : (hover ? DS.Palette.textPrimary : DS.Palette.textSecondary))
				.frame(width: size, height: size)
				.background(filled ? DS.Palette.accent : (hover ? DS.Palette.hover : .clear), in: Circle())
				.contentShape(Circle())
		}
		.buttonStyle(.plain)
		.opacity(enabled ? 1 : 0.4)
		.onHover { hover = $0 }
		.animation(.easeOut(duration: 0.12), value: hover)
		.help(help).accessibilityLabel(help)
	}
}

struct PlainIconMenu<Content: View>: View {
	var systemImage: String
	var help: String
	var size: CGFloat = 28
	@ViewBuilder var content: Content
	@State private var hover = false
	var body: some View {
		Menu { content } label: {
			Image(systemName: systemImage)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(hover ? DS.Palette.textPrimary : DS.Palette.textSecondary)
				.frame(width: size, height: size)
				.background(hover ? DS.Palette.hover : .clear, in: Circle())
				.contentShape(Circle())
		}
		.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
		.onHover { hover = $0 }
		.help(help).accessibilityLabel(help)
	}
}
