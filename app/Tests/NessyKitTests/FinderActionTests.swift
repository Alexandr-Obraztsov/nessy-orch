import Foundation
import Testing
@testable import NessyKit

@Suite struct FinderActionTests {
	private func tempHome() -> URL {
		let u = FileManager.default.temporaryDirectory.appendingPathComponent("finder-\(UUID().uuidString)")
		try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
		return u
	}

	@Test func installWritesValidServiceBundle() throws {
		let home = tempHome()
		defer { try? FileManager.default.removeItem(at: home) }
		#expect(!FinderAction.isInstalled(home: home))
		#expect(try FinderAction.install(bundleId: "com.test.app", home: home))
		#expect(FinderAction.isInstalled(home: home))
		let info = try Data(contentsOf: FinderAction.bundleURL(home: home).appendingPathComponent("Contents/Info.plist"))
		let plist = try #require(try PropertyListSerialization.propertyList(from: info, format: nil) as? [String: Any])
		let services = try #require(plist["NSServices"] as? [[String: Any]])
		#expect(services.first?["NSMessage"] as? String == "runWorkflowAsService")
		let wf = try Data(contentsOf: FinderAction.bundleURL(home: home).appendingPathComponent("Contents/document.wflow"))
		let w = try #require(try PropertyListSerialization.propertyList(from: wf, format: nil) as? [String: Any])
		let text = String(decoding: wf, as: UTF8.self)
		#expect(text.contains("open -b com.test.app"))
		#expect((w["actions"] as? [Any])?.count == 1)
	}

	@Test func secondInstallIsNoop_uninstallRemoves() throws {
		let home = tempHome()
		defer { try? FileManager.default.removeItem(at: home) }
		_ = try FinderAction.install(bundleId: "com.test.app", home: home)
		#expect(try !FinderAction.install(bundleId: "com.test.app", home: home))
		try FinderAction.uninstall(home: home)
		#expect(!FinderAction.isInstalled(home: home))
	}
}
