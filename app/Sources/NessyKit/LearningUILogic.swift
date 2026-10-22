import Foundation

// Логика окна «Фон» без UI: токен запроса, очередь настроек, измерение длинного текста.

// MARK: - токен запроса

/// Ответы `load()` приходят не по порядку: применять можно только ответ самого свежего запроса.
public struct RequestToken: Sendable {
	private var n = 0
	public init() {}
	/// Новый запрос: все прежние становятся устаревшими.
	public mutating func next() -> Int { n += 1; return n }
	public func isCurrent(_ t: Int) -> Bool { t == n }
}

// MARK: - очередь PATCH настроек

/// Правки настроек копятся и уходят одним `PATCH` через `debounce` после последней; запросы идут по одному,
/// поэтому побеждает последнее значение. Пока что-то не ушло, `isBusy`.
@MainActor
public final class SettingsPatchQueue {
	public var debounce: Duration
	public var send: ([String: JSONValue]) async throws -> Void = { _ in }
	public var onError: (Error) -> Void = { _ in }
	/// очередь опустела (всё отправлено)
	public var onIdle: () async -> Void = {}
	private var pending: [String: JSONValue] = [:]
	private var timer: Task<Void, Never>?
	private var draining = false

	public init(debounce: Duration = .milliseconds(400)) { self.debounce = debounce }

	public var isBusy: Bool { !pending.isEmpty || draining || timer != nil }

	public func set(_ changes: [String: JSONValue]) {
		for (k, v) in changes { pending[k] = v }
		timer?.cancel()
		let d = debounce
		timer = Task { [weak self] in
			try? await Task.sleep(for: d)
			guard !Task.isCancelled else { return }
			await self?.drain()
		}
	}

	/// Отправить накопленное сразу (закрытие вкладки).
	public func flush() async {
		timer?.cancel()
		await drain()
	}

	private func drain() async {
		timer = nil
		guard !draining else { return }
		draining = true
		while !pending.isEmpty {
			let batch = pending
			pending = [:]
			do { try await send(batch) } catch { onError(error) }
		}
		draining = false
		if timer == nil { await onIdle() }
	}
}

extension LearningText {
	/// Сколько событий отдаёт сервер за один запрос.
	public static let rawLimit = 500

	/// «показаны первые 500» — когда список упёрся в предел сервера.
	public static func rawLimitNote(count: Int) -> String? {
		count >= rawLimit ? "Показаны первые \(rawLimit) событий" : nil
	}
}

// MARK: - длинный текст

public enum LongTextMeasure {
	/// Длинный ли текст: стоимость ограничена `preview`, как бы велик ни был текст (сотни КБ не считаются целиком).
	public static func isLong(_ text: String, preview: Int, lines: Int) -> Bool {
		if text.utf8.count > preview * 4 { return true }
		if text.count > preview { return true }
		return text.split(separator: "\n", omittingEmptySubsequences: false).count > lines
	}
}
