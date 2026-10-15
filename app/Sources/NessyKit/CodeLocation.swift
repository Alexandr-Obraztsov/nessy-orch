import Foundation

/// Ссылка на код из источников агента: «repo@ref:path:line», «path:line» или просто путь.
public struct CodeLocation: Equatable, Sendable {
	public var path: String
	public var line: Int?

	public init(path: String, line: Int? = nil) { self.path = path; self.line = line }

	/// Разбор подписи источника: префикс `repo@ref:` отбрасывается, `:строка` (и `:строка:столбец`) выделяется.
	public static func parse(_ label: String) -> CodeLocation {
		var s = label.trimmingCharacters(in: .whitespacesAndNewlines)
		if s.range(of: "^[\\w.-]+@[\\w./-]+?:", options: .regularExpression) != nil, let colon = s.firstIndex(of: ":") { s = String(s[s.index(after: colon)...]) }
		var line: Int?
		// «:12» или «:12:5» в конце; двоеточия внутри пути (Windows-диски и т. п.) не трогаем
		if let r = s.range(of: ":(\\d+)(?::\\d+)?$", options: .regularExpression) {
			let tail = s[r].dropFirst().split(separator: ":").first.flatMap { Int($0) }
			line = tail
			s = String(s[..<r.lowerBound])
		}
		return CodeLocation(path: s, line: line)
	}

	/// Существующий файл на этой машине: абсолютный путь как есть, относительный — от каталога проекта (и от его корня выше по дереву).
	public func resolved(in project: String, fm: FileManager = .default) -> String? {
		if path.hasPrefix("/") { return fm.fileExists(atPath: path) ? path : nil }
		var dir = URL(fileURLWithPath: project)
		for _ in 0..<4 {
			let candidate = dir.appendingPathComponent(path).path
			var isDir: ObjCBool = false
			if fm.fileExists(atPath: candidate, isDirectory: &isDir), !isDir.boolValue { return candidate }
			let up = dir.deletingLastPathComponent()
			if up.path == dir.path { break }
			dir = up
		}
		return nil
	}
}

/// Редакторы кода, которые открывают файл на строке по ссылке `схема://file<путь>:<строка>`.
public enum CodeEditor: CaseIterable, Sendable {
	case vscode, cursor, zed

	public var bundleId: String {
		switch self {
		case .vscode: "com.microsoft.VSCode"
		case .cursor: "com.todesktop.230313mzl4w4u92"
		case .zed: "dev.zed.Zed"
		}
	}

	var scheme: String {
		switch self {
		case .vscode: "vscode"
		case .cursor: "cursor"
		case .zed: "zed"
		}
	}

	/// `vscode://file/абсолютный/путь:12`
	public func url(path: String, line: Int?) -> URL? {
		var comps = URLComponents()
		comps.scheme = scheme
		comps.host = "file"
		comps.path = path
		var s = comps.string
		if let line, s != nil { s! += ":\(line)" }
		return s.flatMap(URL.init(string:))
	}
}
