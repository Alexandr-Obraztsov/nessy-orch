import Foundation
import Testing
@testable import NessyKit

@Suite("Рантайм")
struct RuntimeTests {
	func agent(_ id: String, runtime: String?, space: String = "main") throws -> AgentView {
		var s = agentJSON(id: id)
		if let runtime { s = s.replacingOccurrences(of: "\"space\":\"main\"", with: "\"space\":\"\(space)\",\"runtime\":\"\(runtime)\"") }
		else { s = s.replacingOccurrences(of: "\"space\":\"main\"", with: "\"space\":\"\(space)\"") }
		return try decodeAgent(s)
	}

	@Test func names() {
		#expect(RuntimeLogic.name("nessy-sdk") == "nessy")
		#expect(RuntimeLogic.name("tclaude") == "Claude Code")
		#expect(RuntimeLogic.name(nil) == "nessy")
		#expect(RuntimeLogic.name("") == "nessy")
		#expect(RuntimeLogic.name("foo") == "foo")
	}

	@Test func shortModel() {
		#expect(RuntimeLogic.shortModel("claude-sonnet-4-5-20250929") == "sonnet 4.5")
		#expect(RuntimeLogic.shortModel("anthropic/claude-opus-4-1") == "opus 4.1")
		#expect(RuntimeLogic.shortModel("claude-3-5-haiku-20241022") == "haiku 3.5")
		#expect(RuntimeLogic.shortModel("sonnet") == "sonnet")
		#expect(RuntimeLogic.shortModel("gpt-5-20260101") == "gpt-5")
		#expect(RuntimeLogic.shortModel("  ") == nil)
		#expect(RuntimeLogic.shortModel(nil) == nil)
	}

	@Test func filterAndIds() throws {
		let a = try agent("a1", runtime: nil)
		let b = try agent("a2", runtime: "tclaude")
		let c = try agent("a3", runtime: "nessy-sdk")
		#expect(RuntimeLogic.ids(in: [b, a, c]) == ["nessy-sdk", "tclaude"])
		#expect(RuntimeLogic.ids(in: [a, c]) == ["nessy-sdk"])
		#expect(RuntimeLogic.filter([a, b, c], runtime: nil).count == 3)
		#expect(RuntimeLogic.filter([a, b, c], runtime: "tclaude").map(\.id) == ["a2"])
		#expect(RuntimeLogic.filter([a, b, c], runtime: "nessy-sdk").map(\.id) == ["a1", "a3"])
	}

