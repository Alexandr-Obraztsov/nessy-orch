import Foundation

/// Произвольный JSON (вход инструментов и т.п.).
public enum JSONValue: Codable, Hashable, Sendable {
	case null
	case bool(Bool)
	case number(Double)
	case string(String)
	case array([JSONValue])
	case object([String: JSONValue])

	public init(from decoder: Decoder) throws {
		let c = try decoder.singleValueContainer()
		if c.decodeNil() { self = .null }
		else if let v = try? c.decode(Bool.self) { self = .bool(v) }
		else if let v = try? c.decode(Double.self) { self = .number(v) }
		else if let v = try? c.decode(String.self) { self = .string(v) }
		else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
		else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
		else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "неизвестный JSON") }
	}

	public func encode(to encoder: Encoder) throws {
		var c = encoder.singleValueContainer()
		switch self {
		case .null: try c.encodeNil()
		case .bool(let v): try c.encode(v)
		case .number(let v): try c.encode(v)
		case .string(let v): try c.encode(v)
		case .array(let v): try c.encode(v)
		case .object(let v): try c.encode(v)
		}
	}

	public var string: String? { if case .string(let s) = self { return s } else { return nil } }
	public var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
	public var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }

	/// Человекочитаемый вид (для показа входа инструмента).
	public var pretty: String {
		let enc = JSONEncoder()
		enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
		guard let d = try? enc.encode(self), let s = String(data: d, encoding: .utf8) else { return "" }
		return s
	}
}
