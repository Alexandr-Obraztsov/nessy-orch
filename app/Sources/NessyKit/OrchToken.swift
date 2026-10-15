import Foundation

/// Токен оператора оркестратора: файл `<NESSY_ORCH_HOME или ~/.nessy-orch>/token`, который создаёт сервис при первом старте.
/// Приложение подписывает им запросы, а терминал главного агента получает его в `NESSY_ORCH_TOKEN` (по нему CLI и хуки доказывают,
/// что это оператор, а не агент nessy, окружение которого — окружение демона).
public enum OrchToken {
	public static func file(env: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> URL {
		let dir = env["NESSY_ORCH_HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? home + "/.nessy-orch"
		return URL(fileURLWithPath: dir).appendingPathComponent("token")
	}

	/// Каталог данных оркестратора (`NESSY_ORCH_HOME` или `~/.nessy-orch`).
	public static func home(env: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> URL {
		URL(fileURLWithPath: env["NESSY_ORCH_HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? home + "/.nessy-orch")
	}

	/// Папка с файлами роли (скрипты, шаблоны): `<home>/role-packages/<id>`.
	public static func rolePackage(_ id: String, env: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> URL {
		Self.home(env: env, home: home).appendingPathComponent("role-packages").appendingPathComponent(id)
	}

	/// Токен или nil (сервис ещё не создавал его).
	public static func read(env: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> String? {
		guard let s = try? String(contentsOf: file(env: env, home: home), encoding: .utf8) else { return nil }
		let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
		return t.count >= 16 ? t : nil
	}
}
