import XCTest

@testable import NativeBridgeCore

// sc-5219 (D7a): the iPhone shell tells the page bridge, at the start of every
// load of the app's own page, whether it has opted in to the storage guard
final class NativeShellScriptTests: XCTestCase {
    func testItTellsTheAppsOwnPageThatTheGuardIsOn() {
        XCTAssertEqual(
            NativeShellScript.source(storageGuard: true, expectedOrigin: "capacitor://localhost"),
            #"if (location.origin === "capacitor:\/\/localhost") { window.__actualNativeShell = {"storageGuard": true}; }"#)
    }

    func testOffSaysOff() {
        XCTAssertTrue(NativeShellScript.source(storageGuard: false, expectedOrigin: "capacitor://localhost")
            .contains(#"{"storageGuard": false}"#))
    }

    // A sign-in provider's page in the same web view gets nothing
    func testWithNoOriginItSetsNothing() {
        XCTAssertEqual(NativeShellScript.source(storageGuard: true, expectedOrigin: nil), "")
    }
}
