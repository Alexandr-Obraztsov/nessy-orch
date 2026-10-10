import SwiftUI
import AppKit
import NessyKit

/// Первичная настройка по шагам: на каждом шаге приложение показывает, что найдено, и предлагает действия; решает пользователь
/// (какую папку выбрать, ставить ли). Сам Claude Code приложение не устанавливает — только находит или принимает путь, который указал пользователь.
/// Скилл `nessy-orch` лежит в приложении и подключается к `claude` из терминала приложения через `--plugin-dir`; копию в свою папку можно сделать на шаге «Скилл».
@MainActor
@Observable
final class SetupModel {
	enum Step: Int, CaseIterable, Identifiable {
		case claude, cli, service, skill, projects
		var id: Int { rawValue }
		var title: String {
			switch self {
			case .claude: "Claude Code"
			case .cli: "Командная строка nessy-orch"
			case .service: "Служба оркестратора"
			case .skill: "Скилл nessy-orch"
			case .projects: "Папка проектов"
			}
		}
		var lead: String {
			switch self {
			case .claude: "Терминал приложения запускает вашу команду `claude`. Приложение его не устанавливает: оно ищет его в PATH или берёт путь, который вы укажете."
			case .cli: "Команда `nessy-orch` нужна Claude, чтобы запускать агентов. Приложение кладёт её в выбранную папку ссылкой на встроенную копию."
			case .service: "Сервер оркестратора работает фоном (launchd) и нужен приложению и CLI. Ему нужен Node.js 20 или новее."
			case .skill: "Скилл учит Claude работать оркестратором. Он лежит в приложении и подключается автоматически в терминале приложения."
			case .projects: "С этой папки начинается выбор проекта при открытии папки."
			}
		}
	}

	var visible = false
	var step: Step = .claude
	var busy = false
	/// строка статуса текущего шага (что найдено / что получилось)
	var status = ""
	var statusOK = true

	private static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
	/// Мастер на запуске показывается только если без него не заработает: нет `claude`, нет Node.js или не установлена/устарела служба оркестратора.
	/// `nessy-orch` и скилл лежат в приложении и подключаются сами (CLI — через PATH терминала, скилл — через `--plugin-dir`), их ставить не нужно.
	static func problemsExist() async -> Bool {
		let cli = CLISupport.shared
		let claudePath = UserDefaults.standard.string(forKey: "claudePath").flatMap { $0.isEmpty ? nil : ClaudeHooks.shellQuote($0) } ?? "claude"
		let claude = await Shell.run("command -v \(claudePath)")
		if claude.status != 0 { return true }
		if cli.isBundled {
			if await cli.ensureNode() == nil { return true }
			if cli.installer.serviceMatchesBundle() != true, case .offline = AppModel.shared.store.daemon { return true }
		}
		return false
	}

	func start() {
		step = .claude
		visible = true
		refresh()
	}

	func next() {
		if let n = Step(rawValue: step.rawValue + 1) { step = n; refresh() } else { finish() }
	}
	func back() { if let p = Step(rawValue: step.rawValue - 1) { step = p; refresh() } }
	var isLast: Bool { step == Step.allCases.last }

	func finish() {
		UserDefaults.standard.set(Self.version, forKey: "setup.done")
		visible = false
	}

	private func report(_ text: String, ok: Bool = true) { status = text; statusOK = ok }

	// MARK: проверка текущего шага

	func refresh() {
		busy = true
		Task {
			defer { busy = false }
			switch step {
			case .claude: await checkClaude()
			case .cli: checkCLI()
			case .service: await checkService()
			case .skill: await checkSkill()
			case .projects: checkProjects()
			}
		}
	}

	private func claudeCommand() -> String {
		if let p = UserDefaults.standard.string(forKey: "claudePath"), !p.isEmpty { return ClaudeHooks.shellQuote(p) }
		return "claude"
	}

	private func checkClaude() async {
		let r = await Shell.run("command -v \(claudeCommand()) && \(claudeCommand()) --version")
		if r.status == 0 {
			let lines = r.output.split(separator: "\n").map(String.init)
			report("Найден: \(lines.first ?? "") · \(lines.last ?? "")")
		} else { report("Не найден. Установите Claude Code сами или укажите путь к команде `claude`.", ok: false) }
	}

	/// Указать, где лежит `claude` (файл).
	func chooseClaude() {
		let p = NSOpenPanel()
		p.canChooseFiles = true
		p.canChooseDirectories = false
		p.message = "Выберите исполняемый файл claude"
		p.directoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/.local/bin")
		p.treatsFilePackagesAsDirectories = true
		guard p.runModal() == .OK, let u = p.url else { return }
		UserDefaults.standard.set(u.path, forKey: "claudePath")
		refresh()
	}
	func forgetClaudePath() { UserDefaults.standard.removeObject(forKey: "claudePath"); refresh() }

