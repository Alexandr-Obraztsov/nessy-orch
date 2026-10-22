import Foundation

public struct APIError: Error, LocalizedError, Sendable {
	public var status: Int
	public var code: String
	public var message: String
	/// текущая версия объекта в ответе 409 `stale`
	public var version: Int? = nil
	public var errorDescription: String? { message }
	/// Демон недоступен (нет соединения), а не ответил ошибкой.
	public var isOffline: Bool { status == 0 }
	/// Фоновое обучение на сервере недоступно: `learning_unavailable` (503) или маршрутов нет (старый сервер, 404 без кода).
	public var isUnavailable: Bool { code == "learning_unavailable" || code == "playbooks_unavailable" || (status == 404 && (code == "not_found" || code == "http_404")) }
	/// Объект занят фоновым агентом: правку надо повторить позже (`case_busy`, `playbook_busy`).
	public var isBusy: Bool { code == "case_busy" || code == "playbook_busy" }
	/// Правили устаревшую версию (плейбук или описание кейса изменились), 409 `stale`: перечитать и перенести правки.
	public var isStale: Bool { code == "stale" }
	/// Правка плейбука не прошла проверку (`lint`, 400): текст замечаний в `message`.
	public var isLint: Bool { code == "lint" }
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
			struct E: Decodable { var error: String?; var code: String?; var version: Int? }
			let e = try? JSONDecoder().decode(E.self, from: data)
			throw APIError(status: status, code: e?.code ?? "http_\(status)", message: e?.error ?? "HTTP \(status)", version: e?.version)
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
	/// Убрать агента в архив (скрыть из списка); работающего нельзя — сначала прервать ход.
	public func archiveAgent(_ ref: String) async throws { _ = try await raw("POST", "/agents/\(ref)/archive", body: [String: String]()) }
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
	/// Завести роли папку для файлов (скрипты, шаблоны); если она есть — ничего не меняется.
	@discardableResult
	/// Подхватить правки role.md из папки роли (редактор кода) в роль.
	public func syncRole(_ id: String) async throws -> RoleView { try await send("POST", "/roles/\(id)/sync", body: [String: String]()) }
	public func ensureRolePackage(_ id: String) async throws -> RoleView { try await send("POST", "/roles/\(id)/package", body: [String: String]()) }

	// MARK: сессии
	/// Новая сессия вкладки проекта: папка и id чата Claude (`--session-id`).
	public func createSession(cwd: String, chatId: String) async throws -> SessionView {
		try await send("POST", "/sessions", body: SessionBody(cwd: cwd, chatId: chatId))
	}
	/// Вкладка закрыта: сервер останавливает работающих агентов сессии (сама сессия остаётся для `--resume`).
	public func sessionClosed(_ id: String) async throws { try await raw("POST", "/sessions/\(id)/closed", body: [String: String]()) }
	/// Название сессии (по чату Claude).
	public func renameSession(_ id: String, title: String) async throws { try await raw("PATCH", "/sessions/\(id)", body: ["title": title]) }
	public func deleteSession(_ id: String) async throws { try await raw("DELETE", "/sessions/\(id)") }
	// MARK: обучение (docs/api.md, «Фоновое обучение»; не-GET — только оператору)
	public func learning() async throws -> LearningView { try await get("/learning") }
	/// Изменить настройки: в теле только изменённые поля (`["autoReview": .bool(false)]`).
	@discardableResult
	public func patchLearningSettings(_ changes: [String: JSONValue]) async throws -> LearningSettings { try await send("PATCH", "/learning/settings", body: changes) }
	/// Собрать кейс сейчас: итоговое задание по сессии (`session`) или по всем незакрытым кейсам.
	@discardableResult
	public func runLearning(session: String? = nil) async throws -> [JobView] {
		try await send("POST", "/learning/run", body: session.map { ["session": $0] } ?? [String: String]())
	}
	/// Остановить задание любого вида: ждущее снимается, идущее прерывается без повторов.
	public func cancelJob(_ id: String) async throws { try await raw("POST", "/learning/jobs/\(id)/cancel", body: [String: String]()) }
	public func job(_ id: String) async throws -> JobDetail { try await get("/learning/jobs/\(id)") }

	public func caseDetail(_ id: String) async throws -> CaseDetail { try await get("/learning/cases/\(id)") }
	/// События кейса `from…to` (без `to` — до конца, сервер отдаёт не больше 500) для якоря «открыть место в сессии».
	public func caseRaw(_ id: String, from: Int, to: Int? = nil) async throws -> [RawEvent] {
		let data = try await raw("GET", "/learning/cases/\(id)/raw", query: ["from": String(from), "to": to.map(String.init)])
		return (try JSONDecoder().decode(LossyArray<RawEvent>.self, from: data)).items
	}
	public func caseImpact(_ id: String) async throws -> CaseImpact { try await get("/learning/cases/\(id)/impact") }
	public func deleteCase(_ id: String) async throws { try await raw("DELETE", "/learning/cases/\(id)") }

	public func playbooks() async throws -> [PlaybookView] { (try await get("/learning/playbooks", as: LossyArray<PlaybookView>.self)).items }
	public func playbookDetail(_ id: String) async throws -> PlaybookDetail { try await get("/learning/playbooks/\(id)") }
	@discardableResult
	public func approvePlaybook(_ id: String) async throws -> PlaybookView { try await send("POST", "/learning/playbooks/\(id)/approve", body: [String: String]()) }
	@discardableResult
	public func rejectPlaybook(_ id: String, reason: String? = nil) async throws -> PlaybookView {
		try await send("POST", "/learning/playbooks/\(id)/reject", body: reason.map { ["reason": $0] } ?? [String: String]())
	}
	public func deletePlaybook(_ id: String) async throws { try await raw("DELETE", "/learning/playbooks/\(id)") }

	/// Записи журнала; `before` — id записи, старше которой нужна страница.
	public func journal(limit: Int? = nil, before: String? = nil) async throws -> [JournalEntry] {
		(try await get("/learning/journal", query: ["limit": limit.map(String.init), "before": before], as: LossyArray<JournalEntry>.self)).items
	}
	// MARK: потоки
	public func stream() -> SSEStream { SSEStream(url: url("/stream")) }
	public func agentStream(_ ref: String) -> SSEStream { SSEStream(url: url("/agents/\(ref)/stream")) }
}

// MARK: тела запросов

/// Тело `POST /sessions` вкладки проекта.
struct SessionBody: Encodable {
	var cwd: String
	var chatId: String
}

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
