// swift-tools-version: 6.0
import PackageDescription

// Нативный клиент nessy-orch для macOS: NessyKit — модель, API, SSE и состояние (без UI, тестируется отдельно);
// NessyOrch — SwiftUI-приложение (menu bar + окно). Сборка .app — scripts/build-app.sh.
let package = Package(
	name: "NessyOrch",
	defaultLocalization: "ru",
	platforms: [.macOS("26.0")],
	products: [
		.library(name: "NessyKit", targets: ["NessyKit"]),
		.executable(name: "NessyOrch", targets: ["NessyOrch"]),
	],
	dependencies: [
		// встроенный терминал (MIT); 1.20.0 — последняя стабильная 1.x
		.package(url: "https://github.com/migueldeicaza/SwiftTerm.git", .upToNextMinor(from: "1.20.0")),
	],
	targets: [
		.target(name: "NessyKit", swiftSettings: [.swiftLanguageMode(.v5)]),
		.executableTarget(name: "NessyOrch", dependencies: ["NessyKit", .product(name: "SwiftTerm", package: "SwiftTerm")], swiftSettings: [.swiftLanguageMode(.v5)]),
		.testTarget(name: "NessyKitTests", dependencies: ["NessyKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
	]
)
