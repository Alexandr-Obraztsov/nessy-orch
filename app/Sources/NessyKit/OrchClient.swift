import Foundation

public struct APIError: Error, LocalizedError, Sendable {
	public var status: Int
	public var code: String
	public var message: String
	public var errorDescription: String? { message }
	/// Демон недоступен (нет соединения), а не ответил ошибкой.
	public var isOffline: Bool { status == 0 }
}

/// REST-клиент оркестратора (docs/api.md). Потоки — SSEStream.
public final class OrchClient: @unchecked Sendable {
	public let baseURL: URL
	private let session: URLSession

	/// токен оператора читается заново при каждом запросе: сервис мог создать его уже после запуска приложения
	private let token: @Sendable () -> String?

	public init(baseURL: URL = URL(string: "http://127.0.0.1:4337")!, token: @escaping @Sendable () -> String? = { OrchToken.read() }) {
		self.baseURL = baseURL
		self.token = token
		let cfg = URLSessionConfiguration.ephemeral
		cfg.timeoutIntervalForRequest = 30
		cfg.waitsForConnectivity = false
		cfg.httpAdditionalHeaders = ["Accept": "application/json"]
		self.session = URLSession(configuration: cfg)
	}

	func url(_ path: String, query: [String: String?] = [:]) -> URL {
		var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
		c.path = path
		let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }
		if !items.isEmpty { c.queryItems = items.sorted { $0.name < $1.name } }
		return c.url!
	}

	@discardableResult
	func raw(_ method: String, _ path: String, query: [String: String?] = [:], body: Encodable? = nil, timeout: TimeInterval? = nil) async throws -> Data {
		var req = URLRequest(url: url(path, query: query))
		req.httpMethod = method
		if let timeout { req.timeoutInterval = timeout }
		if let t = token() { req.setValue(t, forHTTPHeaderField: "X-Orch-Token") }
		if let body {
			req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
			req.setValue("application/json", forHTTPHeaderField: "Content-Type")
		} else if method != "GET" {
			req.httpBody = Data("{}".utf8)
			req.setValue("application/json", forHTTPHeaderField: "Content-Type")
		}
		let data: Data, resp: URLResponse
		do { (data, resp) = try await session.data(for: req) }
		catch { throw APIError(status: 0, code: "offline", message: "Оркестратор недоступен (\(baseURL.host ?? "?"):\(baseURL.port ?? 0))") }
		let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
		if status >= 400 {
			struct E: Decodable { var error: String?; var code: String? }
			let e = try? JSONDecoder().decode(E.self, from: data)
			throw APIError(status: status, code: e?.code ?? "http_\(status)", message: e?.error ?? "HTTP \(status)")
		}
		return data
	}

	func get<T: Decodable>(_ path: String, query: [String: String?] = [:], as: T.Type = T.self) async throws -> T {
		try JSONDecoder().decode(T.self, from: try await raw("GET", path, query: query))
	}
	func send<T: Decodable>(_ method: String, _ path: String, body: Encodable? = nil, query: [String: String?] = [:], timeout: TimeInterval? = nil, as: T.Type = T.self) async throws -> T {
		try JSONDecoder().decode(T.self, from: try await raw(method, path, query: query, body: body, timeout: timeout))
	}

	// MARK: служебное
	public func status() async throws -> StatusResponse { try await get("/status") }

	// MARK: действия человека (приложение только наблюдает; запускает агентов Claude)
	public func cancel(_ ref: String) async throws { try await raw("POST", "/agents/\(ref)/cancel") }
	/// Написать агенту от имени человека: по умолчанию не прерывает: сообщение доходит до агента в идущем ходе или встаёт в очередь (docs/api.md, SendRequest).
	/// Возвращает сохранённое сообщение; тело ответа не критично, поэтому его разбор не роняет вызов.
	@discardableResult
	public func sendMessage(to ref: String, text: String, interrupt: Bool = false) async throws -> Message? {
		struct Ack: Decodable { var message: Message? }
		let data = try await raw("POST", "/agents/\(ref)/send", body: SendBody(text: text, interrupt: interrupt))
		return (try? JSONDecoder().decode(Ack.self, from: data))?.message
	}

	// MARK: роли (docs/api.md: RoleRequest)
	/// Создать (`id == nil`) или заменить поля роли. `color`/`icon` = nil — не передавать (останутся прежними); `icon: ""` убирает иконку.
	@discardableResult
	public func saveRole(id: String?, name: String, description: String, instructions: String, color: Double? = nil, icon: String? = nil) async throws -> RoleView {
		let body = RoleBody(name: name, description: description, instructions: instructions, color: color, icon: icon)
		if let id { return try await send("PUT", "/roles/\(id)", body: body) }
		return try await send("POST", "/roles", body: body)
	}
	public func deleteRole(_ id: String) async throws { try await raw("DELETE", "/roles/\(id)") }

	// MARK: сессии
	/// Терминал проекта закрыт: сервер завершает его сессии и останавливает работающих агентов.
	public func terminalClosed(_ key: String) async throws { try await raw("POST", "/terminals/\(key)/closed", body: [String: String]()) }
	public func deleteSession(_ id: String) async throws { try await raw("DELETE", "/sessions/\(id)") }
	// MARK: потоки
	public func stream() -> SSEStream { SSEStream(url: url("/stream")) }
	public func agentStream(_ ref: String) -> SSEStream { SSEStream(url: url("/agents/\(ref)/stream")) }
}

// MARK: тела запросов

/// Тело `POST/PUT /roles`: без color.
struct RoleBody: Encodable {
	var name: String; var description: String; var instructions: String
	var color: Double? = nil
	var icon: String? = nil
}

/// Тело `POST /agents/:ref/send`: отправитель всегда you.
struct SendBody: Encodable {
	var text: String
	/// человек из приложения: ответ агента идёт ему, а главный агент сессии получает служебную копию
	var from = "user"
	var interrupt: Bool
}

struct AnyEncodable: Encodable {
	let base: Encodable
	init(_ b: Encodable) { base = b }
	func encode(to encoder: Encoder) throws { try base.encode(to: encoder) }
}
