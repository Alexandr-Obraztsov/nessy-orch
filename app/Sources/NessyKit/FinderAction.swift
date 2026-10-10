import Foundation

/// Быстрое действие Finder «Открыть в TClaude-Orch»: пакет `.workflow` в `~/Library/Services` (Automator-служба на папки и файлы,
/// появляется в контекстном меню Finder → «Быстрые действия»). Скрипт открывает папку (для файла — его папку) в приложении по bundle id.
public enum FinderAction {
	public static let name = "Открыть в TClaude-Orch"

	public static func servicesDirectory(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
		home.appendingPathComponent("Library/Services")
	}
	public static func bundleURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
		servicesDirectory(home: home).appendingPathComponent(name + ".workflow")
	}
	public static func isInstalled(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
		FileManager.default.fileExists(atPath: bundleURL(home: home).appendingPathComponent("Contents/document.wflow").path)
	}

	/// Оболочка службы: аргументы — выделенные в Finder объекты.
	static func script(bundleId: String) -> String {
		"""
		for f in "$@"; do
		  if [ -d "$f" ]; then d="$f"; else d="$(dirname "$f")"; fi
		  /usr/bin/open -b \(bundleId) "$d"
		done
		"""
	}

	static func infoPlist() -> [String: Any] {
		[
			"CFBundleName": name,
			"CFBundleIdentifier": "com.nessy.orch.finder-action",
			"NSServices": [[
				"NSMenuItem": ["default": name],
				"NSMessage": "runWorkflowAsService",
				"NSRequiredContext": ["NSApplicationIdentifier": "com.apple.finder"],
				"NSSendFileTypes": ["public.item"],
			]],
		]
	}

	static func workflowPlist(bundleId: String) -> [String: Any] {
		let action: [String: Any] = [
			"action": [
				"AMAccepts": ["Container": "List", "Optional": true, "Types": ["com.apple.cocoa.string"]],
				"AMActionVersion": "2.0.3",
				"AMApplication": ["Automator"],
				"AMParameterProperties": [
					"COMMAND_STRING": [String: Any](), "CheckedForUserDefaultShell": [String: Any](), "inputMethod": [String: Any](),
					"shell": [String: Any](), "source": [String: Any](),
				],
				"AMProvides": ["Container": "List", "Types": ["com.apple.cocoa.string"]],
				"ActionBundlePath": "/System/Library/Automator/Run Shell Script.action",
				"ActionName": "Run Shell Script",
				"ActionParameters": [
					"COMMAND_STRING": script(bundleId: bundleId),
					"CheckedForUserDefaultShell": true,
					"inputMethod": 1,
					"shell": "/bin/zsh",
					"source": "",
				],
				"BundleIdentifier": "com.apple.RunShellScript",
				"CFBundleVersion": "2.0.3",
				"CanShowSelectedItemsWhenRun": false,
				"CanShowWhenRun": true,
				"Category": ["AMCategoryUtilities"],
				"Class Name": "RunShellScriptAction",
				"InputUUID": "6E2A7C4E-0F7B-4B8E-9C61-5B5E3D7A1001",
				"Keywords": ["Shell", "Script", "Command", "Run", "Unix"],
				"OutputUUID": "6E2A7C4E-0F7B-4B8E-9C61-5B5E3D7A1002",
				"UUID": "6E2A7C4E-0F7B-4B8E-9C61-5B5E3D7A1003",
				"UnlocalizedApplications": ["Automator"],
				"arguments": [String: Any](),
				"isViewVisible": 1,
				"location": "309.000000:253.000000",
				"nibPath": "/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib",
			] as [String: Any],
		]
		return [
			"AMApplicationBuild": "523",
			"AMApplicationVersion": "2.10",
			"AMDocumentVersion": "2",
			"actions": [action],
			"connectors": [String: Any](),
			"workflowMetaData": [
				"applicationBundleIDsByPath": [String: Any](),
				"applicationPaths": [String](),
				"inputTypeIdentifier": "com.apple.Automator.fileSystemObject",
				"outputTypeIdentifier": "com.apple.Automator.nothing",
				"presentationMode": 15,
				"processesInput": false,
				"serviceApplicationBundleID": "com.apple.finder",
				"serviceInputTypeIdentifier": "com.apple.Automator.fileSystemObject",
				"serviceOutputTypeIdentifier": "com.apple.Automator.nothing",
				"serviceProcessesInput": false,
				"systemImageName": "NSActionTemplate",
				"useAutomaticInputType": false,
				"workflowTypeIdentifier": "com.apple.Automator.servicesMenu",
			] as [String: Any],
		]
	}

	/// Записать (или обновить) пакет службы. Возвращает true, если файлы изменились.
	@discardableResult
	public static func install(bundleId: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> Bool {
		let contents = bundleURL(home: home).appendingPathComponent("Contents")
		try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
		var changed = false
		for (file, plist) in [("Info.plist", infoPlist()), ("document.wflow", workflowPlist(bundleId: bundleId))] as [(String, [String: Any])] {
			let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
			let url = contents.appendingPathComponent(file)
			if (try? Data(contentsOf: url)) != data { try data.write(to: url, options: .atomic); changed = true }
		}
		return changed
	}

	public static func uninstall(home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
		let url = bundleURL(home: home)
		if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
	}
}
