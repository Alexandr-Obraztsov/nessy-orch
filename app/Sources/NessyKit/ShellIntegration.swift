import Foundation

/// Прозрачные хуки Claude для обычной команды `claude`, набранной в терминале приложения.
/// Оболочка стартует с функцией `claude() { command claude --settings <файл хуков> "$@"; }` (если пользователь сам не передал
/// `--settings`, а файл хуков есть). Файлы пользователя не меняются: zsh читает свои точки входа из `~/.nessy-orch/zdotdir`
/// (они подгружают настоящие `~/.zshenv`, `.zprofile`, `.zshrc`), bash — `--rcfile ~/.nessy-orch/bashrc`, остальные оболочки —
/// обёртка `~/.nessy-orch/bin/claude` в начале PATH.
public enum ShellIntegration {
	public enum Kind: Equatable, Sendable { case zsh, bash, other }

	public static func kind(ofShell path: String) -> Kind {
		switch (path as NSString).lastPathComponent {
		case "zsh": .zsh
		case "bash": .bash
		default: .other
		}
	}

	/// Оболочка пользователя: `$SHELL`, если она существует, иначе zsh.
	public static func userShell(env: [String: String], fm: FileManager = .default) -> String {
		if let s = env["SHELL"], s.hasPrefix("/"), fm.isExecutableFile(atPath: s) { return s }
		return "/bin/zsh"
	}

	// MARK: пути

	public struct Layout: Sendable {
		public let root: URL
		public init(home: URL) { root = home.appendingPathComponent(".nessy-orch") }
		public var hooks: URL { root.appendingPathComponent("claude-hooks.json") }
		public var zdotdir: URL { root.appendingPathComponent("zdotdir") }
		public var bashrc: URL { root.appendingPathComponent("bashrc") }
		public var binDir: URL { root.appendingPathComponent("bin") }
		public var wrapper: URL { binDir.appendingPathComponent("claude") }
	}

	// MARK: тексты скриптов

	/// Функция для zsh и bash. Путь к файлу хуков — в одинарных кавычках (с экранированием).
	public static func claudeFunction(settings: String, plugin: String? = nil) -> String {
		let q = ClaudeHooks.shellQuote(settings)
		let p = pluginArgs(plugin)
		return """
		claude() {
		  if [ -f \(q) ]; then
		    case " $* " in
		      *" --settings "*|*" --settings="*) command claude "$@" ;;
		      *) command claude --settings \(q)\(p) "$@" ;;
		    esac
		  else
		    command claude "$@"
		  fi
		}
		"""
	}

	/// ` --plugin-dir '<путь>'`: плагин nessy со скиллом `nessy-orch` подключается к каждому запуску `claude` из терминала приложения.
	static func pluginArgs(_ plugin: String?) -> String {
		guard let plugin, !plugin.isEmpty else { return "" }
		return " --plugin-dir " + ClaudeHooks.shellQuote(plugin)
	}

	public static func zshenv() -> String { zshSource(".zshenv", header: "# TClaude-Orch: подгружает настоящий ~/.zshenv, файлы пользователя не меняются") }
	public static func zprofile() -> String { zshSource(".zprofile", header: "# TClaude-Orch: подгружает настоящий ~/.zprofile") }

	private static func zshSource(_ file: String, header: String) -> String {
		"""
		\(header)
		_nessy_orig="${NESSY_USER_ZDOTDIR:-$HOME}"
		_nessy_mine="$ZDOTDIR"
		if [[ -r "$_nessy_orig/\(file)" ]]; then
		  ZDOTDIR="$_nessy_orig"
		  source "$_nessy_orig/\(file)"
		  ZDOTDIR="$_nessy_mine"
		fi
		unset _nessy_orig _nessy_mine

		"""
	}

	/// `.zshrc`: возвращает ZDOTDIR пользователю (дальше zsh читает его `.zlogin` сам), подгружает его `.zshrc`, затем определяет `claude`.
	public static func zshrc(settings: String, plugin: String? = nil) -> String {
		"""
		# TClaude-Orch: подгружает настоящий ~/.zshrc и добавляет функцию claude с хуками
		_nessy_orig="${NESSY_USER_ZDOTDIR:-$HOME}"
		_nessy_mine="$ZDOTDIR"
		ZDOTDIR="$_nessy_orig"
		[[ "$HISTFILE" == "$_nessy_mine/.zsh_history" ]] && HISTFILE="$_nessy_orig/.zsh_history"
		[[ -r "$_nessy_orig/.zshrc" ]] && source "$_nessy_orig/.zshrc"
		unset _nessy_orig _nessy_mine
		\(claudeFunction(settings: settings, plugin: plugin))

		"""
	}

