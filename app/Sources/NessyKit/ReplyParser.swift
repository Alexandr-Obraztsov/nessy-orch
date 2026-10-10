import Foundation

public enum ReplyStatusCode: String, Sendable, CaseIterable {
	case done = "DONE"
	case doneWithConcerns = "DONE_WITH_CONCERNS"
	case blocked = "BLOCKED"
	case needsContext = "NEEDS_CONTEXT"

	public var label: String {
		switch self {
		case .done: "Готово"
		case .doneWithConcerns: "Готово с оговорками"
		case .blocked: "Заблокирован"
		case .needsContext: "Не хватает данных"
		}
	}
	/// Требует вашего внимания (агент не справился сам).
	public var needsHuman: Bool { self == .blocked || self == .needsContext }
}

public enum SourceChip: Hashable, Sendable, Identifiable {
	case url(label: String, href: String, host: String)
	case text(label: String)
	public var id: String {
		switch self {
		case .url(_, let h, _): h
		case .text(let l): "t:" + l
		}
	}
	public var label: String {
		switch self {
		case .url(let l, _, _), .text(let l): l
		}
	}
}

public struct ParsedReply: Sendable {
	public var body: String
	public var sources: [SourceChip]
	public var status: (code: ReplyStatusCode, reason: String)?
}

private extension String {
	func rx(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSTextCheckingResult? {
		guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
		return re.firstMatch(in: self, range: NSRange(startIndex..., in: self))
	}
	func group(_ m: NSTextCheckingResult, _ i: Int) -> String {
		guard i < m.numberOfRanges, let r = Range(m.range(at: i), in: self) else { return "" }
		return String(self[r])
	}
	func replacing(_ pattern: String, with t: String, _ options: NSRegularExpression.Options = []) -> String {
		guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return self }
		return re.stringByReplacingMatches(in: self, range: NSRange(startIndex..., in: self), withTemplate: t)
	}
}

public enum ReplyParser {
	static let listRe = "^\\s*(?:[-*+]|\\d+[.)])\\s+"
	static let headRe = "^\\s*(?:[-*+]\\s+)?(?:#{1,6}\\s*)?(?:\\*\\*|__)?\\s*Источники\\s*(?:\\*\\*|__)?\\s*(?:[:：—–-]\\s*)?(?:\\*\\*|__)?\\s*(.*)$"
	static let statusRe = "^\\s*(?:[-*+]\\s+)?(?:\\*\\*|__)?Статус(?:\\*\\*|__)?\\s*[:：]\\s*(?:\\*\\*|__|`)?\\s*(DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)\\s*(?:\\*\\*|__|`)?\\s*(?:[-—–:]\\s*(.*))?$"
	static let urlRe = "https?://[^\\s<>()\\[\\]\"'`]+[^\\s<>()\\[\\]\"'`.,;:!?»]"
	static let mdLinkRe = "\\[([^\\]]+)\\]\\((https?://[^)\\s]+)\\)"
	static let maxLabel = 48

	static func isField(_ body: String) -> Bool {
		body.trimmingCharacters(in: .whitespaces).rx("^(?:\\*\\*|__)[^*_]+(?:\\*\\*|__)") != nil && !body.contains("http://") && !body.contains("https://")
	}

	static func clip(_ s: String, _ n: Int = maxLabel) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

	public static func hostOf(_ u: String) -> String {
		guard let h = URL(string: u)?.host else { return "" }
		return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
	}

	/// Короткая подпись ссылки: последний сегмент пути («PLAT-77»), у чисел — с предыдущим.
	public static func shortUrl(_ u: String) -> String {
		guard let url = URL(string: u) else { return clip(u) }
		let parts = url.path.split(separator: "/").map(String.init)
		guard let last = parts.last else { return clip(hostOf(u)) }
		let tail = (Int(last) != nil || last.count < 4) ? parts.suffix(2).joined(separator: "/") : last
		return clip(tail + (url.fragment.map { "#" + $0 } ?? ""))
	}

