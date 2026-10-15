import Foundation
import Testing
@testable import NessyKit

struct RolePackageFilesTests {
	func root() throws -> URL {
		let r = FileManager.default.temporaryDirectory.appendingPathComponent("rpf-\(UUID().uuidString)")
		try FileManager.default.createDirectory(at: r, withIntermediateDirectories: true)
		return r
	}

	@Test func createsEditsListsAndDeletes() throws {
		let r = try root()
		defer { try? FileManager.default.removeItem(at: r) }
		let f = RolePackageFiles(root: r)
		#expect(f.list().isEmpty)
		let e = try f.create("scripts/run.sh")
		#expect(e.isExecutable && e.path == "scripts/run.sh", "скрипт запускаемый, первая строка — shebang")
		#expect(try f.read("scripts/run.sh") == "#!/bin/sh\n")
		try f.write("scripts/run.sh", "#!/bin/sh\necho ok\n")
		#expect(f.list().first { $0.path == "scripts/run.sh" }?.isExecutable == true, "права при правке сохраняются")
		try f.create("assets/note.md", content: "# Заметка\n")
		#expect(f.list().map(\.path) == ["assets/note.md", "scripts/run.sh"])
		#expect(f.list().first?.folder == "assets" && f.list().first?.name == "note.md")
		#expect(throws: RolePackageFiles.FileError.exists) { try f.create("assets/note.md") }
		try f.delete("assets/note.md")
		#expect(!FileManager.default.fileExists(atPath: r.appendingPathComponent("assets").path), "пустая папка убрана")
		#expect(f.list().map(\.path) == ["scripts/run.sh"])
	}

	@Test func rejectsPathsOutsidePackage() throws {
		let r = try root()
		defer { try? FileManager.default.removeItem(at: r) }
		let f = RolePackageFiles(root: r)
		for bad in ["../x", "a/../../x", "/etc/passwd", "", "  ", "./x", "a//..//b"] {
			#expect(throws: RolePackageFiles.FileError.badPath) { try f.write(bad, "x") }
		}
	}

	@Test func refusesBinaryAndHugeFiles() throws {
		let r = try root()
		defer { try? FileManager.default.removeItem(at: r) }
		let f = RolePackageFiles(root: r)
		try Data([0xff, 0xfe, 0x00, 0x80]).write(to: r.appendingPathComponent("blob.bin"))
		#expect(throws: RolePackageFiles.FileError.notText) { try f.read("blob.bin") }
		try Data(count: RolePackageFiles.maxBytes + 1).write(to: r.appendingPathComponent("big.txt"))
		#expect(throws: RolePackageFiles.FileError.tooBig) { try f.read("big.txt") }
	}
}