	@Test func agentFallsBackToSpaceRuntime() throws {
		let space = try JSONDecoder().decode(SpaceView.self, from: Data(#"{"name":"web","path":"/w","color":1,"mode":"managed","url":null,"status":"ready","error":null,"runtime":"tclaude"}"#.utf8))
		let a = try agent("a1", runtime: nil, space: "web")
		#expect(RuntimeLogic.id(of: a, spaces: [space]) == "tclaude")
		#expect(RuntimeLogic.id(of: a, spaces: []) == "nessy-sdk")
	}

	@Test func apiErrors() {
		let m = APIError(status: 409, code: "runtime_mismatch", message: "пространство «x» работает на tclaude, а не на nessy-sdk")
		#expect(m.localizedDescription == "Рантайм не совпадает: пространство «x» работает на Claude Code, а не на nessy")
		let b = APIError(status: 400, code: "bad_request", message: "runtime — одно из: nessy-sdk, tclaude")
		#expect(b.localizedDescription.hasPrefix("Неверный рантайм: "))
		let o = APIError(status: 404, code: "not_found", message: "нет такого")
		#expect(o.localizedDescription == "нет такого")
	}

	// MARK: модели

	@Test func oldSnapshotsDecode() throws {
		let a = try agent("a1", runtime: nil)
		#expect(a.modelConfirmed == nil && a.modelRequested == nil)
		let r = try JSONDecoder().decode(RoleView.self, from: Data(#"{"id":"r","name":"R","description":"","instructions":"x","color":0,"createdAt":"","updatedAt":""}"#.utf8))
		#expect(r.model == nil && r.runtime == nil)
		let r2 = try JSONDecoder().decode(RoleView.self, from: Data(#"{"id":"r","name":"R","description":"","instructions":"x","color":0,"model":"sonnet","runtime":"tclaude","createdAt":"","updatedAt":""}"#.utf8))
		#expect(r2.model == "sonnet" && r2.runtime == "tclaude")
	}

	@Test func newAgentFields() throws {
		let s = agentJSON(id: "a1").replacingOccurrences(of: "\"space\":\"main\"", with: "\"space\":\"main\",\"model\":\"claude-sonnet-4-5\",\"modelConfirmed\":false,\"modelRequested\":\"opus\"")
		let a = try decodeAgent(s)
		#expect(a.modelConfirmed == false && a.modelRequested == "opus")
	}

	@Test func runtimeInfoDecodesSoftly() throws {
		let full = try JSONDecoder().decode(RuntimeInfo.self, from: Data(#"{"id":"tclaude","label":"Claude Code","defaultModel":null,"models":[{"id":"opus","label":"Opus"}],"capabilities":{"setModel":true,"midTurn":true,"permissionVote":false,"streamText":true},"available":true}"#.utf8))
		#expect(full.capabilities.setModel && full.models.map(\.id) == ["opus"] && full.defaultModel == nil)
		let bare = try JSONDecoder().decode(RuntimeInfo.self, from: Data(#"{"id":"x"}"#.utf8))
		#expect(bare.label == "x" && bare.models.isEmpty && !bare.capabilities.setModel && bare.available)
	}

	@Test func captionPriority() throws {
		var a = try agent("a1", runtime: nil)
		#expect(RuntimeLogic.modelCaption(a) == nil)
		a.model = "claude-opus-4-1-20250805"
		#expect(RuntimeLogic.modelCaption(a)?.text == "opus 4.1" && RuntimeLogic.modelCaption(a)?.requested == nil)
		a.modelConfirmed = true
		#expect(RuntimeLogic.modelCaption(a)?.requested == nil)
		a.modelConfirmed = false
		#expect(RuntimeLogic.modelCaption(a)?.requested == "opus 4.1")
		a.modelRequested = "claude-sonnet-4-5"
		let c = RuntimeLogic.modelCaption(a)
		#expect(c?.text == "opus 4.1" && c?.requested == "sonnet 4.5")
		a.model = "sonnet"; a.modelRequested = "sonnet"; a.modelConfirmed = true
		#expect(RuntimeLogic.modelCaption(a)?.requested == nil)
	}

	@Test func menuOptions() {
		let info = RuntimeInfo(id: "tclaude", label: "Claude Code", models: [RuntimeModel(id: "opus", label: "Opus"), RuntimeModel(id: "opus", label: "Opus again"), RuntimeModel(id: "sonnet", label: "Sonnet"), RuntimeModel(id: "", label: "")], capabilities: RuntimeCapabilities(setModel: true))
		#expect(RuntimeLogic.modelOptions(info).map(\.id) == ["opus", "sonnet"])
		#expect(RuntimeLogic.modelOptions(info, current: "haiku").map(\.id) == ["haiku", "opus", "sonnet"])
		#expect(RuntimeLogic.modelOptions(info, current: "sonnet").map(\.id) == ["opus", "sonnet"])
		#expect(RuntimeLogic.modelOptions(nil).isEmpty)
		#expect(RuntimeLogic.isSelected(RuntimeModel(id: "sonnet", label: "S"), current: "claude-sonnet-4-5") == false)
		#expect(RuntimeLogic.isSelected(RuntimeModel(id: "sonnet", label: "S"), current: "sonnet"))
		#expect(RuntimeLogic.isSelected(RuntimeModel(id: "claude-opus-4-1", label: "O"), current: "opus-4-1-20250805"))
		#expect(!RuntimeLogic.isSelected(RuntimeModel(id: "opus", label: "O"), current: nil))
	}

	@Test func switchAvailability() throws {
		var a = try agent("a1", runtime: nil)
		let can = RuntimeInfo(id: "nessy-sdk", label: "n", models: [RuntimeModel(id: "opus", label: "Opus")], capabilities: RuntimeCapabilities(setModel: true))
		let no = RuntimeInfo(id: "nessy-sdk", label: "n", models: [RuntimeModel(id: "opus", label: "Opus")])
		#expect(RuntimeLogic.canSwitchModel(a, runtime: can))
		#expect(!RuntimeLogic.canSwitchModel(a, runtime: no))
		#expect(!RuntimeLogic.canSwitchModel(a, runtime: nil))
		a.queued = 1
		#expect(!RuntimeLogic.canSwitchModel(a, runtime: can) && RuntimeLogic.supportsModelSwitch(can))
		a.queued = 0; a.status = .working
		#expect(!RuntimeLogic.canSwitchModel(a, runtime: can))
		#expect(RuntimeLogic.info(nil, in: [can])?.id == "nessy-sdk")
	}

	@Test func modelErrors() {
		#expect(RuntimeLogic.apiMessage(status: 409, code: "model_switch_unsupported", message: "x").contains("не умеет"))
		#expect(RuntimeLogic.apiMessage(status: 409, code: "busy", message: "x").contains("занят"))
		#expect(RuntimeLogic.apiMessage(status: 502, code: "model_switch_failed", message: "нет такой").hasSuffix("нет такой"))
	}

	@Test func roleDraftModel() throws {
		var d = RoleDraft()
		d.name = "n"; d.instructions = "i"
		let r = try JSONDecoder().decode(RoleView.self, from: Data(#"{"id":"r","name":"n","description":"","instructions":"i","color":0,"icon":"person.crop.circle","createdAt":"","updatedAt":""}"#.utf8))
		#expect(!d.isChanged(from: r))
		d.model = " opus "
		#expect(d.isChanged(from: r) && d.trimmed.model == "opus")
		#expect(RuntimeLogic.roleModelLabel(nil) == "по умолчанию")
	}
}