	/// Файл для `bash --rcfile`: как login-оболочка (`/etc/profile`, затем первый из `~/.bash_profile`, `~/.bash_login`, `~/.profile`), затем функция.
	public static func bashrc(settings: String, plugin: String? = nil) -> String {
		"""
		# TClaude-Orch: запуск как login-оболочка и функция claude с хуками
		[ -f /etc/profile ] && . /etc/profile
		if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
		elif [ -f "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
		elif [ -f "$HOME/.profile" ]; then . "$HOME/.profile"
		fi
		\(claudeFunction(settings: settings, plugin: plugin))

		"""
	}

	/// Запасной вариант для остальных оболочек: исполняемый `claude` в начале PATH; настоящий ищется в PATH без своей папки.
	public static func wrapper(settings: String, plugin: String? = nil) -> String {
		let q = ClaudeHooks.shellQuote(settings)
		let p = pluginArgs(plugin)
		return """
		#!/bin/sh
		# TClaude-Orch: claude с хуками оркестратора
		self_dir=$(cd "$(dirname "$0")" && pwd)
		PATH=$(printf %s "$PATH" | tr ':' '\\n' | grep -vxF "$self_dir" | paste -sd: -)
		if [ -f \(q) ]; then
		  case " $* " in
		    *" --settings "*|*" --settings="*) exec claude "$@" ;;
		    *) exec claude --settings \(q)\(p) "$@" ;;
		  esac
		fi
		exec claude "$@"

		"""
	}

	// MARK: установка

	public struct File: Equatable, Sendable { public var url: URL; public var text: String; public var executable: Bool }

	public static func files(layout: Layout, plugin: String? = nil) -> [File] {
		let s = layout.hooks.path
		return [
			File(url: layout.zdotdir.appendingPathComponent(".zshenv"), text: zshenv(), executable: false),
			File(url: layout.zdotdir.appendingPathComponent(".zprofile"), text: zprofile(), executable: false),
			File(url: layout.zdotdir.appendingPathComponent(".zshrc"), text: zshrc(settings: s, plugin: plugin), executable: false),
			File(url: layout.bashrc, text: bashrc(settings: s, plugin: plugin), executable: false),
			File(url: layout.wrapper, text: wrapper(settings: s, plugin: plugin), executable: true),
		]
	}

	/// Записать скрипты (только изменившиеся). Файлы пользователя не трогаются.
	public static func install(layout: Layout, plugin: String? = nil) throws {
		let fm = FileManager.default
		for f in files(layout: layout, plugin: plugin) {
			if (try? String(contentsOf: f.url, encoding: .utf8)) == f.text { continue }
			try fm.createDirectory(at: f.url.deletingLastPathComponent(), withIntermediateDirectories: true)
			try f.text.write(to: f.url, atomically: true, encoding: .utf8)
			if f.executable { try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: f.url.path) }
		}
	}

	// MARK: запуск оболочки

	/// Аргументы интерактивной login-оболочки; `command` — выполнить и остаться в оболочке (для проверок).
	public static func arguments(kind: Kind, shell: String, layout: Layout, command: String? = nil) -> [String] {
		let q = ClaudeHooks.shellQuote
		switch kind {
		case .zsh:
			guard let c = command else { return ["-l"] }
			// после команды оболочка запускается заново с тем же ZDOTDIR: `.zshrc` уже вернул его пользователю
			return ["-l", "-i", "-c", "\(c); exec env ZDOTDIR=\(q(layout.zdotdir.path)) \(q(shell)) -l"]
		case .bash:
			let rc = ["--rcfile", layout.bashrc.path, "-i"]
			guard let c = command else { return rc }
			return rc + ["-c", "\(c); exec \(q(shell)) --rcfile \(q(layout.bashrc.path)) -i"]
		case .other:
			guard let c = command else { return ["-l"] }
			return ["-l", "-c", "\(c); exec \(q(shell)) -l"]
		}
	}

	/// Переменные окружения, нужные интеграции.
	public static func environment(kind: Kind, layout: Layout, base: [String: String], home: String) -> [String: String] {
		switch kind {
		case .zsh:
			return ["ZDOTDIR": layout.zdotdir.path, "NESSY_USER_ZDOTDIR": base["ZDOTDIR"].flatMap { $0.isEmpty ? nil : $0 } ?? home]
		case .bash:
			return [:]
		case .other:
			let path = base["PATH"] ?? "/usr/bin:/bin"
			return ["PATH": layout.binDir.path + ":" + path]
		}
	}
}