	static func restLabel(_ text: String) -> String {
		var t = text
		t = t.replacing("`([^`]+)`", with: "$1")
		t = t.replacing("[*_]{1,2}([^*_]+)[*_]{1,2}", with: "$1")
		t = t.replacing("^\\s*\\[\\d+\\]\\s*", with: "")
		t = t.replacing("\\(\\s*\\+?\\s*(?:permalink|ссылка)?\\s*\\)", with: "", .caseInsensitive)
		t = t.replacing("\\s*\\+?\\s*permalink\\s*", with: " ", .caseInsensitive)
		t = t.replacing("^[\\s:—–-]+|[\\s:—–(,-]+$", with: "")
		return t.trimmingCharacters(in: .whitespaces)
	}

	static func chips(of item: String) -> [SourceChip] {
		var out: [SourceChip] = []
		var rest = item
		if let re = try? NSRegularExpression(pattern: mdLinkRe) {
			for m in re.matches(in: item, range: NSRange(item.startIndex..., in: item)) {
				let all = item.group(m, 0), label = item.group(m, 1), href = item.group(m, 2)
				let l = restLabel(label)
				out.append(.url(label: clip(l.isEmpty ? shortUrl(href) : l), href: href, host: hostOf(href)))
				rest = rest.replacingOccurrences(of: all, with: " ")
			}
		}
		var urls: [String] = []
		if let re = try? NSRegularExpression(pattern: urlRe) {
			for m in re.matches(in: rest, range: NSRange(rest.startIndex..., in: rest)) { urls.append(rest.group(m, 0)) }
		}
		for u in urls { rest = rest.replacingOccurrences(of: u, with: " ") }
		let label = restLabel(rest)
		for (i, href) in urls.enumerated() {
			let own = (i == 0 && !label.isEmpty && label.count <= maxLabel && out.isEmpty) ? label : ""
			out.append(.url(label: own.isEmpty ? shortUrl(href) : own, href: href, host: hostOf(href)))
		}
		if out.isEmpty, !label.isEmpty { out.append(.text(label: clip(label, 72))) }
		return out
	}

	public static func parse(_ text: String) -> ParsedReply {
		var lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
		var status: (ReplyStatusCode, String)?
		// «Статус: …» — последняя содержательная строка
		if let i = lines.lastIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
			if let m = lines[i].rx(statusRe) {
				let code = ReplyStatusCode(rawValue: lines[i].group(m, 1)) ?? .done
				let reason = lines[i].group(m, 2).replacingOccurrences(of: "[*_`]", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
				status = (code, reason)
				lines.remove(at: i)
			}
		}

		var sources: [SourceChip] = []
		if let head = lines.firstIndex(where: { $0.rx(headRe) != nil }) {
			var items: [String] = []
			if let m = lines[head].rx(headRe) {
				let inline = lines[head].group(m, 1).trimmingCharacters(in: .whitespaces)
				if !inline.isEmpty { items.append(contentsOf: inline.components(separatedBy: "; ")) }
			}
			var end = head + 1
			loop: while end < lines.count {
				let line = lines[end]
				if line.trimmingCharacters(in: .whitespaces).isEmpty {
					// пустая строка внутри списка допустима, если дальше он продолжается
					if let next = lines[(end + 1)...].first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }),
						next.rx(listRe) != nil, !isField(next.replacing(listRe, with: "")) {
						end += 1
						continue
					}
					break loop
				}
				if line.rx(listRe) != nil {
					let body = line.replacing(listRe, with: "")
					if isField(body) { break loop }
					items.append(body)
				} else if line.rx("^\\s{2,}\\S") != nil, !items.isEmpty {
					items[items.count - 1] += " " + line.trimmingCharacters(in: .whitespaces)
				} else { break loop }
				end += 1
			}
			for it in items { sources.append(contentsOf: chips(of: it)) }
			if !sources.isEmpty { lines.removeSubrange(head..<end) }
		}

		var seen = Set<String>()
		let unique = sources.filter { seen.insert($0.id).inserted }
		return ParsedReply(body: lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), sources: unique, status: status.map { ($0.0, $0.1) })
	}
}