	private func checkCLI() {
		let cli = CLISupport.shared
		cli.refresh()
		let place = cli.linkPath.replacingOccurrences(of: NSHomeDirectory(), with: "~")
		switch cli.state {
		case .installed: report("Установлена: \(place)")
		case .missing: report("Не установлена. Будет создана ссылка \(place)", ok: false)
		case .stale: report("Ссылка \(place) ведёт на другое место — её можно обновить.", ok: false)
		case .conflict: report("По пути \(place) лежит обычный файл. Выберите другую папку.", ok: false)
		case .notBundled: report("Сборка без встроенной командной строки (запуск из исходников).", ok: false)
		}
	}

	func installCLI() {
		let cli = CLISupport.shared
		if !cli.installLink() { report(cli.lastError ?? "Не удалось поставить ссылку.", ok: false) } else { checkCLI() }
	}

	func chooseCLIFolder() {
		let p = NSOpenPanel()
		p.canChooseDirectories = true
		p.canChooseFiles = false
		p.canCreateDirectories = true
		p.message = "Папка для команды nessy-orch (она должна быть в PATH)"
		p.directoryURL = CLISupport.shared.installer.linkDirectory
		guard p.runModal() == .OK, let u = p.url else { return }
		CLISupport.shared.moveLink(to: u)
		checkCLI()
		if statusOK { report(status + " Папку нужно добавить в PATH, если её там нет.") }
	}

	private func checkService() async {
		let cli = CLISupport.shared
		let node = await cli.ensureNode()
		guard cli.isBundled else { report("Нет встроенной копии сервера (запуск из исходников).", ok: false); return }
		let nodeText = node.map { "Node.js: \($0)" } ?? "Node.js не найден (нужен ≥ 20: `brew install node`)"
		switch cli.installer.serviceMatchesBundle() {
		case true?: report("Установлена и актуальна. \(nodeText)")
		case false?: report("Установлена со старого места — её можно переустановить. \(nodeText)", ok: false)
		case nil: report("Не установлена. \(nodeText)", ok: false)
		}
	}

	func installService() {
		busy = true
		Task {
			defer { busy = false }
			let cli = CLISupport.shared
			if await cli.installService() { await checkService() } else { report(cli.lastError ?? "Не удалось установить службу.", ok: false) }
		}
	}

	private var pluginDir: URL? { Bundle.main.resourceURL?.appendingPathComponent("orch/plugin") }

	private func checkSkill() async {
		guard let dir = pluginDir else { report("Запуск не из .app (разработка): скилл берётся из репозитория.", ok: false); return }
		let manifest = dir.appendingPathComponent(".claude-plugin/plugin.json")
		let skill = dir.appendingPathComponent("skills/nessy-orch/SKILL.md")
		guard let data = try? Data(contentsOf: manifest), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let name = j["name"] as? String,
			  FileManager.default.fileExists(atPath: skill.path) else { report("В приложении нет плагина nessy — пересоберите приложение.", ok: false); return }
		let version = j["version"] as? String ?? "?"
		let q = ClaudeHooks.shellQuote(dir.path)
		let r = await Shell.run("command -v \(claudeCommand()) >/dev/null && \(claudeCommand()) plugin validate \(q)", timeout: 30)
		if r.status == 0 { report("Плагин \(name) \(version): манифест и скилл на месте, `claude plugin validate` прошёл.") }
		else if r.output.isEmpty { report("Плагин \(name) \(version) на месте (Claude Code не найден, полная проверка недоступна).") }
		else { report("`claude plugin validate`: \(r.output.prefix(200))", ok: false) }
	}

	/// Скопировать скилл в выбранную папку (например, `~/.claude/skills`), чтобы он был виден и вне терминала приложения.
	func copySkill() {
		guard let src = pluginDir?.appendingPathComponent("skills/nessy-orch") else { return }
		let p = NSOpenPanel()
		p.canChooseDirectories = true
		p.canChooseFiles = false
		p.canCreateDirectories = true
		p.message = "Папка скиллов, куда положить nessy-orch (например, ~/.claude/skills)"
		p.directoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/.claude")
		guard p.runModal() == .OK, let u = p.url else { return }
		let dst = u.appendingPathComponent("nessy-orch")
		do {
			if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
			try FileManager.default.copyItem(at: src, to: dst)
			report("Скилл скопирован: \(dst.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))")
		} catch { report("Не удалось скопировать: \(error.localizedDescription)", ok: false) }
	}

