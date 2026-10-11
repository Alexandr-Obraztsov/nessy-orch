import Foundation

/// Папка сессии: каталог её терминала → пространство, где у сессии больше всего агентов → nil (layout-v2.md).
public enum Projects {
	/// Каталог без хвостового `/` и `~`-сокращений; пустой путь — nil.
	public static func normalize(_ path: String?) -> String? {
		guard var p = path?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty else { return nil }
		if p.hasPrefix("~") { p = NSHomeDirectory() + p.dropFirst() }
		while p.count > 1, p.hasSuffix("/") { p.removeLast() }
		return p
	}

	/// Имя проекта — последний компонент пути.
	public static func name(ofPath path: String) -> String {
		let n = (path as NSString).lastPathComponent
		return n.isEmpty ? path : n
	}

	/// Путь проекта сессии. Приоритет: запомненный каталог терминала, затем пространство с наибольшим числом агентов
	/// сессии (при равенстве — по имени, чтобы выбор не прыгал), иначе nil.
	public static func path(ofSession id: String, sessionDirs: [String: String], agents: [AgentView], spaces: [SpaceView]) -> String? {
		if let dir = normalize(sessionDirs[id]) { return dir }
		let counts = Dictionary(grouping: agents.filter { $0.session == id }, by: \.space).mapValues(\.count)
		let best = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
		for (spaceName, _) in best {
			if let p = normalize(spaces.first { $0.name == spaceName }?.path) { return p }
		}
		return nil
	}
}
