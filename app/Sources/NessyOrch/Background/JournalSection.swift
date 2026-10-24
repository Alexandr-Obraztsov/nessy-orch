import SwiftUI
import NessyKit

/// Раздел «Журнал»: единая лента всех логов фона по дням, новые сверху.
struct JournalSection: View {
	@Environment(AppModel.self) private var model
	@State private var level: JournalLogic.LevelFilter = .all
	@State private var query = ""
	@State private var days: [JournalLogic.Day] = []

	private var learning: LearningStore { model.store.learning }
	/// ключ пересчёта: меняется при новой записи, догрузке и замене записи
	private var stamp: String { "\(learning.journal.count)|\(learning.journal.last?.id ?? "")|\(learning.journal.first?.id ?? "")" }

	var body: some View {
		VStack(spacing: 0) {
			HStack(spacing: DS.Metrics.s3) {
				Picker("", selection: $level) {
					Text("Все").tag(JournalLogic.LevelFilter.all)
					Text("Предупреждения").tag(JournalLogic.LevelFilter.warnings)
					Text("Ошибки").tag(JournalLogic.LevelFilter.errors)
				}
				.pickerStyle(.segmented).labelsHidden().fixedSize()
				SearchField(text: $query)
			}
			.padding(.horizontal, DS.Metrics.s4).padding(.vertical, DS.Metrics.s3)
			ScrollView {
				LazyVStack(alignment: .leading, spacing: DS.Metrics.s5) {
					if days.isEmpty {
						LearningEmptyState(learning.journal.isEmpty ? "Журнал пуст" : "Ничего не найдено")
					}
					ForEach(days) { day in
						VStack(alignment: .leading, spacing: DS.Metrics.s2) {
							DSGroupHeader(title: JournalLogic.dayTitle(day.start), count: day.entries.count)
							LazyVStack(spacing: 0) {
								ForEach(Array(day.entries.enumerated()), id: \.element.id) { i, e in
									if i > 0 { DSSeparator(leading: DS.Metrics.s4) }
									JournalRow(entry: e)
								}
							}
							.dsGroup()
						}
					}
					// конец ленты: показался — просим страницу старее
					Color.clear.frame(height: 1).onAppear { Task { await learning.loadMoreJournal() } }
				}
				.padding(DS.Metrics.s5)
				.frame(maxWidth: 820, alignment: .leading)
				.frame(maxWidth: .infinity)
			}
			.scrollEdgeEffectStyle(.soft, for: .top)
		}
		.onAppear(perform: recompute)
		.onChange(of: stamp) { recompute() }
		.onChange(of: level) { recompute() }
		.onChange(of: query) { recompute() }
	}

	private func recompute() {
		days = JournalLogic.days(JournalLogic.filter(learning.journal, level: level, query: query))
	}
}

/// Строка: время, точка важности и фраза; запись не из общего журнала — вид события, объект и описание.
private struct JournalRow: View {
	@Environment(AppModel.self) private var model
	var entry: JournalEntry

	var body: some View {
		let row = HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s3) {
			Text(ISO.parse(entry.ts)?.formatted(date: .omitted, time: .shortened) ?? "—")
				.font(DS.Typography.timer).foregroundStyle(DS.Palette.textTertiary).frame(width: 44, alignment: .leading)
			if entry.kind == .log { logBody } else { legacyBody }
		}
		.padding(DS.Metrics.s3)
		.frame(maxWidth: .infinity, alignment: .leading)
		.contentShape(Rectangle())
		if entry.kind == .log, let open = openTarget {
			row.onTapGesture(perform: open).help("Открыть")
		} else {
			row
		}
	}

	private var dotColor: Color? {
		switch entry.level {
		case .info: nil
		case .warn: DS.Palette.textSecondary
		case .error: DS.Palette.danger
		}
	}

	private var logBody: some View {
		HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
			Circle().fill(dotColor ?? .clear).frame(width: 6, height: 6)
			Text(entry.summary).font(DS.Typography.caption).foregroundStyle(DS.Palette.textPrimary).textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	private var legacyBody: some View {
		VStack(alignment: .leading, spacing: 2) {
			HStack(spacing: DS.Metrics.s2) {
				Text(LearningText.journalKind(entry.kind)).font(DS.Typography.agentName).foregroundStyle(DS.Palette.textPrimary)
				subject
			}
			if !entry.summary.isEmpty {
				Text(JournalLogic.plain(entry.summary)).font(DS.Typography.caption).foregroundStyle(DS.Palette.textSecondary).textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		// текст в одну колонку со строками-логами (после точки уровня)
		.padding(.leading, 6 + DS.Metrics.s2)
	}

	/// Открыть объект записи в окне «Фон»; нет объекта или он удалён — нажатия нет.
	private var openTarget: (() -> Void)? {
		let l = model.store.learning
		switch JournalLogic.target(entry) {
		case .playbook(let id)?: return l.playbook(id) == nil ? nil : { model.background.go(.playbooks, id: id) }
		case .caseView(let id)?: return l.caseView(id) == nil ? nil : { model.background.go(.cases, id: id) }
		case nil: return nil
		}
	}

	/// Объект записи: название плейбука или кейса, нажатие открывает его; удалённого нет — подписи нет.
	@ViewBuilder private var subject: some View {
		let l = model.store.learning
		switch JournalLogic.target(entry) {
		case .playbook(let id)?:
			if let p = l.playbook(id) {
				LinkLine(text: p.title, systemImage: "book.closed", help: "Открыть плейбук") { model.background.go(.playbooks, id: id) }
			}
		case .caseView(let id)?:
			if let c = l.caseView(id) {
				LinkLine(text: model.title(ofCase: c), systemImage: "tray.full", help: "Открыть кейс") { model.background.go(.cases, id: id) }
			}
		case nil: EmptyView()
		}
	}
}
