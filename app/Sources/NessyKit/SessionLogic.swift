import Foundation

/// Узел дерева агентов: у кого родитель — другой агент той же сессии, тот вложен глубже.
public struct AgentNode: Identifiable, Hashable, Sendable {
	public var agent: AgentView
	public var depth: Int
	public var id: String { agent.id }
}

public enum AgentTree {
	/// Дерево агентов сессии «родитель → дети»: корни — те, чей parent не агент этой сессии (обычно you).
	/// Внутри уровня порядок как у AgentOrder (ждут → работают → ошибка → ждут поручения → выполнены), глубина ограничена.
	public static func build(_ agents: [AgentView], maxDepth: Int = 4) -> [AgentNode] {
		let ids = Set(agents.map(\.id))
		let kids = Dictionary(grouping: agents.filter { ids.contains($0.parent) && $0.parent != $0.id }, by: \.parent)
		let roots = agents.filter { !ids.contains($0.parent) || $0.parent == $0.id }
		var out: [AgentNode] = []
		var seen = Set<String>()
		func walk(_ list: [AgentView], _ depth: Int) {
			for a in AgentOrder.sorted(list) where seen.insert(a.id).inserted {
				out.append(AgentNode(agent: a, depth: min(depth, maxDepth)))
				walk(kids[a.id] ?? [], depth + 1)
			}
		}
		walk(roots, 0)
		return out
	}
}

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

	/// Самое срочное состояние сессии.
	public var headline: AgentState? { summary.top }
}

public struct SourceGroup: Identifiable, Sendable {
	public var host: String
	public var items: [SourceView]
	public var id: String { host }
}

public enum SourceGrouping {
	public static let codeGroup = "Код и команды"
	/// Группы по хосту (ссылки на код и команды — «Код и команды»); крупные группы выше, внутри — свежие выше.
	public static func group(_ sources: [SourceView], query: String = "") -> [SourceGroup] {
		let q = query.trimmingCharacters(in: .whitespaces).lowercased()
		let filtered = q.isEmpty ? sources : sources.filter {
			$0.label.lowercased().contains(q) || ($0.href ?? "").lowercased().contains(q) || $0.agentName.lowercased().contains(q)
		}
		let dict = Dictionary(grouping: filtered) { $0.isURL ? ($0.host ?? "—") : codeGroup }
		return dict.map { SourceGroup(host: $0.key, items: $0.value.sorted { $0.ts > $1.ts }) }
			.sorted {
				if $0.items.count != $1.items.count { return $0.items.count > $1.items.count }
				if ($0.host == codeGroup) != ($1.host == codeGroup) { return $1.host == codeGroup }
				return $0.host < $1.host
			}
	}
}

// MARK: источники по виду (screens.md §3d)

/// Вид источника: ссылка, файл (ссылка на код) или команда.
public enum SourceKind: Int, Sendable, Comparable {
	case link, file, command
	public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

	/// Текстовый источник — файл, если похож на путь (`repo@ref:path:42`, `src/a.ts`), иначе команда.
	public static func of(_ s: SourceView) -> SourceKind {
		if s.isURL { return .link }
		return looksLikeFile(s.label) ? .file : .command
	}

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

public struct SourceSection: Identifiable, Sendable {
	public var kind: SourceKind
	/// хост для ссылок
	public var host: String?
	public var items: [MergedSource]
	public var id: String { "\(kind.rawValue):\(host ?? "")" }
	public var title: String {
		switch kind {
		case .link: host.map { "Ссылки · \($0)" } ?? "Ссылки"
		case .file: "Файлы"
		case .command: "Команды"
		}
	}
}

public enum SourceSections {
	/// Ссылки (по хостам) → файлы → команды. Внутри — свежие выше.
	public static func build(_ sources: [SourceView], query: String = "") -> [SourceSection] {
		let q = query.trimmingCharacters(in: .whitespaces).lowercased()
		var merged: [String: MergedSource] = [:]
		var order: [String] = []
		for s in sources {
			let kind = SourceKind.of(s)
			let key = s.href ?? s.label
			if var m = merged[key] {
				if !m.agents.contains(s.agentName) { m.agents.append(s.agentName) }
				m.ts = max(m.ts, s.ts)
				merged[key] = m
				continue
			}
			let title: String, detail: String
			switch kind {
			case .link:
				title = s.label
				detail = s.href ?? ""
			case .file:
				let f = FileRef.parse(s.label)
				title = f.path
				detail = [f.repo, f.ref].compactMap { $0 }.joined(separator: " · ")
			case .command:
				title = s.label
				detail = ""
			}
			merged[key] = MergedSource(id: key, kind: kind, title: title, detail: detail, href: s.href, agents: [s.agentName], ts: s.ts)
			order.append(key)
		}
		let items = order.compactMap { merged[$0] }.filter {
			q.isEmpty || $0.title.lowercased().contains(q) || $0.detail.lowercased().contains(q) || $0.agents.contains { $0.lowercased().contains(q) }
		}
		let groups = Dictionary(grouping: items) { m -> String in
			m.kind == .link ? "0:" + (m.href.map(ReplyParser.hostOf) ?? "") : "\(m.kind.rawValue):"
		}
		return groups.map { k, v in
			let kind = v[0].kind
			return SourceSection(kind: kind, host: kind == .link ? String(k.dropFirst(2)) : nil, items: v.sorted { $0.ts > $1.ts })
		}
		.sorted {
			if $0.kind != $1.kind { return $0.kind < $1.kind }
			if $0.items.count != $1.items.count { return $0.items.count > $1.items.count }
			return ($0.host ?? "") < ($1.host ?? "")
		}
	}
}
