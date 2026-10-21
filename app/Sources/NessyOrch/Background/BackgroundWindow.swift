import SwiftUI
import NessyKit

/// Куда открыто окно «Фон»: раздел и объект в нём (кейс, плейбук). Меняется ссылкой `nessy-orch://background/…`, чипами и кнопками
/// разделов (`go`); раздел помнится между запусками.
@MainActor
@Observable
final class BackgroundNav {
	var section: BackgroundSection {
		didSet { UserDefaults.standard.set(section.rawValue, forKey: "background.section") }
	}
	/// выбранный объект раздела: id кейса (`c-…`) или плейбука (`p-…`); `nil` — список без выбора
	var objectId: String?

	init() {
		section = BackgroundSection(rawValue: UserDefaults.standard.string(forKey: "background.section") ?? "") ?? .work
	}

	/// переход, ждущий подтверждения «уйти без сохранения?»
	var pendingGo: (section: BackgroundSection, id: String?)?

	// Черновики живут здесь, по id объекта, в памяти: переживают смену объекта и раздела. Словари не наблюдаются:
	// получить черновик во время `body` можно, не вызвав перерисовку.
	@ObservationIgnored private var playbookSessions: [String: PlaybookEditSession] = [:]
	@ObservationIgnored private var caseDrafts: [String: CaseDraftState] = [:]

	func playbookSession(_ p: PlaybookView) -> PlaybookEditSession {
		if let s = playbookSessions[p.id] { return s }
		let s = PlaybookEditSession(p)
		playbookSessions[p.id] = s
		return s
	}

	func caseDraft(_ id: String) -> CaseDraftState {
		if let d = caseDrafts[id] { return d }
		let d = CaseDraftState()
		caseDrafts[id] = d
		return d
	}

	/// Есть несохранённые правки у объекта (кейса или плейбука).
	func hasUnsaved(_ id: String?) -> Bool {
		guard let id else { return false }
		return (playbookSessions[id]?.isDirty ?? false) || (caseDrafts[id]?.hasDrafts ?? false)
	}

	/// Текст несохранённых правок объекта для «Скопировать текст» (`nil` — правок нет).
	func draftText(_ id: String) -> String? {
		if let s = playbookSessions[id], s.isDirty { return s.draft.plainText() }
		if let d = caseDrafts[id], d.hasDrafts { return d.copyText() }
		return nil
	}

	/// Забыть черновики объекта (удалён или человек отказался от правок).
	func discardDrafts(_ id: String) {
		playbookSessions[id] = nil
		caseDrafts[id] = nil
	}

	/// Перейти; с несохранёнными правками на текущем объекте сначала спросить.
	func go(_ s: BackgroundSection, id: String? = nil) {
		if LeaveGuard.needsConfirm(from: objectId, to: id, unsaved: hasUnsaved(objectId)) { pendingGo = (s, id); return }
		forceGo(s, id: id)
	}

	/// Перейти без вопросов (после удаления, подтверждённого ухода).
	func forceGo(_ s: BackgroundSection, id: String? = nil) {
		pendingGo = nil
		section = s
		objectId = id
	}

	func confirmGo() {
		guard let t = pendingGo else { return }
		forceGo(t.section, id: t.id)
	}
}

/// Окно «Фон»: слева разделы, справа содержимое. Образец — окно «Роли».
struct BackgroundWindow: View {
	@Environment(AppModel.self) private var model
	/// когда окно открывали прошлый раз: «Пока вас не было» считается от этой отметки; новая ставится при открытии
	@State private var visitMark: Date?
	@State private var sinceDismissed = false

	private static let visitKey = "background.lastVisit"

	var body: some View {
		let nav = model.background
		let learning = model.store.learning
		NavigationSplitView {
			List(selection: Binding<BackgroundSection?>(get: { nav.section }, set: { if let s = $0 { nav.go(s) } })) {
				ForEach(BackgroundSection.allCases, id: \.self) { s in
					HStack(spacing: DS.Metrics.s2) {
						Label(s.title, systemImage: s.symbol)
						Spacer(minLength: DS.Metrics.s1)
						if let n = badge(s, learning), n > 0 { DSCount(value: n).font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary) }
					}
					.tag(s)
				}
			}
			.listStyle(.sidebar)
			.navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
		} detail: {
			VStack(spacing: 0) {
				LearningOfflineLine()
				content(nav, learning)
			}
		}
		.confirmationDialog("Уйти без сохранения?", isPresented: Binding(get: { nav.pendingGo != nil }, set: { if !$0 { nav.pendingGo = nil } }), titleVisibility: .visible) {
			Button("Уйти", role: .destructive) { nav.confirmGo() }
			Button("Остаться", role: .cancel) { nav.pendingGo = nil }
		} message: { Text("Правки не сохранены на сервере. Черновик останется в памяти, пока открыто приложение.") }
		.navigationTitle("Фон · \(nav.section.title)")
		.frame(minWidth: 820, minHeight: 520)
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.onAppear {
			visitMark = UserDefaults.standard.object(forKey: Self.visitKey) as? Date
			UserDefaults.standard.set(Date(), forKey: Self.visitKey)
			sinceDismissed = false
			Task { await learning.refresh() }
		}
		.onDisappear { UserDefaults.standard.set(Date(), forKey: Self.visitKey) }
	}

	@ViewBuilder private func content(_ nav: BackgroundNav, _ learning: LearningStore) -> some View {
		if !learning.available {
			LearningUnavailableView()
		} else {
			switch nav.section {
			case .work: WorkSection(since: sinceLine(learning), dismissSince: { withAnimation(DS.Motion.fade) { sinceDismissed = true } })
			case .cases: CasesSection()
			case .playbooks: PlaybooksSection()
			case .journal: JournalSection()
			case .settings: LearningSettingsView()
			}
		}
	}

	private func sinceLine(_ l: LearningStore) -> String? {
		guard !sinceDismissed, let mark = visitMark else { return nil }
		return LearningText.sinceLine(l.sinceLastVisit(mark))
	}

	/// Число у раздела в боковой колонке: ошибки в «Работе», ожидание человека в «Плейбуках».
	private func badge(_ s: BackgroundSection, _ l: LearningStore) -> Int? {
		switch s {
		case .work: l.failed.count
		case .playbooks: l.needsHuman
		default: nil
		}
	}
}

extension BackgroundSection {
	var symbol: String {
		switch self {
		case .work: "gearshape.2"
		case .cases: "tray.full"
		case .playbooks: "book.closed"
		case .journal: "list.bullet.rectangle"
		case .settings: "slider.horizontal.3"
		}
	}
}
