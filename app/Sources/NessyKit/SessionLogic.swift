import Foundation

/// Итоги сессии: сколько агентов в каком состоянии и суммарные счётчики.
public struct SessionRollup: Sendable, Equatable {
	public var summary: SessionSummary
	public var turns = 0
	public var toolCalls = 0
	public var workMs: Double = 0
	/// nil — ни один агент не сообщил токены
	public var tokens: TokenUsage?
	/// сколько агентов сообщили токены (для оговорки «неполные данные»)
	public var tokenAgents = 0

	public init(_ agents: [AgentView]) {
		summary = agents.summary
		var t = TokenUsage(input: 0, output: 0, cached: 0, total: 0)
		for a in agents {
			turns += a.stats.turns
			toolCalls += a.stats.toolCalls
			workMs += a.stats.workMs
			if let k = a.stats.tokens {
				t.input += k.input; t.output += k.output; t.cached += k.cached; t.total += k.total
				tokenAgents += 1
			}
		}
		tokens = tokenAgents > 0 ? t : nil
	}

}

// MARK: источники ответа агента

/// Вид источника: ссылка, файл (ссылка на код) или команда.
public enum SourceKind: Int, Sendable, Comparable {
	case link, file, command
	public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

	public static func looksLikeFile(_ t: String) -> Bool {
		let l = t.trimmingCharacters(in: .whitespaces)
		if l.contains(" ") { return false }
		if l.range(of: "^[\\w.-]+@[\\w./-]+:", options: .regularExpression) != nil { return true }
		return l.range(of: "^[\\w./-]*/?[\\w-]+\\.[A-Za-z]{1,6}(:\\d+)?$", options: .regularExpression) != nil
	}
}

/// Ссылка на код «repo@ref:path:line» → путь и ревизия.
public struct FileRef: Equatable, Sendable {
	public var path: String
	public var repo: String?
	public var ref: String?

	public static func parse(_ label: String) -> FileRef {
		if let m = label.range(of: "^([\\w.-]+)@([\\w./-]+?):(.+)$", options: .regularExpression) {
			let s = String(label[m])
			let at = s.firstIndex(of: "@")!
			let repo = String(s[..<at])
			let rest = s[s.index(after: at)...]
			let colon = rest.firstIndex(of: ":")!
			return FileRef(path: String(rest[rest.index(after: colon)...]), repo: repo, ref: String(rest[..<colon]))
		}
		return FileRef(path: label, repo: nil, ref: nil)
	}
}

/// Источник для показа: дубликаты одной ссылки слиты, агенты перечислены.
public struct MergedSource: Identifiable, Sendable {
	public var id: String
	public var kind: SourceKind
	public var title: String
	public var detail: String
	public var href: String?
	public var agents: [String]
	public var ts: Double
	public var date: Date { Date(timeIntervalSince1970: ts / 1000) }

	public init(id: String, kind: SourceKind, title: String, detail: String, href: String?, agents: [String], ts: Double) {
		self.id = id; self.kind = kind; self.title = title; self.detail = detail; self.href = href; self.agents = agents; self.ts = ts
	}

	/// Источник из разобранного ответа агента (окно агента).
	public init(chip: SourceChip) {
		switch chip {
		case .url(let label, let href, let host):
			self.init(id: chip.id, kind: .link, title: label, detail: host, href: href, agents: [], ts: 0)
		case .text(let label):
			if SourceKind.looksLikeFile(label) {
				let f = FileRef.parse(label)
				self.init(id: chip.id, kind: .file, title: f.path, detail: [f.repo, f.ref].compactMap { $0 }.joined(separator: " · "), href: nil, agents: [], ts: 0)
			} else {
				self.init(id: chip.id, kind: .command, title: label, detail: "", href: nil, agents: [], ts: 0)
			}
		}
	}
}