	private func checkProjects() {
		let d = UserDefaults.standard.string(forKey: "projectsDirectory") ?? NSHomeDirectory()
		report("Выбор проекта начнётся с \(d.replacingOccurrences(of: NSHomeDirectory(), with: "~")).")
	}

	func chooseProjectsFolder() {
		let p = NSOpenPanel()
		p.canChooseDirectories = true
		p.canChooseFiles = false
		p.message = "Папка, в которой лежат ваши проекты"
		p.directoryURL = URL(fileURLWithPath: UserDefaults.standard.string(forKey: "projectsDirectory") ?? NSHomeDirectory())
		guard p.runModal() == .OK, let u = p.url else { return }
		UserDefaults.standard.set(u.path, forKey: "projectsDirectory")
		checkProjects()
	}
}

/// Команда в login-оболочке пользователя (там же, где живут PATH и node), с ограничением по времени.
enum Shell {
	struct Result: Sendable { var status: Int32; var output: String }

	static func run(_ command: String, timeout: Double = 20) async -> Result {
		await Task.detached {
			let p = Process()
			p.executableURL = URL(fileURLWithPath: "/bin/zsh")
			p.arguments = ["-lc", command]
			let pipe = Pipe()
			p.standardOutput = pipe
			p.standardError = pipe
			do { try p.run() } catch { return Result(status: -1, output: error.localizedDescription) }
			let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
			DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
			let data = pipe.fileHandleForReading.readDataToEndOfFile()
			p.waitUntilExit()
			killer.cancel()
			return Result(status: p.terminationStatus, output: String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
		}.value
	}
}

/// Мастер первичной настройки: один шаг на экране, действия решает пользователь.
struct SetupView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		let s = model.setup
		VStack(alignment: .leading, spacing: DS.Metrics.s4) {
			HStack(spacing: DS.Metrics.s1) {
				ForEach(SetupModel.Step.allCases) { st in
					Capsule().fill(st.rawValue <= s.step.rawValue ? DS.Palette.accent : DS.Palette.hover).frame(height: 3)
				}
			}
			VStack(alignment: .leading, spacing: DS.Metrics.s2) {
				Text(s.step.title).font(DS.Typography.panelTitle)
				Text(s.step.lead).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textSecondary).fixedSize(horizontal: false, vertical: true)
			}
			HStack(alignment: .top, spacing: DS.Metrics.s2) {
				if s.busy { ProgressView().controlSize(.small) }
				else { Image(systemName: s.statusOK ? "checkmark.circle.fill" : "exclamationmark.circle").foregroundStyle(s.statusOK ? DS.Palette.accent : DS.Palette.textSecondary) }
				Text(s.busy ? "Проверяю…" : s.status).font(DS.Typography.secondary).foregroundStyle(DS.Palette.textPrimary).fixedSize(horizontal: false, vertical: true)
				Spacer(minLength: 0)
			}
			.padding(DS.Metrics.s3).frame(maxWidth: .infinity, alignment: .leading).dsGroup()
			actions(s)
			Spacer(minLength: 0)
			HStack {
				if s.step != .claude { Button("Назад") { s.back() } }
				Spacer()
				Button("Пропустить установку") { s.finish() }.buttonStyle(.plain).foregroundStyle(DS.Palette.textTertiary)
				Button(s.isLast ? "Готово" : "Далее") { s.next() }.keyboardShortcut(.defaultAction)
			}
		}
		.padding(DS.Metrics.s5)
		.frame(width: 520, height: 400)
	}

	@ViewBuilder private func actions(_ s: SetupModel) -> some View {
		HStack(spacing: DS.Metrics.s2) {
			switch s.step {
			case .claude:
				Button("Указать путь…") { s.chooseClaude() }
				if UserDefaults.standard.string(forKey: "claudePath") != nil { Button("Искать в PATH") { s.forgetClaudePath() } }
			case .cli:
				Button("Установить") { s.installCLI() }.disabled(s.busy)
				Button("Выбрать папку…") { s.chooseCLIFolder() }
			case .service:
				Button("Установить и запустить") { s.installService() }.disabled(s.busy)
			case .skill:
				Button("Проверить ещё раз") { s.refresh() }
				Button("Скопировать в папку скиллов…") { s.copySkill() }
			case .projects:
				Button("Выбрать папку…") { s.chooseProjectsFolder() }
			}
			Spacer(minLength: 0)
		}
	}
}
