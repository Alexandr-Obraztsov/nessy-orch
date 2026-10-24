import Foundation

/// Логика окна-документа плейбука без UI: исход сохранения и список файлов слева.
public enum PlaybookDocLogic {
	public enum Outcome: Equatable, Sendable {
		/// плейбук изменился: перечитать и сверить с черновиком
		case stale
		/// замечания проверки, по строке
		case lint([String])
		/// с плейбуком работает агент
		case busy
		case failed(String)
	}

	/// Ошибка сохранения → исход для интерфейса.
	public static func outcome(_ e: Error) -> Outcome {
		guard let a = e as? APIError else { return .failed(e.localizedDescription) }
		if a.isStale { return .stale }
		if a.isBusy { return .busy }
		if a.isLint { return .lint(lintLines(a.message)) }
		return .failed(a.message)
	}

	/// Замечания приходят в `error` через `\n`.
	public static func lintLines(_ s: String) -> [String] {
		s.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
	}

	public static let busyMessage = "Агент работает с плейбуком, повторите позже"

	/// Файл слева: документ или инструмент.
	public struct Entry: Identifiable, Hashable, Sendable {
		public var path: String
		public var title: String
		public var isDocument: Bool
		public var id: String { path }
		public init(path: String, title: String, isDocument: Bool) { self.path = path; self.title = title; self.isDocument = isDocument }
	}

	/// Документ (SKILL.md) и `tools/*`; остальные файлы плейбука в документ уже входят.
	public static func entries(_ d: PlaybookDetail) -> [Entry] {
		let tools = Set(d.view.tools.map(\.name)).union(d.files.keys.filter { $0.hasPrefix("tools/") }.map { String($0.dropFirst(6)) })
		return [Entry(path: "SKILL.md", title: "Документ", isDocument: true)]
			+ tools.sorted().map { Entry(path: "tools/\($0)", title: "tools/\($0)", isDocument: false) }
	}

	/// Текст инструмента для просмотра.
	public static func toolText(_ d: PlaybookDetail, path: String) -> String {
		if let t = d.files[path] { return t }
		let name = path.hasPrefix("tools/") ? String(path.dropFirst(6)) : path
		return d.view.tools.first { $0.name == name }?.content ?? ""
	}
}
