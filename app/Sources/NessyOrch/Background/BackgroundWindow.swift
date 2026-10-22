import SwiftUI
import NessyKit

/// Куда открыто окно «Фон»: раздел и объект в нём (сессия, кейс, плейбук). Меняется ссылкой `nessy-orch://background/…`
/// и переходами из списков (`go`); раздел помнится между запусками.
@MainActor
@Observable
final class BackgroundNav {
	var section: BackgroundSection {
		didSet { UserDefaults.standard.set(section.rawValue, forKey: "background.section") }
	}
	/// выбранный объект раздела: id задания («В процессе»), кейса (`c-…`) или плейбука (`p-…`); `nil` — список без выбора
	var objectId: String?

	init() {
		section = BackgroundSection(rawValue: UserDefaults.standard.string(forKey: "background.section") ?? "") ?? .work
	}

	func go(_ s: BackgroundSection, id: String? = nil) {
		section = s
		objectId = id
	}

	/// Прежнее имя перехода «без вопросов»: теперь вопросов нет.
	func forceGo(_ s: BackgroundSection, id: String? = nil) { go(s, id: id) }
}

/// Окно «Фон»: слева четыре раздела и шестерёнка настроек, справа содержимое. Образец — окно «Роли».
struct BackgroundWindow: View {
	@Environment(AppModel.self) private var model
	@Environment(\.openSettings) private var openSettings

	var body: some View {
		let nav = model.background
		let learning = model.store.learning
		NavigationSplitView {
			List(selection: Binding<BackgroundSection?>(get: { nav.section }, set: { if let s = $0 { nav.go(s) } })) {
				ForEach(BackgroundSection.allCases, id: \.self) { s in
					HStack(spacing: DS.Metrics.s2) {
						Label(s.title, systemImage: s.symbol)
						Spacer(minLength: DS.Metrics.s1)
						if s == .work, BackgroundLogic.processing(learning.jobs).count + BackgroundLogic.waiting(learning.jobs).count > 0 {
							DSCount(value: BackgroundLogic.processing(learning.jobs).count + BackgroundLogic.waiting(learning.jobs).count)
								.font(DS.Typography.caption).foregroundStyle(DS.Palette.textTertiary)
						}
					}
					.tag(s)
				}
			}
			.listStyle(.sidebar)
			.navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
			.safeAreaInset(edge: .bottom, spacing: 0) {
				HStack {
					PlainIconButton(systemImage: "gearshape", help: "Настройки фонового обучения", size: 26) {
						UserDefaults.standard.set("background", forKey: "settings.tab")
						openSettings()
						NSApp.activate()
					}
					Spacer(minLength: 0)
				}
				.padding(.horizontal, DS.Metrics.s3).padding(.vertical, DS.Metrics.s2)
			}
		} detail: {
			VStack(spacing: 0) {
				LearningOfflineLine()
				content(nav, learning)
			}
		}
		.navigationTitle("Фон · \(nav.section.title)")
		.frame(minWidth: 900, minHeight: 520)
		.overlay(alignment: .top) { ToastView().padding(.top, DS.Metrics.s2) }
		.onAppear { Task { await learning.refresh() } }
	}

	@ViewBuilder private func content(_ nav: BackgroundNav, _ learning: LearningStore) -> some View {
		if !learning.available {
			LearningUnavailableView()
		} else {
			switch nav.section {
			case .work: ProcessSection()
			case .cases: CasesSection()
			case .playbooks: PlaybooksSection()
			case .journal: JournalSection()
			}
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
		}
	}
}
