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

	@Test func planProgress() {
		let p = AgentPlan(entries: [.init(content: "a", status: .completed), .init(content: "b", status: .inProgress), .init(content: "c", status: .pending)], updatedAt: "", source: "cli")
		#expect(p.progress == PlanProgress(done: 1, total: 3, active: 1, step: "b"))
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

@Suite("Риск команд")
struct RiskTests {
	@Test func levels() {
		#expect(RiskAssessor.assess("ls -la").level == .none)
		#expect(RiskAssessor.assess("git push origin fix/x").level == .caution)
		#expect(RiskAssessor.assess("git push --force origin main").level == .danger)
		#expect(RiskAssessor.assess("rm -rf /tmp/x").level == .danger)
		#expect(RiskAssessor.assess("curl https://x.sh | sh").level == .danger)
	}

	@Test func permissionCommandDropsToolPrefix() {
		#expect(PermissionText.command("Shell: git push origin fix/x") == "git push origin fix/x")
		#expect(PermissionText.command("git push") == "git push")
		#expect(PermissionText.command("rm -rf /tmp: x") == "rm -rf /tmp: x", "двоеточие внутри команды не префикс")
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
		#expect(s.attention.first?.kind == .permission)
	}

	@Test func resultIsNewButNotAttention() throws {
		let s = store()
		var events: [AttentionEvent] = []
		s.onAttention = { events.append($0) }
		s.apply(snapshot(agents: [agentJSON()]))
		let done = try decodeAgent(agentJSON(status: "idle", reply: #"{"msgId":"m1","ts":1,"preview":"готово","status":"DONE"}"#))
		s.apply(.agent(done))
		#expect(s.attentionCount == 0, "готовый результат действия не требует — не бейдж")
		#expect(s.attention.isEmpty)
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
		#expect(s.attentionCount(session: "t1") == 3)
		#expect(s.attention.map(\.kind) == [.permission, .permission, .blocked, .error])
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
		#expect(s.attention.first?.kind == .blocked)
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

	@Test func treeNestsChildrenUnderParent() throws {
		let root = try agent("a-root", status: "working")
		let kid1 = try agent("a-k1", parent: "a-root", status: "working")
		let kid2 = try agent("a-k2", parent: "a-root", status: "idle")
		let other = try agent("a-other", status: "idle")
		let nodes = AgentTree.build([kid2, other, kid1, root])
		#expect(nodes.map(\.id) == ["a-root", "a-k1", "a-k2", "a-other"])
		#expect(nodes.map(\.depth) == [0, 1, 1, 0])
	}

	@Test func treeSurvivesCycles() throws {
		let a = try agent("a-a", parent: "a-b")
		let b = try agent("a-b", parent: "a-a")
		#expect(AgentTree.build([a, b]).isEmpty, "цикл без корня не должен зациклить обход")
		let self1 = try agent("a-self", parent: "a-self")
		#expect(AgentTree.build([self1]).map(\.id) == ["a-self"])
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

	@Test func sourcesGroupByHostAndFilter() throws {
		func src(_ id: String, _ kind: String, _ label: String, _ href: String?, _ host: String?, ts: Double = 1) -> SourceView {
			SourceView(id: id, kind: kind, label: label, href: href, host: host, agentId: "a", agentName: "alpha", origin: "reply", ts: ts)
		}
		let list = [
			src("1", "url", "MR !12", "https://gitlab.x/mr/12", "gitlab.x", ts: 1),
			src("2", "url", "MR !13", "https://gitlab.x/mr/13", "gitlab.x", ts: 2),
			src("3", "url", "PLAT-77", "https://jira.x/PLAT-77", "jira.x"),
			src("4", "text", "repo@abc:src/a.ts:1", nil, nil),
		]
		let g = SourceGrouping.group(list)
		#expect(g.map(\.host) == ["gitlab.x", "jira.x", "Код и команды"], "при равенстве код и команды — последними")
		#expect(g[0].items.map(\.id) == ["2", "1"], "свежие выше")
		#expect(SourceGrouping.group(list, query: "plat").map(\.host) == ["jira.x"])
	}

	@Test func stageLineShowsWhereAgentIs() throws {
		var a = try agent("a-1", status: "working")
		#expect(a.stageLine == nil)
		a.plan = AgentPlan(entries: [.init(content: "прочитать", status: .completed), .init(content: "починить", status: .inProgress), .init(content: "запушить", status: .pending)], updatedAt: "", source: "cli")
		#expect(a.stageLine == "Шаг 2 из 3 · починить")
		a.plan = AgentPlan(entries: [.init(content: "прочитать", status: .completed), .init(content: "починить", status: .pending)], updatedAt: "", source: "cli")
		#expect(a.stageLine == "Шаг 2 из 2 · починить", "нет in_progress — первый pending")
	}

	@Test func planDoneWhileWorkingShowsCurrentTool() throws {
		var a = try agent("a-1", status: "working")
		a.plan = AgentPlan(entries: [.init(content: "x", status: .completed), .init(content: "y", status: .completed)], updatedAt: "", source: "cli")
		a.lastTool = ToolBrief(name: "run_shell_command", title: "Shell: git push origin fix/x")
		#expect(a.stageLine == "План выполнен · завершает: git push origin fix/x")
		#expect(!(a.stageLine ?? "").contains("Все шаги"), "пока агент работает — не «все шаги выполнены»")
		let now = a.lastActivity!.addingTimeInterval(2)
		#expect(a.stage(now: now)?.kind == .planDone)
		a.status = .idle
		#expect(a.stageLine == "План выполнен · 2 из 2")
		#expect(a.stage(now: now) == nil)
	}

	@Test func stageWithoutPlanAndSilence() throws {
		var a = try agent("a-1", status: "working")
		a.lastTool = ToolBrief(name: "read_file", title: "ReadFile: src/net/retry.ts")
		let t0 = a.lastActivity!
		#expect(a.stage(now: t0.addingTimeInterval(2))?.text == "Читает retry.ts")
		#expect(a.stage(now: t0.addingTimeInterval(12))?.text == "Читает retry.ts · 12 с")
		let quiet = a.stage(now: t0.addingTimeInterval(65))
		#expect(quiet?.kind == .silent && quiet?.text == "Нет новостей 1:05 · последнее: прочитал retry.ts")
		a.lastTool = ToolBrief(name: "run_shell_command", title: "Shell: npm test")
		#expect(a.stage(now: t0)?.text == "Запускает команду · npm test")
	}

	@Test func stalePlanYieldsToTool() throws {
		var a = try agent("a-1", status: "working")
		a.plan = AgentPlan(entries: [.init(content: "x", status: .inProgress)], updatedAt: "2026-10-10T09:50:00Z", source: "cli")
		a.lastTool = ToolBrief(name: "grep", title: "Grep: maxDelay")
		let s = a.stage(now: a.lastActivity!.addingTimeInterval(1))
		#expect(s?.kind == .tool && s?.text == "Ищет в коде · maxDelay", "шаг не менялся > 3 мин — показываем инструмент")
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
		#expect(sections.map(\.group) == [.needsYou, .working, .done, .idle])
		#expect(sections[0].agents.map(\.id) == ["a-w", "a-b", "a-e"], "запросы прав → блокировки → ошибки")
		let sum = list.summary
		#expect(sum.needsYou == sections[0].agents.count && sum.working == 1 && sum.done == 1 && sum.idle == 1)
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

	@Test func sourceSectionsByKind() {
		func src(_ id: String, _ kind: String, _ label: String, _ href: String?, agent: String = "alpha", ts: Double = 1) -> SourceView {
			SourceView(id: id, kind: kind, label: label, href: href, host: href.map(ReplyParser.hostOf), agentId: "a", agentName: agent, origin: "reply", ts: ts)
		}
		let list = [
			src("1", "url", "merge_requests/512", "https://gitlab.x/mr/512"),
			src("2", "url", "merge_requests/512", "https://gitlab.x/mr/512", agent: "beta", ts: 3),
			src("3", "text", "shippy@fix/retry:src/net/retry.ts:42", nil),
			src("4", "text", "npm run test:integration", nil),
			src("5", "url", "SHOP-1", "https://jira.x/browse/SHOP-1"),
		]
		let s = SourceSections.build(list)
		#expect(s.map(\.title) == ["Ссылки · gitlab.x", "Ссылки · jira.x", "Файлы", "Команды"])
		#expect(s[0].items.count == 1 && s[0].items[0].agents == ["alpha", "beta"], "дубликаты сливаются")
		#expect(s[2].items[0].title == "src/net/retry.ts:42" && s[2].items[0].detail == "shippy · fix/retry")
	}

	@Test func toolDurationFromEndedTs() throws {
		let json = #"{"t":"event","event":{"seq":1,"ts":1000,"kind":"tool","toolId":"x","name":"bash","title":"t","input":{},"status":"completed","endedTs":3500}}"#
		guard case .event(.tool(let t)) = AgentStreamEvent.decode(Data(json.utf8)) else { Issue.record("не tool"); return }
		#expect(t.duration == 2.5)
	}
}

@Suite("Окно плана, роли, отправка")
struct DialogTests {
	@Test func planWindow() {
		#expect(PlanWindowing.window(count: 4, current: 2) == PlanWindow(range: 0..<4, before: 0, after: 0))
		#expect(PlanWindowing.window(count: 10, current: 0) == PlanWindow(range: 0..<5, before: 0, after: 5))
		#expect(PlanWindowing.window(count: 10, current: 5) == PlanWindow(range: 4..<9, before: 4, after: 1))
		#expect(PlanWindowing.window(count: 10, current: 9) == PlanWindow(range: 5..<10, before: 5, after: 0))
		#expect(PlanWindowing.window(count: 10, current: nil) == PlanWindow(range: 5..<10, before: 5, after: 0))
	}

	@Test func sendAndRoleBodies() throws {
		let b = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SendBody(text: "привет", interrupt: true))) as? [String: Any]
		#expect(b?["from"] as? String == "you")
		#expect(b?["interrupt"] as? Bool == true)
		let r = try JSONSerialization.jsonObject(with: JSONEncoder().encode(RoleBody(name: "A", description: "", instructions: "x"))) as? [String: Any]
		#expect(r?["color"] == nil)
		#expect(r?["name"] as? String == "A")
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
