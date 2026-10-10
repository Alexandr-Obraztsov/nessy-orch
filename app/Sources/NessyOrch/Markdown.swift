import SwiftUI

/// Блоки markdown (без внешних библиотек): заголовки, списки, цитаты, код, таблицы, разделители, абзацы.
enum MDBlock: Identifiable {
	case heading(Int, String)
	case paragraph(String)
	case bullet(depth: Int, marker: String, text: String)
	case quote(String)
	case code(lang: String, text: String)
	case table(header: [String], rows: [[String]])
	case rule

	var id: UUID { UUID() }
}

enum MarkdownParser {
	static func parse(_ src: String) -> [MDBlock] {
		var blocks: [MDBlock] = []
		let lines = src.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
		var i = 0
		var para: [String] = []
		func flush() { if !para.isEmpty { blocks.append(.paragraph(para.joined(separator: "\n"))); para = [] } }

		while i < lines.count {
			let line = lines[i]
			let t = line.trimmingCharacters(in: .whitespaces)
			if t.hasPrefix("```") {
				flush()
				let lang = String(t.dropFirst(3)).trimmingCharacters(in: .whitespaces)
				var code: [String] = []
				i += 1
				while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(lines[i]); i += 1 }
				blocks.append(.code(lang: lang, text: code.joined(separator: "\n")))
				i += 1
				continue
			}
			if t.isEmpty { flush(); i += 1; continue }
			if let h = heading(t) { flush(); blocks.append(.heading(h.0, h.1)); i += 1; continue }
			// «**Детали**» отдельной строкой — заголовок раздела, а не начало абзаца
			if let m = t.range(of: "^(?:\\*\\*|__)([^*_]{1,60})(?:\\*\\*|__)[:：]?$", options: .regularExpression), m == t.startIndex..<t.endIndex {
				flush()
				blocks.append(.heading(3, t.replacingOccurrences(of: "[*_:：]", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)))
				i += 1
				continue
			}
			if t.range(of: "^([-*_])\\1{2,}$", options: .regularExpression) != nil { flush(); blocks.append(.rule); i += 1; continue }
			if t.hasPrefix(">") {
				flush()
				var q: [String] = []
				while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
					q.append(String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces)); i += 1
				}
				blocks.append(.quote(q.joined(separator: "\n")))
				continue
			}
			if let b = bullet(line) { flush(); blocks.append(b); i += 1; continue }
			if t.hasPrefix("|"), i + 1 < lines.count, lines[i + 1].range(of: "^\\s*\\|?\\s*:?-{2,}", options: .regularExpression) != nil {
				flush()
				let header = cells(t)
				i += 2
				var rows: [[String]] = []
				while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") { rows.append(cells(lines[i])); i += 1 }
				blocks.append(.table(header: header, rows: rows))
				continue
			}
			para.append(t)
			i += 1
		}
		flush()
		return blocks
	}

	static func heading(_ t: String) -> (Int, String)? {
		guard t.hasPrefix("#") else { return nil }
		let n = t.prefix(while: { $0 == "#" }).count
		guard n <= 6, t.dropFirst(n).first == " " else { return nil }
		return (n, String(t.dropFirst(n)).trimmingCharacters(in: .whitespaces))
	}

	static func bullet(_ line: String) -> MDBlock? {
		guard let m = line.range(of: "^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$", options: .regularExpression) else { return nil }
		let s = String(line[m])
		let indent = s.prefix(while: { $0 == " " || $0 == "\t" }).count
		let rest = s.trimmingCharacters(in: .whitespaces)
		let marker = String(rest.prefix(while: { !$0.isWhitespace }))
		var text = String(rest.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
		var shown = (marker.first?.isNumber ?? false) ? marker : "•"
		if text.hasPrefix("[ ] ") { shown = "☐"; text = String(text.dropFirst(4)) }
		else if text.lowercased().hasPrefix("[x] ") { shown = "☑"; text = String(text.dropFirst(4)) }
		return .bullet(depth: indent / 2, marker: shown, text: text)
	}

	static func cells(_ line: String) -> [String] {
		var t = line.trimmingCharacters(in: .whitespaces)
		if t.hasPrefix("|") { t.removeFirst() }
		if t.hasSuffix("|") { t.removeLast() }
		return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
	}
}

