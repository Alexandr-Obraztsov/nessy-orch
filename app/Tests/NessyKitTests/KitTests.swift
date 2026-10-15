import Foundation
import Testing
@testable import NessyKit

func agentJSON(id: String = "a-1", status: String = "idle", archived: Bool = false, perms: String = "[]", reply: String = "null", session: String = "\"t1\"", created: String = "2026-10-10T10:00:00.000Z") -> String {
	"""
	{"id":"\(id)","name":"\(id)","space":"main","session":\(session),"parent":"you","role":null,"status":"\(status)","archived":\(archived),
	"error":null,"displayName":null,"createdAt":"\(created)","lastActivityAt":"\(created)","queued":0,"turnStartedAt":null,
	"lastTool":null,"preview":"","pendingPermissions":\(perms),"plan":null,"turnSteps":0,"lastTurnMs":null,"lastReply":\(reply),"stats":{"turns":0,"toolCalls":0,"workMs":0,"tokens":null}}
	"""
}
func decodeAgent(_ s: String) throws -> AgentView { try JSONDecoder().decode(AgentView.self, from: Data(s.utf8)) }

@Suite("Модели и потоки")
struct DecodingTests {
	@Test func snapshotDecodesAndUnknownEnumsDoNotCrash() throws {
		let json = """
		{"t":"snapshot","rev":3,"spaces":[{"name":"main","path":"/x","color":10,"mode":"managed","url":null,"status":"weird","error":null}],
		"agents":[\(agentJSON(status: "новый-статус"))],"roles":[],"sessions":[{"id":"t1","title":"T","owner":"claude","status":"active","summary":null,"createdAt":"2026-10-10T10:00:00Z","updatedAt":"2026-10-10T10:00:00Z","sources":2}],"messages":[]}
		"""
		guard case .snapshot(let s) = StreamEvent.decode(Data(json.utf8)) else { Issue.record("не снапшот"); return }
		#expect(s.agents.count == 1)
		#expect(s.agents[0].status == .idle)
		#expect(s.spaces[0].status == .stopped)
		#expect(s.sessions[0].owner == "claude")
		#expect(s.sessions[0].sources == 2)
	}

