import Foundation
import Observation

/// Чат одного агента: реплей + живые кадры `/agents/:ref/stream`.
/// Правило слияния: событие с уже виденным `seq` заменяет прежнее; `chunk` дописывает дельту к живому блоку.
@MainActor
@Observable
public final class ChatModel {
	public private(set) var items: [AgentEvent] = []
	public private(set) var replayDone = false

	private var index: [Int: Int] = [:]
	private var stream: SSEStream?
	public let ref: String

	public init(ref: String) { self.ref = ref }

	public func start(client: OrchClient) {
		stop()
		let s = client.agentStream(ref)
		stream = s
		s.start(
			onState: { _ in },
			onOpen: { [weak self] in Task { @MainActor in self?.reset() } },
			onData: { [weak self] d in
				let ev = AgentStreamEvent.decode(d)
				Task { @MainActor in self?.enqueue(ev) }
			}
		)
	}

	/// События копятся и применяются пачкой раз в ~60 мс: реплей истории — сотни событий, а каждое по отдельности
	/// перестраивало бы всю ленту (и душило главный поток, например во время анимации перехода к чату).
	private var pending: [AgentStreamEvent] = []
	private var flushScheduled = false

	private func enqueue(_ ev: AgentStreamEvent) {
		pending.append(ev)
		guard !flushScheduled else { return }
		flushScheduled = true
		Task { @MainActor [weak self] in
			try? await Task.sleep(for: .milliseconds(60))
			self?.flush()
		}
	}

	private func flush() {
		flushScheduled = false
		let batch = pending
		pending = []
		for e in batch { apply(e) }
	}

	public func stop() {
		pending = []
		stream?.stop()
		stream = nil
	}

	public func reset() {
		pending = []
		items = []
		index = [:]
		replayDone = false
	}

	public func apply(_ e: AgentStreamEvent) {
		switch e {
		case .event(let ev): upsert(ev)
		case .chunk(let c): applyChunk(c)
		case .agent: break
		case .replayDone: replayDone = true
		case .unknown: break
		}
	}

	func upsert(_ ev: AgentEvent) {
		if let i = index[ev.seq] {
			items[i] = ev
			return
		}
		// события приходят по возрастанию seq; вставка в середину — только при реплее вразнобой
		if let last = items.last, last.seq > ev.seq {
			let pos = items.firstIndex { $0.seq > ev.seq } ?? items.count
			items.insert(ev, at: pos)
			index = Dictionary(uniqueKeysWithValues: items.enumerated().map { ($1.seq, $0) })
		} else {
			index[ev.seq] = items.count
			items.append(ev)
		}
	}

	func applyChunk(_ c: ChunkEvent) {
		let isThought = c.kind == "thought"
		if let i = index[c.seq] {
			switch items[i] {
			case .text(var t) where !isThought:
				guard t.text.count < c.len else { return } // дубль реплея
				t.text += c.delta
				items[i] = .text(t)
			case .thought(var t) where isThought:
				guard t.text.count < c.len else { return }
				t.text += c.delta
				items[i] = .thought(t)
			default: break
			}
			return
		}
		let t = AgentEvent.TextEvent(seq: c.seq, ts: c.ts, text: c.delta)
		upsert(isThought ? .thought(t) : .text(t))
	}

	// MARK: производные

	/// Последний ответ агента в текущем ходе: текст после последнего `user`-события.
	public var lastAnswer: String? {
		for e in items.reversed() {
			switch e {
			case .text(let t): return t.text
			case .user: return nil
			default: continue
			}
		}
		return nil
	}

}

/// Элемент ленты чата для показа: подряд идущие инструменты схлопываются в группу.
public enum ChatRow: Identifiable, Hashable, Sendable {
	case event(AgentEvent)
	case tools([AgentEvent.ToolEvent])

	public var id: String {
		switch self {
		case .event(let e): "e\(e.seq)"
		case .tools(let t): "g\(t.first?.seq ?? 0)"
		}
	}
}

public enum ChatLayout {
	/// Подряд идущие инструменты (≥ 1) объединяются; размышления и системные записи остаются отдельными.
	public static func rows(_ items: [AgentEvent]) -> [ChatRow] {
		var rows: [ChatRow] = []
		var run: [AgentEvent.ToolEvent] = []
		func flush() { if !run.isEmpty { rows.append(.tools(run)); run = [] } }
		for e in items {
			if case .tool(let t) = e { run.append(t) } else { flush(); rows.append(.event(e)) }
		}
		flush()
		return rows
	}
}