/// Инлайн: **жирный**, *курсив*, `код`, [ссылки](url) через AttributedString; сноски [1] — тихие.
func inlineMarkdown(_ s: String) -> AttributedString {
	var opts = AttributedString.MarkdownParsingOptions()
	opts.interpretedSyntax = .inlineOnlyPreservingWhitespace
	var a = (try? AttributedString(markdown: s, options: opts)) ?? AttributedString(s)
	for run in a.runs where run.inlinePresentationIntent?.contains(.code) == true {
		a[run.range].font = DS.Typography.mono
		a[run.range].backgroundColor = DS.Palette.hover
	}
	for run in a.runs where run.link != nil {
		a[run.range].foregroundColor = DS.Palette.accentText
	}
	// сноски [1][2]: ссылки на источники ниже — тихо, без внимания
	let plain = String(a.characters)
	if let re = try? NSRegularExpression(pattern: "\\[\\d+\\]") {
		for m in re.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
			guard let r = Range(m.range, in: plain), let lo = AttributedString.Index(r.lowerBound, within: a), let hi = AttributedString.Index(r.upperBound, within: a) else { continue }
			a[lo..<hi].foregroundColor = DS.Palette.textTertiary
		}
	}
	return a
}

/// Markdown ответа: заголовки, списки, код. `lead` — первый абзац крупнее (ответ в окне агента).
struct MarkdownView: View {
	var text: String
	var lead = false
	var blocks: [MDBlock] { MarkdownParser.parse(text) }

	var body: some View {
		VStack(alignment: .leading, spacing: DS.Metrics.s3) {
			ForEach(Array(blocks.enumerated()), id: \.offset) { i, b in block(b, first: i == 0) }
		}
		.foregroundStyle(DS.Palette.textPrimary)
		.textSelection(.enabled)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	@ViewBuilder private func block(_ b: MDBlock, first: Bool) -> some View {
		switch b {
		case .heading(let n, let t):
			Text(inlineMarkdown(t))
				.font(n <= 2 ? DS.Typography.panelTitle : DS.Typography.agentName)
				.padding(.top, first ? 0 : DS.Metrics.s1)
		case .paragraph(let t):
			Text(inlineMarkdown(t))
				.font(lead && first ? DS.Typography.lead : DS.Typography.body)
				.lineSpacing(DS.Typography.readingLineSpacing)
				.fixedSize(horizontal: false, vertical: true)
		case .bullet(let depth, let marker, let t):
			HStack(alignment: .firstTextBaseline, spacing: DS.Metrics.s2) {
				Text(marker).foregroundStyle(DS.Palette.textSecondary).frame(minWidth: DS.Metrics.s3, alignment: .trailing)
				Text(inlineMarkdown(t)).lineSpacing(DS.Typography.readingLineSpacing).fixedSize(horizontal: false, vertical: true)
			}
			.font(DS.Typography.body)
			.padding(.leading, CGFloat(depth) * DS.Metrics.s4)
		case .quote(let t):
			HStack(spacing: DS.Metrics.s3) {
				Capsule().fill(DS.Palette.separator).frame(width: 3)
				Text(inlineMarkdown(t)).foregroundStyle(DS.Palette.textSecondary)
			}
		case .code(let lang, let t):
			CodeBlock(lang: lang, text: t)
		case .table(let header, let rows):
			TableBlock(header: header, rows: rows)
		case .rule:
			DSSeparator().padding(.vertical, DS.Metrics.s1)
		}
	}
}

struct CodeBlock: View {
	var lang: String
	var text: String
	@State private var copied = false