	@Test func agentEventsByKind() throws {
		func ev(_ s: String) -> AgentEvent? {
			guard case .event(let e) = AgentStreamEvent.decode(Data(#"{"t":"event","event":\#(s)}"#.utf8)) else { return nil }
			return e
		}
		#expect(ev(#"{"seq":1,"ts":1,"kind":"user","from":"you","msgId":"m","text":"привет"}"#)?.seq == 1)
		if case .tool(let t)? = ev(#"{"seq":2,"ts":1,"kind":"tool","toolId":"x","name":"run_shell_command","title":"Shell: ls","input":{"command":"ls -la"},"status":"in_progress"}"#) {
			#expect(t.status == .inProgress)
			#expect(t.view == ToolView(name: "Bash", arg: "ls -la"))
		} else { Issue.record("не tool") }
		if case .permission(let p)? = ev(#"{"seq":3,"ts":1,"kind":"permission","requestId":"r","title":"git push","resolved":true,"approved":true,"auto":true}"#) {
			#expect(p.auto == true)
		} else { Issue.record("не permission") }
		#expect(ev(#"{"seq":4,"ts":1,"kind":"mystery"}"#) == nil)
	}

	@Test func sseLine() {
		#expect(SSELine.payload(": hb") == nil)
		#expect(SSELine.payload("id: 5") == nil)
		#expect(SSELine.payload("data: {\"a\":1}") == Data("{\"a\":1}".utf8))
		#expect(SSELine.payload("data:{\"a\":1}") == Data("{\"a\":1}".utf8))
	}
}

@MainActor
@Suite("Чат агента")
struct ChatTests {
	func text(_ seq: Int, _ s: String) -> AgentEvent { .text(.init(seq: seq, ts: 0, text: s)) }

	@Test func chunksAppendAndFinalReplaces() {
		let c = ChatModel(ref: "a")
		c.apply(.chunk(.init(seq: 1, ts: 0, kind: "text", delta: "при", len: 3)))
		c.apply(.chunk(.init(seq: 1, ts: 0, kind: "text", delta: "вет", len: 6)))
		#expect(c.items.count == 1)
		if case .text(let t) = c.items[0] { #expect(t.text == "привет") }
		c.apply(.event(text(1, "привет!")))
		if case .text(let t) = c.items[0] { #expect(t.text == "привет!") }
		#expect(c.items.count == 1)
	}

	@Test func duplicateChunkAfterReplayIgnored() {
		let c = ChatModel(ref: "a")
		c.apply(.chunk(.init(seq: 1, ts: 0, kind: "text", delta: "abc", len: 3)))
		c.apply(.chunk(.init(seq: 1, ts: 0, kind: "text", delta: "abc", len: 3)))
		if case .text(let t) = c.items[0] { #expect(t.text == "abc") }
	}

	@Test func toolUpdateKeepsSeqAndOrder() {
		let c = ChatModel(ref: "a")
		func tool(_ seq: Int, _ st: ToolStatus) -> AgentEvent { .tool(.init(seq: seq, ts: 0, toolId: "x", name: "bash", title: "t", input: [:], status: st, output: nil)) }
		c.apply(.event(text(1, "a")))
		c.apply(.event(tool(2, .inProgress)))
		c.apply(.event(text(3, "b")))
		c.apply(.event(tool(2, .completed)))
		#expect(c.items.map(\.seq) == [1, 2, 3])
		if case .tool(let t) = c.items[1] { #expect(t.status == .completed) }
	}

	@Test func resetOnReconnect() {
		let c = ChatModel(ref: "a")
		c.apply(.event(text(1, "a"))); c.apply(.replayDone)
		c.reset()
		#expect(c.items.isEmpty && !c.replayDone)
	}

	@Test func toolRunsCollapse() {
		func tool(_ s: Int) -> AgentEvent { .tool(.init(seq: s, ts: 0, toolId: "\(s)", name: "bash", title: "", input: [:], status: .completed, output: nil)) }
		let rows = ChatLayout.rows([text(1, "x"), tool(2), tool(3), tool(4), text(5, "y"), tool(6)])
		#expect(rows.count == 4)
		if case .tools(let g) = rows[1] { #expect(g.count == 3) } else { Issue.record("нет группы") }
	}

	@Test func lastAnswerIsAfterLastUser() {
		let c = ChatModel(ref: "a")
		c.apply(.event(.user(.init(seq: 1, ts: 0, from: "you", msgId: "m", text: "q"))))
		#expect(c.lastAnswer == nil)
		c.apply(.event(text(2, "старый"))); c.apply(.event(text(3, "итог")))
		#expect(c.lastAnswer == "итог")
	}
}

@Suite("Логика агентов")
struct AgentLogicTests {
	@Test func stateOrderAndSort() throws {
		let perm = try decodeAgent(agentJSON(id: "a-wait", status: "working", perms: #"[{"requestId":"r","title":"git push"}]"#))
		let work = try decodeAgent(agentJSON(id: "a-work", status: "working", created: "2026-10-10T10:00:01Z"))
		let done = try decodeAgent(agentJSON(id: "a-done", status: "idle", archived: true))
		let idle = try decodeAgent(agentJSON(id: "a-idle", status: "idle"))
		let err = try decodeAgent(agentJSON(id: "a-err", status: "error"))
		#expect(perm.state == .wait && work.state == .working && done.state == .done && idle.state == .idle && err.state == .error)
		#expect(AgentOrder.sorted([done, idle, err, work, perm]).map(\.id) == ["a-wait", "a-work", "a-err", "a-idle", "a-done"])
	}

	@Test func replyMakesDone() throws {
		let a = try decodeAgent(agentJSON(status: "idle", reply: #"{"msgId":"m","ts":1,"preview":"Итог: ок"}"#))
		#expect(a.state == .done)
		#expect(Brief.summary(a) == "ок")
		let f = try decodeAgent(agentJSON(status: "idle", reply: #"{"msgId":"m","ts":1,"failed":"x","preview":"…"}"#))
		#expect(f.state == .idle)
	}

	@Test func elapsedAndStalled() throws {
		var a = try decodeAgent(agentJSON(status: "working"))
		a.turnStartedAt = "2026-10-10T10:00:00Z"
		let t0 = ISO.parse("2026-10-10T10:00:00Z")!
		#expect(a.elapsedMs(now: t0.addingTimeInterval(65)) == 65_000)
		#expect(a.isStalled(now: t0.addingTimeInterval(301)))
		#expect(!a.isStalled(now: t0.addingTimeInterval(60)))
		#expect(Durations.clock(65_000) == "1:05" && Durations.clock(3_723_000) == "1:02:03")
	}

	@Test func isoParsesWithAndWithoutFraction() {
		#expect(ISO.parse("2026-10-10T10:00:00.123Z") != nil)
		#expect(ISO.parse("2026-10-10T10:00:00Z") != nil)
		#expect(ISO.parse("мусор") == nil)
	}

	@Test func pluralRu() {
		#expect(Durations.plural(1, "агент", "агента", "агентов") == "агент")
		#expect(Durations.plural(3, "агент", "агента", "агентов") == "агента")
		#expect(Durations.plural(11, "агент", "агента", "агентов") == "агентов")
		#expect(Durations.plural(21, "агент", "агента", "агентов") == "агент")
	}
}

@Suite("Разбор ответа")
struct ReplyTests {
	let sample = """
	**Итог** — причина найдена.

	**Детали**
	- коммит a1b2c3d [1]

	**Источники**
	1. MR !12 — https://gitlab.example.com/team/shippy/-/merge_requests/12
	2. `shippy@a1b2c3d:src/retry.ts:42`
	3. https://jira.example.com/browse/PLAT-77

	**Не проверено / риски** — прод.

	Статус: DONE_WITH_CONCERNS — не гонял e2e
	"""

	@Test func statusAndSources() {
		let r = ReplyParser.parse(sample)
		#expect(r.status?.code == .doneWithConcerns)
		#expect(r.status?.reason == "не гонял e2e")
		#expect(r.sources.count == 3)
		#expect(r.sources[0].label == "MR !12")
		#expect(r.sources[1] == .text(label: "shippy@a1b2c3d:src/retry.ts:42"))
		#expect(r.sources[2].label == "PLAT-77")
		#expect(!r.body.contains("Источники") && !r.body.contains("Статус:"))
		#expect(r.body.contains("Не проверено"))
	}

	@Test func blockedNeedsHuman() {
		let r = ReplyParser.parse("Не могу.\n\nСтатус: BLOCKED — нет доступа к GitLab")
		#expect(r.status?.code == .blocked && r.status?.code.needsHuman == true)
	}

	@Test func plainReplyHasNoStatus() {
		let r = ReplyParser.parse("просто ответ")
		#expect(r.status == nil && r.sources.isEmpty && r.body == "просто ответ")
	}
}

@Suite("Текст запроса прав")
struct PermissionTextTests {
	@Test func permissionCommandDropsToolPrefix() {
		#expect(PermissionText.command("Shell: git push origin fix/x") == "git push origin fix/x")
		#expect(PermissionText.command("git push") == "git push")
		#expect(PermissionText.command("rm -rf /tmp: x") == "rm -rf /tmp: x", "двоеточие внутри команды не префикс")
	}
}

@Suite("Заголовок агента")
struct TitleTests {
	@Test func titleIsTheEssenceOfTheGoal() {
		#expect(Brief.title(fromGoal: "Цель: найти мёртвый код в серверной части. Только чтение.\nДалее детали") == "Найти мёртвый код в серверной части")
		#expect(Brief.title(fromGoal: "поручение — собрать сводку по спринту") == "Собрать сводку по спринту")
		#expect(Brief.title(fromGoal: "Коротко.") == "Коротко.", "первое предложение короче 12 знаков не режем")
		let long = Brief.title(fromGoal: String(repeating: "слово ", count: 40), limit: 30)
		#expect(long.count <= 31 && long.hasSuffix("…"))
		#expect(Brief.title(fromGoal: "") == "")
	}
}

@MainActor
@Suite("Хранилище")
struct StoreTests {
	func store() -> OrchStore { OrchStore(defaults: UserDefaults(suiteName: "test-\(UUID())")!) }

	func snapshot(agents: [String]) -> StreamEvent {
		let json = #"{"t":"snapshot","rev":1,"spaces":[],"agents":[\#(agents.joined(separator: ","))],"roles":[],"sessions":[{"id":"t1","title":"T","owner":null,"status":"active","summary":null,"createdAt":"2026-10-10T10:00:00Z","updatedAt":"2026-10-10T10:00:00Z"}],"messages":[]}"#
		return StreamEvent.decode(Data(json.utf8))
	}

	@Test func permissionNotifiesOnceAfterPriming() throws {
		let s = store()
		var events: [AttentionEvent] = []
		s.onAttention = { events.append($0) }
		s.apply(snapshot(agents: [agentJSON(status: "working")]))
		#expect(events.isEmpty, "первый снапшот не уведомляет")
		let waiting = try decodeAgent(agentJSON(status: "working", perms: #"[{"requestId":"r1","title":"git push"}]"#))
		s.apply(.agent(waiting))
		s.apply(.agent(waiting))
		#expect(events.count == 1 && events[0].kind == .permission && events[0].requestId == "r1")
	}

	@Test func resultIsNewButNotAttention() throws {
		let s = store()
		var events: [AttentionEvent] = []
		s.onAttention = { events.append($0) }
		s.apply(snapshot(agents: [agentJSON()]))
		let done = try decodeAgent(agentJSON(status: "idle", reply: #"{"msgId":"m1","ts":1,"preview":"готово","status":"DONE"}"#))
		s.apply(.agent(done))
		#expect(s.attentionCount == 0, "готовый результат действия не требует — не бейдж")
		#expect(events.isEmpty, "о готовом результате не уведомляем")
		#expect(s.isNew(done) && s.hasNew(session: "t1"))
		s.markSeen(agent: done)
		#expect(!s.isNew(done) && !s.hasNew(session: "t1"))
	}

	@Test func attentionCountsOnlyActionable() throws {
		let s = store()
		s.apply(snapshot(agents: [
			agentJSON(id: "a-perm", status: "working", perms: #"[{"requestId":"r1","title":"git push"},{"requestId":"r2","title":"rm x"}]"#),
			agentJSON(id: "a-err", status: "error"),
			agentJSON(id: "a-blk", status: "idle", reply: #"{"msgId":"m1","ts":1,"preview":"нет","status":"BLOCKED","reason":"нет доступа"}"#),
			agentJSON(id: "a-done", status: "idle", reply: #"{"msgId":"m2","ts":1,"preview":"ок","status":"DONE"}"#),
			agentJSON(id: "a-work", status: "working"),
		]))
		#expect(s.attentionCount == 3, "по агентам: два запроса одного агента — один агент")
		s.markSeen(agent: s.agents["a-blk"]!)
		#expect(s.attentionCount == 3, "блокировка не гаснет от просмотра — её снимает новое поручение")
	}

	@Test func blockedReplyIsBlockedKind() throws {
		let s = store()
		var events: [AttentionEvent] = []
		s.onAttention = { events.append($0) }
		s.apply(snapshot(agents: [agentJSON()]))
		let msg = #"{"t":"message","rev":2,"message":{"seq":1,"id":"m1","ts":1,"from":"a-1","to":"you","kind":"reply","text":"нет\n\nСтатус: BLOCKED — нет доступа","hops":0}}"#
		s.apply(StreamEvent.decode(Data(msg.utf8)))
		// статус ответа разбирает сервер (lastReply.status / reason)
		s.apply(.agent(try decodeAgent(agentJSON(status: "idle", reply: #"{"msgId":"m1","ts":1,"preview":"нет","status":"BLOCKED","reason":"нет доступа"}"#))))
		#expect(events.last?.kind == .blocked)
		#expect(events.last?.body == "нет доступа")
	}

	@Test func goalAndTitleComeFromFirstMessageToAgent() throws {
		let s = store()
		s.apply(snapshot(agents: [agentJSON(id: "a-1", status: "working")]))
		func msg(_ id: String, from: String, text: String) -> StreamEvent {
			StreamEvent.decode(Data(#"{"t":"message","rev":2,"message":{"seq":1,"id":"\#(id)","ts":1,"from":"\#(from)","to":"a-1","kind":"msg","text":"\#(text)","hops":0}}"#.utf8))
		}
		s.apply(msg("m1", from: "a-2", text: "Сначала от другого агента"))
		s.apply(msg("m2", from: "you", text: "Цель: проверить сборку. Подробности ниже"))
		s.apply(msg("m3", from: "you", text: "Второе сообщение не меняет цель"))
		let a = try #require(s.agents["a-1"])
		#expect(s.title(of: a) == "Проверить сборку", "приоритет у первого сообщения от you")
		#expect(s.goal(of: a).hasPrefix("Цель: проверить сборку"))
	}

	@Test func staleTask() throws {
		let s = store()
		s.apply(snapshot(agents: [agentJSON(status: "idle")]))
		let t = s.sessions[0]
		let now = ISO.parse("2026-10-10T12:00:00Z")!
		#expect(s.isStale(t, now: now))
		#expect(!s.isStale(t, now: ISO.parse("2026-10-10T10:10:00Z")!))
		s.apply(.agent(try decodeAgent(agentJSON(status: "working"))))
		#expect(!s.isStale(t, now: now), "работающий агент — задача жива")
	}
}


@Suite("Сессия: дерево, итоги, источники")
struct SessionLogicTests {
	func agent(_ id: String, parent: String = "you", status: String = "idle", stats: String = #"{"turns":1,"toolCalls":3,"workMs":2000,"tokens":null}"#) throws -> AgentView {
		var json = agentJSON(id: id, status: status)
		json = json.replacingOccurrences(of: #""parent":"you""#, with: #""parent":"\#(parent)""#)
		json = json.replacingOccurrences(of: #""stats":{"turns":0,"toolCalls":0,"workMs":0,"tokens":null}"#, with: #""stats":\#(stats)"#)
		return try decodeAgent(json)
	}

	@Test func rollupSumsStatsAndTokens() throws {
		let t1 = #"{"turns":2,"toolCalls":5,"workMs":4000,"tokens":{"input":100,"output":20,"cached":10,"total":120}}"#
		let a = try agent("a-1", stats: t1)
		let b = try agent("a-2")
		let r = SessionRollup([a, b])
		#expect(r.turns == 3 && r.toolCalls == 8 && r.workMs == 6000)
		#expect(r.tokens == TokenUsage(input: 100, output: 20, cached: 10, total: 120))
		#expect(r.tokenAgents == 1)
		#expect(SessionRollup([b]).tokens == nil, "токены не сообщены — nil, а не нули")
	}

	@Test func planDoneWhileWorkingShowsCurrentTool() throws {
		var a = try agent("a-1", status: "working")
		a.plan = AgentPlan(entries: [.init(content: "x", status: .completed), .init(content: "y", status: .completed)], updatedAt: "", source: "cli")
		a.lastTool = ToolBrief(name: "run_shell_command", title: "Shell: git push origin fix/x")
		#expect(a.toolText == "git push origin fix/x", "план кончился, агент ещё работает — сырая команда")
		let now = a.lastActivity!.addingTimeInterval(2)
		#expect(a.stage(now: now)?.kind == .planDone)
		a.status = .idle
		#expect(a.lastDoneText == "y", "последняя выполненная задача")
		#expect(a.stage(now: now) == nil)
	}

	@Test func stageWithoutPlanAndSilence() throws {
		var a = try agent("a-1", status: "working")
		a.lastTool = ToolBrief(name: "read_file", title: "ReadFile: src/net/retry.ts")
		let t0 = a.lastActivity!
		#expect(a.stage(now: t0.addingTimeInterval(2))?.text == "Читает файл", "что делает, без пути")
		#expect(a.stage(now: t0.addingTimeInterval(65))?.text == a.stage(now: t0)?.text, "без «Нет новостей …»: тишина текстом не объясняется")
		a.lastTool = ToolBrief(name: "run_shell_command", title: "Shell: npm test")
		#expect(a.stage(now: t0)?.text == "Запускает команду", "без самой команды")
		a.lastTool = ToolBrief(name: "write_file", title: "WriteFile: src/a.ts")
		#expect(a.stage(now: t0)?.text == "Пишет файл")
		a.lastTool = nil
		#expect(a.stage(now: t0)?.text == "", "инструментов ещё не было — пусто, не «Думает»")
	}

	@Test func stalePlanYieldsToTool() throws {
		var a = try agent("a-1", status: "working")
		a.plan = AgentPlan(entries: [.init(content: "x", status: .inProgress)], updatedAt: "2026-10-10T09:50:00Z", source: "cli")
		a.lastTool = ToolBrief(name: "grep", title: "Grep: maxDelay")
		let s = a.stage(now: a.lastActivity!.addingTimeInterval(1))
		#expect(s?.text == "Ищет в коде", "строка — только чем занят агент")
	}

	@Test func groupsAndSummaryAgree() throws {
		func j(_ id: String, _ st: String, perms: String = "[]", reply: String = "null") throws -> AgentView { try decodeAgent(agentJSON(id: id, status: st, perms: perms, reply: reply)) }
		let list = [
			try j("a-w", "working", perms: #"[{"requestId":"r","title":"git push"}]"#),
			try j("a-e", "error"),
			try j("a-b", "idle", reply: #"{"msgId":"m1","ts":1,"preview":"","status":"NEEDS_CONTEXT"}"#),
			try j("a-c", "idle", reply: #"{"msgId":"m2","ts":1,"preview":"","status":"DONE_WITH_CONCERNS"}"#),
			try j("a-r", "working"),
			try j("a-i", "idle"),
		]
		let sections = AgentGrouping.sections(list)
		#expect(sections.map(\.group) == [.needsYou, .working, .done, .idle, .failed])
		#expect(sections[0].agents.map(\.id) == ["a-w", "a-b"], "запросы прав → блокировки")
		#expect(sections[4].agents.map(\.id) == ["a-e"], "ошибка без блокировки — в своей сворачиваемой группе")
		let sum = list.summary
		#expect(sum.needsYou == sections[0].agents.count + sections[4].agents.count && sum.error == 1 && sum.working == 1 && sum.done == 1 && sum.idle == 1)
		#expect(sections.map(\.agents.count).reduce(0, +) == sum.total)
		#expect(sum.top == .wait)
	}

	@Test func numbersInRussian() {
		#expect(Numbers.compact(840) == "840")
		#expect(Numbers.compact(2800) == "2,8 тыс.")
		#expect(Numbers.compact(2000) == "2 тыс.")
		#expect(Numbers.compact(12_400) == "12 тыс.")
		#expect(Numbers.statsLine(AgentStats(turns: 1, toolCalls: 4, workMs: 0, tokens: TokenUsage(input: 1, output: 1, cached: 0, total: 2800))) == "1 ход · 4 вызова · 2,8 тыс. токенов")
	}

	@Test func toolDurationFromEndedTs() throws {
		let json = #"{"t":"event","event":{"seq":1,"ts":1000,"kind":"tool","toolId":"x","name":"bash","title":"t","input":{},"status":"completed","endedTs":3500}}"#
		guard case .event(.tool(let t)) = AgentStreamEvent.decode(Data(json.utf8)) else { Issue.record("не tool"); return }
		#expect(t.duration == 2.5)
	}
}

@Suite("Окно плана, роли, отправка")
struct DialogTests {
	@Test func sendAndRoleBodies() throws {
		let b = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SendBody(text: "привет", interrupt: true))) as? [String: Any]
		#expect(b?["from"] as? String == "user")
		#expect(b?["interrupt"] as? Bool == true)
		let r = try JSONSerialization.jsonObject(with: JSONEncoder().encode(RoleBody(name: "A", description: "", instructions: "x"))) as? [String: Any]
		#expect(r?["color"] == nil && r?["icon"] == nil, "не переданные поля остаются прежними")
		#expect(r?["name"] as? String == "A")
		let r2 = try JSONSerialization.jsonObject(with: JSONEncoder().encode(RoleBody(name: "A", description: "", instructions: "x", color: 215, icon: ""))) as? [String: Any]
		#expect(r2?["color"] as? Double == 215 && r2?["icon"] as? String == "", "пустая иконка — убрать")
	}

	@Test func roleDraftAndUsage() throws {
		let role = try JSONDecoder().decode(RoleView.self, from: Data(#"{"id":"r1","name":"Ревьюер","description":"d","instructions":"строго","color":1,"createdAt":"x","updatedAt":"x"}"#.utf8))
		var d = RoleDraft(role)
		#expect(!d.isChanged(from: role))
		d.name = " Ревьюер "
		#expect(!d.isChanged(from: role))
		d.instructions = "мягко"
		#expect(d.isChanged(from: role))
		#expect(RoleDraft().isChanged(from: nil) == false)
		var g = SystemRandomNumberGenerator()
		let fresh = RoleDraft.fresh(using: &g)
		#expect(RolePalette.hues.contains(fresh.color) && RolePalette.icons.contains(fresh.icon))
		#expect(!fresh.isChanged(from: nil), "случайные цвет и иконка не делают новую роль изменённой")
		#expect(role.icon == nil && RoleDraft(role).icon == RolePalette.defaultIcon, "старая роль без иконки — иконка по умолчанию")
		#expect(!RoleDraft().isValid && RoleDraft(role).isValid)
		let a = try decodeAgent(agentJSON().replacingOccurrences(of: #""role":null"#, with: #""role":"ревьюер""#))
		let b = try decodeAgent(agentJSON(id: "a-2"))
		#expect(RoleUsage.count(role, in: [a, b]) == 1)
	}

	@Test func finishedStates() throws {
		#expect(try decodeAgent(agentJSON(status: "idle")).isFinished)
		#expect(try !decodeAgent(agentJSON(status: "working")).isFinished)
	}
}

@Suite("Служба и плагин")
struct InstallerTests {
	func tmp() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("inst-\(UUID().uuidString)") }

	@Test func buildVersionsCompareNumerically() {
		#expect(BuildVersion.compare("1.0.232.2610151700", "1.0.231.2610160000") == 1)
		#expect(BuildVersion.compare("1.0.9.1", "1.0.10.1") == -1, "не по строкам")
		#expect(BuildVersion.compare("1.0.5.1", "1.0.5.1") == 0)
		#expect(BuildVersion.compare(nil, "1.0.1.1") == -1 && BuildVersion.compare("1.0.1.1", nil) == 1)
		#expect(BuildVersion.compare("мусор", "1.0.0.1") == -1)
		#expect(BuildVersion.parse("1.0.2") == [1, 0, 2] && BuildVersion.parse("1") == nil)
	}

	@Test func serviceIsBundledOnlyWithCli() throws {
		let root = tmp()
		defer { try? FileManager.default.removeItem(at: root) }
		let bundle = root.appendingPathComponent("App/Resources/orch")
		try FileManager.default.createDirectory(at: bundle.appendingPathComponent("bin"), withIntermediateDirectories: true)
		FileManager.default.createFile(atPath: bundle.appendingPathComponent("bin/nessy-orch").path, contents: Data())
		#expect(ServiceInstaller(bundleRoot: bundle, home: root).isBundled)
		#expect(!ServiceInstaller(bundleRoot: nil, home: root).isBundled)
	}

	func makePlugin(_ dir: URL, version: String) throws {
		try FileManager.default.createDirectory(at: dir.appendingPathComponent(".claude-plugin"), withIntermediateDirectories: true)
		try FileManager.default.createDirectory(at: dir.appendingPathComponent("bin"), withIntermediateDirectories: true)
		try FileManager.default.createDirectory(at: dir.appendingPathComponent("skills/nessy-orch"), withIntermediateDirectories: true)
		try #"{"name":"nessy","version":"\#(version)"}"#.write(to: dir.appendingPathComponent(".claude-plugin/plugin.json"), atomically: true, encoding: .utf8)
		try "---\nname: nessy-orch\n---\n".write(to: dir.appendingPathComponent("skills/nessy-orch/SKILL.md"), atomically: true, encoding: .utf8)
		let cli = dir.appendingPathComponent("bin/nessy-orch")
		try "#!/usr/bin/env node\n".write(to: cli, atomically: true, encoding: .utf8)
		try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)
	}

	@Test func pluginInstallUpdateUninstall() throws {
		let root = tmp()
		defer { try? FileManager.default.removeItem(at: root) }
		let src = root.appendingPathComponent("app/plugin")
		try makePlugin(src, version: "1.0.1.1")
		let inst = PluginInstaller(source: src, root: root.appendingPathComponent("skills"))
		#expect(inst.state() == .missing)
		try inst.install()
		#expect(inst.state() == .upToDate)
		#expect(inst.destination?.lastPathComponent == "nessy")
		#expect(FileManager.default.isExecutableFile(atPath: inst.destination!.appendingPathComponent("bin/nessy-orch").path), "права на CLI сохраняются")
		try makePlugin(src, version: "1.0.2.1")
		#expect(inst.state() == .outdated(installed: "1.0.1.1"))
		try inst.install()
		#expect(inst.state() == .upToDate)
		// запущена старая копия приложения: установленная новее встроенной — не откатываем
		try makePlugin(src, version: "1.0.1.1")
		#expect(inst.state() == .upToDate, "новее не затираем")
		try makePlugin(src, version: "1.0.2.1")
		// повреждённая копия (нет скилла) — не «актуальна»
		try FileManager.default.removeItem(at: inst.destination!.appendingPathComponent("skills/nessy-orch/SKILL.md"))
		#expect(inst.state() == .outdated(installed: "1.0.2.1"))
		try inst.uninstall()
		#expect(inst.state() == .missing)
		#expect(PluginInstaller(source: nil, root: root).state() == .notBundled)
	}
}

@Suite("Сводка вызовов инструментов")
struct ToolSummaryTests {
	func tool(_ name: String, _ seq: Int = 0) -> AgentEvent.ToolEvent {
		AgentEvent.ToolEvent(seq: seq, ts: 0, toolId: "t\(seq)", name: name, title: name, input: [:], status: .completed, output: nil, endedTs: 1)
	}

	@Test func summaryCountsByKind() {
		let t = [tool("Bash", 1), tool("Bash", 2), tool("Bash", 3), tool("Read", 4), tool("Read", 5), tool("Edit", 6), tool("Grep", 7)]
		#expect(ToolSummary.text(t) == "Запустил 3 команды · прочитал 2 файла · изменил 1 файл · поискал 1 раз")
		#expect(ToolSummary.text([tool("Bash")]) == "Запустил 1 команду")
		#expect(ToolSummary.text([tool("TodoWrite"), tool("Think")]) == "2 вызова", "служебные вызовы не считаются видами")
		#expect(ToolSummary.text([tool("custom_mcp_tool"), tool("custom_mcp_tool", 1)]) == "Вызвал 2 инструмента")
	}

	@Test func kindsAndSymbols() {
		#expect(ToolKind.of(name: "Write") == .edit)
		#expect(ToolKind.of(name: "WebSearch") == .web)
		#expect(ToolKind.command.symbol == "terminal")
	}
}

@Suite("Устойчивый разбор снимка")
struct LossySnapshotTests {
	@Test func brokenRecordIsSkippedNotTheWholeSnapshot() throws {
		let json = """
		{"t":"snapshot","rev":3,"spaces":[],"roles":[],"messages":[],
		 "sessions":[{"id":"s1","title":"T","owner":null,"status":"active","summary":null,"createdAt":"a","updatedAt":"b","sources":0},{"id":5}],
		 "agents":[{"id":"a1"}]}
		"""
		let e = StreamEvent.decode(Data(json.utf8))
		guard case .snapshot(let s) = e else { Issue.record("снимок не разобран"); return }
		#expect(s.sessions.map(\.id) == ["s1"])
		#expect(s.agents.isEmpty, "запись без обязательных полей пропущена")
		#expect(s.skipped == 2)
	}
}

@Suite("Ссылки на код")
struct CodeLocationTests {
	@Test func parsesLabels() {
		#expect(CodeLocation.parse("src/app.ts:42") == CodeLocation(path: "src/app.ts", line: 42))
		#expect(CodeLocation.parse("repo@abc123:src/app.ts:7:3") == CodeLocation(path: "src/app.ts", line: 7))
		#expect(CodeLocation.parse("README.md") == CodeLocation(path: "README.md", line: nil))
		#expect(CodeLocation.parse("  /abs/x.swift:1 ") == CodeLocation(path: "/abs/x.swift", line: 1))
	}

	@Test func resolvesInsideProjectAndAbove() throws {
		let root = FileManager.default.temporaryDirectory.appendingPathComponent("loc-\(UUID().uuidString)")
		let sub = root.appendingPathComponent("a/b")
		try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
		try "x".write(to: root.appendingPathComponent("a/file.txt"), atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: root) }
		#expect(CodeLocation(path: "file.txt").resolved(in: sub.path) == nil || CodeLocation(path: "a/file.txt").resolved(in: sub.path) != nil)
		#expect(CodeLocation(path: "a/file.txt").resolved(in: sub.path) == root.appendingPathComponent("a/file.txt").path, "поиск идёт вверх от каталога проекта")
		#expect(CodeLocation(path: "нет.txt").resolved(in: sub.path) == nil)
		#expect(CodeLocation(path: root.appendingPathComponent("a/file.txt").path).resolved(in: "/nowhere") != nil)
	}

	@Test func editorUrls() {
		#expect(CodeEditor.vscode.url(path: "/p/a b.ts", line: 12)?.absoluteString == "vscode://file/p/a%20b.ts:12")
		#expect(CodeEditor.zed.url(path: "/p/x.rs", line: nil)?.absoluteString == "zed://file/p/x.rs")
	}
}

@Suite("Заголовок агента")
struct AgentTitleTests {
	@MainActor @Test func titleComesFromOrchestratorThenGoal() throws {
		let store = OrchStore(client: OrchClient(baseURL: URL(string: "http://127.0.0.1:1")!))
		var a = try decodeAgent(agentJSON(id: "a-1", status: "idle"))
		#expect(a.title == nil)
		#expect(store.title(of: a) == a.displayName ?? a.name, "без заголовка и поручения — имя")
		a.title = "Проверка MR !512"
		#expect(store.title(of: a) == "Проверка MR !512")
		let json = #"{"id":"a-2","name":"reviewer-2","title":"Причина падения CI","space":"s","parent":"you","status":"idle","archived":false,"createdAt":"x","lastActivityAt":"x","queued":0,"preview":"","pendingPermissions":[],"turnSteps":0}"#
		#expect(try JSONDecoder().decode(AgentView.self, from: Data(json.utf8)).title == "Причина падения CI")
	}
}
