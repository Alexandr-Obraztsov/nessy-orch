import Foundation

/// Разбор строки SSE: нужны только кадры `data: <json>` (сервер шлёт JSON одной строкой, без `event:`).
public enum SSELine {
	public static func payload(_ line: String) -> Data? {
		guard line.hasPrefix("data:") else { return nil }
		var s = line.dropFirst(5)
		if s.first == " " { s = s.dropFirst() }
		return s.isEmpty ? nil : Data(s.utf8)
	}
}

public enum SSEState: Sendable, Equatable { case connecting, open, failed(String) }

/// SSE-подписка с автопереподключением (пауза растёт до 5 с). На каждое (пере)подключение вызывается onOpen —
/// клиент обязан сбросить накопленное состояние: сервер повторно присылает снапшот/реплей.
public final class SSEStream: @unchecked Sendable {
	private let url: URL
	private var task: Task<Void, Never>?

	init(url: URL) { self.url = url }

	public func start(
		onState: @escaping @Sendable (SSEState) -> Void,
		onOpen: @escaping @Sendable () -> Void,
		onData: @escaping @Sendable (Data) -> Void
	) {
		let url = self.url
		task = Task.detached {
			var attempt = 0
			let cfg = URLSessionConfiguration.ephemeral
			cfg.timeoutIntervalForRequest = 60 // сервер шлёт heartbeat каждые 15 с
			cfg.timeoutIntervalForResource = 24 * 3600
			let session = URLSession(configuration: cfg)
			while !Task.isCancelled {
				onState(.connecting)
				do {
					var req = URLRequest(url: url)
					req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
					let (bytes, resp) = try await session.bytes(for: req)
					guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
						throw APIError(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, code: "stream", message: "поток недоступен")
					}
					attempt = 0
					onState(.open)
					onOpen()
					for try await line in bytes.lines {
						if let d = SSELine.payload(line) { onData(d) }
					}
					throw APIError(status: 0, code: "closed", message: "поток закрыт")
				} catch {
					if Task.isCancelled { break }
					onState(.failed(error.localizedDescription))
					attempt += 1
					let delay = min(5.0, 0.4 * pow(1.7, Double(attempt)))
					try? await Task.sleep(for: .seconds(delay))
				}
			}
		}
	}

	public func stop() {
		task?.cancel()
		task = nil
	}
	deinit { task?.cancel() }
}