	var body: some View {
		ScrollView(.horizontal, showsIndicators: false) {
			Text(Highlighter.attributed(text, lang: lang)).font(DS.Typography.mono)
				.padding(DS.Metrics.s3).fixedSize(horizontal: true, vertical: true)
		}
		.background(DS.Palette.hover, in: ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.s2)), isUniform: true))
		.overlay(alignment: .topTrailing) {
			Button {
				Pasteboard.copy(text)
				copied = true
				Task { try? await Task.sleep(for: .seconds(1.2)); copied = false }
			} label: { Image(systemName: copied ? "checkmark" : "doc.on.doc").contentTransition(.symbolEffect(.replace)) }
				.buttonStyle(.borderless).foregroundStyle(DS.Palette.textSecondary)
				.padding(DS.Metrics.s2)
				.help("Копировать")
		}
	}
}

struct TableBlock: View {
	var header: [String]
	var rows: [[String]]
	var body: some View {
		ScrollView(.horizontal, showsIndicators: false) {
			Grid(alignment: .leading, horizontalSpacing: DS.Metrics.s4, verticalSpacing: DS.Metrics.s2) {
				GridRow { ForEach(Array(header.enumerated()), id: \.offset) { _, h in Text(inlineMarkdown(h)).font(DS.Typography.secondary.weight(.semibold)) } }
				DSSeparator().gridCellUnsizedAxes(.horizontal)
				ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
					GridRow { ForEach(Array(r.enumerated()), id: \.offset) { _, c in Text(inlineMarkdown(c)).font(DS.Typography.secondary) } }
				}
			}
			.padding(DS.Metrics.s3)
		}
		.background(DS.Palette.hover, in: ConcentricRectangle(corners: .concentric(minimum: .fixed(DS.Metrics.s2)), isUniform: true))
	}
}

/// Лёгкая подсветка без грамматик: строки, числа, комментарии, ключевые слова; diff по строкам.
enum Highlighter {
	static let keywords: Set<String> = [
		"func", "let", "var", "const", "function", "return", "if", "else", "for", "while", "class", "struct", "enum", "import", "from", "export",
		"async", "await", "try", "catch", "throw", "new", "def", "in", "is", "not", "and", "or", "true", "false", "null", "nil", "None", "True", "False",
		"public", "private", "static", "interface", "type", "extends", "switch", "case", "break", "continue", "package", "use", "fn", "mod",
	]

	static func attributed(_ text: String, lang: String) -> AttributedString {
		var out = AttributedString()
		let isDiff = lang == "diff" || lang == "patch"
		for (n, line) in text.components(separatedBy: "\n").enumerated() {
			var a = AttributedString((n > 0 ? "\n" : "") + line)
			if isDiff {
				// без зелёного: добавленное — акцентом, удалённое — красным
				if line.hasPrefix("+") && !line.hasPrefix("+++") { a.foregroundColor = DS.Palette.accentText; a.backgroundColor = DS.Palette.selection }
				else if line.hasPrefix("-") && !line.hasPrefix("---") { a.foregroundColor = DS.Palette.danger; a.backgroundColor = DS.Palette.dangerTint }
				else if line.hasPrefix("@@") { a.foregroundColor = DS.Palette.textSecondary }
			} else {
				colorize(&a, line)
			}
			out += a
		}
		return out
	}

	private static func colorize(_ a: inout AttributedString, _ line: String) {
		let s = String(a.characters)
		func paint(_ pattern: String, _ color: Color) {
			guard let re = try? NSRegularExpression(pattern: pattern) else { return }
			for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
				guard let r = Range(m.range, in: s), let lo = AttributedString.Index(r.lowerBound, within: a), let hi = AttributedString.Index(r.upperBound, within: a) else { continue }
				a[lo..<hi].foregroundColor = color
			}
		}
		paint("\\b\\d+(?:\\.\\d+)?\\b", DS.Palette.textSecondary)
		paint("\\b(?:" + keywords.joined(separator: "|") + ")\\b", DS.Palette.accentText)
		paint("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`[^`]*`", DS.Palette.textSecondary)
		paint("(?://|#(?!\\w)|--\\s).*$", DS.Palette.textTertiary)
	}
}
