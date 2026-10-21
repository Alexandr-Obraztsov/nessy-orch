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

	func go(_ s: BackgroundSection, id: String? = nil) {
		section = s
		objectId = id
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
