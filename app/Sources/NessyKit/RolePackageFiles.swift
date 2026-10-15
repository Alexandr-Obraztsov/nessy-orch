import Foundation

/// Файлы пакета роли (`<home>/role-packages/<id>`): список, чтение, запись, создание и удаление. Работает прямо с диском (приложение и служба на одной
/// машине): правка файла сразу видна агентам, которым роль даёт путь к папке. Пути относительные и не выходят за пределы пакета.
public struct RolePackageFiles: Sendable {
	public struct Entry: Identifiable, Hashable, Sendable {
		public var path: String
		public var size: Int
		public var isExecutable: Bool
		public var id: String { path }
		public var name: String { (path as NSString).lastPathComponent }
		public var folder: String { let d = (path as NSString).deletingLastPathComponent; return d == "." ? "" : d }
	}

	public enum FileError: Error, LocalizedError, Equatable {
		case badPath
		case exists
		case tooBig
		case notText
		public var errorDescription: String? {
			switch self {
			case .badPath: "Недопустимый путь: только относительный, без «..»"
			case .exists: "Такой файл уже есть"
			case .tooBig: "Файл больше 512 КБ: правьте его во внешнем редакторе"
			case .notText: "Не текстовый файл: правьте его во внешнем редакторе"
			}
		}
	}

	public let root: URL
	/// предел размера файла, который открываем в окне
	public static let maxBytes = 512 * 1024

	public init(root: URL) { self.root = root }

	private var fm: FileManager { .default }

	/// Безопасный абсолютный путь внутри пакета или ошибка.
	func url(_ rel: String) throws -> URL {
		let r = rel.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !r.isEmpty, !r.hasPrefix("/"), !r.contains("\0") else { throw FileError.badPath }
		let parts = r.split(separator: "/", omittingEmptySubsequences: true)
		guard !parts.isEmpty, !parts.contains(".."), !parts.contains(".") else { throw FileError.badPath }
		return parts.reduce(root) { $0.appendingPathComponent(String($1)) }
	}

	/// Все файлы пакета по возрастанию пути (служебные `.DS_Store` и скрытые не показываем).
	public func list() -> [Entry] {
		guard let en = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .isExecutableKey], options: [.skipsHiddenFiles]) else { return [] }
		var out: [Entry] = []
		let base = root.standardizedFileURL.path
		for case let u as URL in en {
			guard let v = try? u.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .isExecutableKey]), v.isRegularFile == true else { continue }
			let p = u.standardizedFileURL.path
			guard p.hasPrefix(base + "/") else { continue }
			out.append(Entry(path: String(p.dropFirst(base.count + 1)), size: v.fileSize ?? 0, isExecutable: v.isExecutable ?? false))
		}
		return out.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
	}

	public func read(_ rel: String) throws -> String {
		let u = try url(rel)
		let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
		guard size <= Self.maxBytes else { throw FileError.tooBig }
		let data = try Data(contentsOf: u)
		guard let s = String(data: data, encoding: .utf8) else { throw FileError.notText }
		return s
	}

	public func write(_ rel: String, _ text: String) throws {
		let u = try url(rel)
		try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
		let mode = (try? fm.attributesOfItem(atPath: u.path)[.posixPermissions] as? NSNumber)?.intValue
		try text.write(to: u, atomically: true, encoding: .utf8)
		if let mode { try? fm.setAttributes([.posixPermissions: mode], ofItemAtPath: u.path) } // права (исполняемость скрипта) сохраняются
	}

	/// Новый файл; скрипты (`.sh`, `.py`, `.js`, `.mjs`, `.rb`) получают права на запуск и первую строку `#!`.
	@discardableResult
	public func create(_ rel: String, content: String? = nil) throws -> Entry {
		let u = try url(rel)
		guard !fm.fileExists(atPath: u.path) else { throw FileError.exists }
		let ext = (rel as NSString).pathExtension.lowercased()
		let shebang: [String: String] = ["sh": "#!/bin/sh\n", "py": "#!/usr/bin/env python3\n", "js": "#!/usr/bin/env node\n", "mjs": "#!/usr/bin/env node\n", "rb": "#!/usr/bin/env ruby\n"]
		try write(rel, content ?? shebang[ext] ?? "")
		if shebang[ext] != nil { try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: u.path) }
		return list().first { $0.path == rel.trimmingCharacters(in: .whitespacesAndNewlines) } ?? Entry(path: rel, size: 0, isExecutable: false)
	}

	public func delete(_ rel: String) throws {
		try fm.removeItem(at: try url(rel))
		// пустые папки после удаления не оставляем
		var dir = try url(rel).deletingLastPathComponent()
		while dir.standardizedFileURL.path != root.standardizedFileURL.path, (try? fm.contentsOfDirectory(atPath: dir.path))?.isEmpty == true {
			try? fm.removeItem(at: dir)
			dir = dir.deletingLastPathComponent()
		}
	}
}
