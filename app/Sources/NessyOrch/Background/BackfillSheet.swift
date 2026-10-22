import SwiftUI
import NessyKit

/// Разбор прошлых сессий: кандидаты с датами и размером, чекбоксы, «Разобрать» → итог «создано / пропущено с причиной».
struct BackfillSheet: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var candidates: [BackfillCandidate]?
	@State private var failure: String?
	@State private var picked: Set<String> = []
	@State private var running = false
	@State private var result: BackfillResult?

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			Text("Разобрать прошлые сессии").font(DS.Typography.panelTitle)
			content
			HStack {
				if result == nil, let c = candidates, !c.isEmpty {
					Button(picked.count == c.count ? "Снять все" : "Выбрать все") { picked = picked.count == c.count ? [] : Set(c.map(\.id)) }
				}
				Spacer()
				Button(result == nil ? "Отмена" : "Закрыть") { dismiss() }.keyboardShortcut(.cancelAction)
				if result == nil {
					Button { run() } label: { if running { ProgressView().controlSize(.small) } else { Text("Разобрать\(picked.isEmpty ? "" : " (\(picked.count))")") } }
						.keyboardShortcut(.defaultAction).disabled(picked.isEmpty || running)
				}
			}
		}
		.padding(DS.Metrics.s5)
		.frame(width: 560, height: 480)
		.task { await load() }
	}

	@ViewBuilder private var content: some View {
		if let r = result {
			ScrollView {
				VStack(alignment: .leading, spacing: DS.Metrics.s2) {
					Text(JournalLogic.backfillLine(r)).font(DS.Typography.secondary.weight(.semibold))
					ForEach(r.skipped) { s in
						Text("· \(s.id): \(s.reason)").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
					}
					if !r.created.isEmpty { Text("Кейсы собираются в фоне — смотрите раздел «В процессе».").font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary) }
				}
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		} else if let c = candidates {
			if c.isEmpty {
				LearningEmptyState("Разбирать нечего", systemImage: "tray", message: "Все прошлые сессии уже разобраны или слишком короткие.")
			} else {
				List(c) { cand in
					Toggle(isOn: Binding(get: { picked.contains(cand.id) }, set: { if $0 { picked.insert(cand.id) } else { picked.remove(cand.id) } })) {
						VStack(alignment: .leading, spacing: 2) {
							Text(cand.title.isEmpty ? cand.id : cand.title).lineLimit(1)
							HStack(spacing: DS.Metrics.s2) {
								Text(cand.kind == .transcript ? "транскрипт" : "сессия")
								if let d = ISO.parse(cand.date) { Text(d.learningStamp) }
								Text(JournalLogic.size(cand))
							}
							.font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary)
						}
					}
				}
			}
		} else if let failure {
			Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(DS.Palette.danger)
			Spacer()
		} else {
			ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private func load() async {
		do { candidates = try await model.store.client.backfillCandidates() }
		catch { failure = error.localizedDescription }
	}

	private func run() {
		running = true
		let ids = candidates?.map(\.id).filter(picked.contains) ?? []
		Task {
			do { result = try await model.store.client.backfill(ids: ids); await model.store.learning.refresh() }
			catch { model.flash("Разбор не запущен: \(error.localizedDescription)", error: true) }
			running = false
		}
	}
}
