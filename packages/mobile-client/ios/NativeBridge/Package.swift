// swift-tools-version:5.9
// Fork-only (sc-3584, ADR 11). The platform-free half of the native bridge:
// the Codable contract, the allowlist and the change-event coalescer. The iOS
// app compiles these sources directly (see App.xcodeproj); this package lets
// `swift test` run them on any Mac or Linux runner without a simulator.
import PackageDescription

let package = Package(
    name: "NativeBridge",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "NativeBridgeCore", targets: ["NativeBridgeCore"])
    ],
    targets: [
        .target(name: "NativeBridgeCore"),
        .testTarget(name: "NativeBridgeCoreTests", dependencies: ["NativeBridgeCore"]),
    ]
)
