import SwiftUI
import NessyKit

/// Раздел «Работа» (спека §5): что фон делает сейчас, очередь, ошибки и сделанное сегодня.
struct WorkSection: View {
	@Environment(AppModel.self) private var model
	/// «Пока вас не было: …» или `nil`
	var since: String?
	var dismissSince: () -> Void
	@State private var doneOpen = false

	private var learning: LearningStore { model.store.learning }

	var body: some View {
		let running = learning.running, queued = learning.queued, failed = learning.failed, done = learning.doneToday
		ScrollView {
			VStack(alignment: .leading, spacing: DS.Metrics.s5) {
				if let since {
					Button(action: dismissSince) {
						HStack(spacing: DS.Metrics.s2) {
							Text(since)
							Spacer(minLength: DS.Metrics.s2)
							Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
						}
						.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
						.contentShape(Rectangle())
					}
					.buttonStyle(.plain).help("Скрыть")
					.transition(.opacity)
				}
				if learning.settings?.enabled == false {
					Button { model.background.go(.settings) } label: {
						Label("Фоновое обучение выключено — включить в настройках", systemImage: "pause.circle")
							.font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary)
					}
					.buttonStyle(.plain)
				}

				if running.isEmpty && queued.isEmpty && failed.isEmpty && done.isEmpty {
					if learning.loaded {
						LearningEmptyState("Фоновых заданий нет", systemImage: "tray", message: "Кейсы собираются сами, пока вы работаете в сессиях.")
					} else {
						LearningEmptyState("Данных обучения пока нет", systemImage: "antenna.radiowaves.left.and.right.slash", message: "Появятся, как только приложение свяжется с оркестратором.")
					}
				}
				group("Сейчас", running)
				group("Очередь", queued)
				group("Ошибки", failed)
				if !done.isEmpty {
					VStack(alignment: .leading, spacing: DS.Metrics.s2) {
						DSGroupHeader(title: "Сделано сегодня", count: done.count, expanded: $doneOpen)
						if doneOpen {
							VStack(spacing: DS.Metrics.s2) { ForEach(done.reversed()) { JobCard(job: $0) } }
								.transition(.opacity)
						}
					}
				}
			}
			.padding(DS.Metrics.s5)
			.frame(maxWidth: 820, alignment: .leading)
			.frame(maxWidth: .infinity)
		}
		.scrollEdgeEffectStyle(.soft, for: .top)
		.animation(DS.Motion.fade, value: since)
	}

	@ViewBuilder private func group(_ title: String, _ jobs: [JobView]) -> some View {
		if !jobs.isEmpty {
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				DSGroupHeader(title: title, count: jobs.count)
				VStack(spacing: DS.Metrics.s2) { ForEach(jobs) { JobCard(job: $0) } }
			}
		}
	}
}
