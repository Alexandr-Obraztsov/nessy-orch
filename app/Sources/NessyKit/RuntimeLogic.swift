import Foundation

/// Рантайм агента: человеческое название, короткая модель, фильтр списка и читаемые ошибки API.
public enum RuntimeLogic {
	public static let defaultId = "nessy-sdk"

	/// Нет рантайма (старые снимки) — nessy-sdk.
	public static func id(_ runtime: String?) -> String {
		let r = runtime?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return r.isEmpty ? defaultId : r
	}

	/// «nessy» для nessy-sdk, «Claude Code» для tclaude, неизвестный — как есть.
	public static func name(_ runtime: String?) -> String {
		switch id(runtime) {
		case "nessy-sdk": "nessy"
		case "tclaude": "Claude Code"
		case let other: other
		}
	}

	/// Рантайм агента: свой, иначе рантайм его пространства, иначе nessy-sdk.
	public static func id(of agent: AgentView, spaces: [SpaceView]) -> String {
		id(agent.runtime ?? spaces.first { $0.name == agent.space }?.runtime)
	}

	/// Короткая модель: без префикса провайдера и даты. `claude-sonnet-4-5-20250929` → `sonnet 4.5`; незнакомое — без даты, как есть.
	public static func shortModel(_ model: String?) -> String? {
		var m = model?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		if let slash = m.lastIndex(of: "/") { m = String(m[m.index(after: slash)...]) }
		if m.hasPrefix("claude-") { m = String(m.dropFirst(7)) }
		m = m.replacingOccurrences(of: "-\\d{8}$", with: "", options: .regularExpression)
		guard !m.isEmpty else { return nil }
		if let g = groups(m, "^(opus|sonnet|haiku)-(\\d+)(?:-(\\d+))?$") {
			return g[3].isEmpty ? "\(g[1]) \(g[2])" : "\(g[1]) \(g[2]).\(g[3])"
		}
		if let g = groups(m, "^(\\d+)(?:-(\\d+))?-(opus|sonnet|haiku)$") {
			return g[2].isEmpty ? "\(g[3]) \(g[1])" : "\(g[3]) \(g[1]).\(g[2])"
		}
		return m
	}

	private static func groups(_ s: String, _ pattern: String) -> [String]? {
		guard let re = try? NSRegularExpression(pattern: pattern),
			  let r = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
		return (0..<r.numberOfRanges).map { i in
			Range(r.range(at: i), in: s).map { String(s[$0]) } ?? ""
		}
	}

	/// Рантаймы видимых агентов без повторов: nessy-sdk первым, остальные по алфавиту.
	public static func ids(in agents: [AgentView], spaces: [SpaceView] = []) -> [String] {
		let all = Set(agents.map { id(of: $0, spaces: spaces) })
		return all.sorted { ($0 == defaultId) != ($1 == defaultId) ? $0 == defaultId : $0 < $1 }
	}

	/// Фильтр списка: nil — все.
	public static func filter(_ agents: [AgentView], runtime: String?, spaces: [SpaceView] = []) -> [AgentView] {
		guard let runtime else { return agents }
		return agents.filter { id(of: $0, spaces: spaces) == runtime }
	}

	/// Подпись модели агента: короткая форма и пометка, если модель запрошена, но не подтверждена или рантайм подставил другую.
	/// Нет модели — nil (пустую строку не рисуем). Запрошенная модель важнее: `modelRequested`, затем собственная модель без подтверждения.
	public struct ModelCaption: Equatable, Sendable {
		public var text: String
		public var requested: String?
		/// Полная подсказка для `.help`.
		public var help: String
	}
	public static func modelCaption(_ a: AgentView) -> ModelCaption? {
		guard let text = shortModel(a.model) else { return nil }
		var requested: String?
		if let r = shortModel(a.modelRequested), r != text { requested = r }
		else if a.modelRequested == nil, a.modelConfirmed == false { requested = text }
		var help = "Модель: \(a.model ?? text)"
		if let r = a.modelRequested, requested != nil, requested != text { help += ". Запрошена \(r), рантайм подставил другую" }
		else if requested != nil { help += ". Рантайм ещё не подтвердил модель" }
		return ModelCaption(text: text, requested: requested, help: help)
	}

	/// Модели для меню: каталог рантайма без повторов, текущая (если её нет в каталоге) первой; пустые id отброшены.
	public static func modelOptions(_ info: RuntimeInfo?, current: String? = nil) -> [RuntimeModel] {
		var seen = Set<String>(), out: [RuntimeModel] = []
		let cur = current?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let catalog = info?.models ?? []
		if !cur.isEmpty, !catalog.contains(where: { $0.id == cur }) { seen.insert(cur); out.append(RuntimeModel(id: cur, label: cur)) }
		for m in catalog where !m.id.isEmpty && seen.insert(m.id).inserted { out.append(m) }
		return out
	}

	/// Выбранная в меню модель: совпадение по id с `current` (текущая модель агента может быть полным id, а в каталоге — псевдоним).
	public static func isSelected(_ model: RuntimeModel, current: String?) -> Bool {
		guard let c = current?.trimmingCharacters(in: .whitespacesAndNewlines), !c.isEmpty else { return false }
		return model.id == c || (shortModel(model.id) != nil && shortModel(model.id) == shortModel(c))
	}

	/// Рантайм из каталога по id (nil и пусто — nessy-sdk).
	public static func info(_ id: String?, in catalog: [RuntimeInfo]) -> RuntimeInfo? {
		let i = Self.id(id)
		return catalog.first { $0.id == i }
	}

	/// Меню «Модель» показывается: рантайм умеет менять модель и есть из чего выбирать.
	public static func supportsModelSwitch(_ runtime: RuntimeInfo?) -> Bool {
		guard let runtime else { return false }
		return runtime.capabilities.setModel && !runtime.models.isEmpty
	}
	/// Модель можно менять сейчас: рантайм умеет, а агент не занят (ход, очередь).
	public static func canSwitchModel(_ a: AgentView, runtime: RuntimeInfo?) -> Bool {
		supportsModelSwitch(runtime) && !isBusy(a)
	}
	/// Агент работает или у него очередь: сервер ответит 409 busy.
	public static func isBusy(_ a: AgentView) -> Bool { a.status == .working || a.status == .starting || a.queued > 0 }

	/// Подпись модели роли: короткая форма или «по умолчанию».
	public static func roleModelLabel(_ model: String?) -> String { shortModel(model) ?? "по умолчанию" }

	/// Читаемый текст ошибки API: смена модели, 409 `runtime_mismatch` и 400 про runtime; прочее — как пришло.
	public static func apiMessage(status: Int, code: String, message: String) -> String {
		switch code {
		case "model_switch_unsupported": return "Этот рантайм не умеет менять модель на лету"
		case "busy" where status == 409: return "Агент занят: модель меняется, когда он закончил ход и очередь пуста"
		case "model_switch_failed": return "Рантайм отказался менять модель" + (message.isEmpty ? "" : ": \(message)")
		default: break
		}
		let isRuntime = code == "runtime_mismatch" || (status == 400 && message.contains("runtime"))
		guard isRuntime else { return message }
		let human = message
			.replacingOccurrences(of: "nessy-sdk", with: name("nessy-sdk"))
			.replacingOccurrences(of: "tclaude", with: name("tclaude"))
		return code == "runtime_mismatch" ? "Рантайм не совпадает: \(human)" : "Неверный рантайм: \(human)"
	}
}
