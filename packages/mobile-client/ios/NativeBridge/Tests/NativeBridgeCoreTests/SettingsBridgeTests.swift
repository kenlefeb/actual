import Foundation
import XCTest

@testable import NativeBridgeCore

// sc-4643 (native-settings-screen D1, D2). The settings read decodes the
// contract fixture loot-core writes; the save crosses only as SettingsSave.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

final class SettingsBridgeTests: XCTestCase {
    func testTheSettingsReadDecodesTheContractFixture() async throws {
        let json = String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("settings.json")), as: UTF8.self)
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return json
        }
        let settings = try await client.settings()
        XCTAssertEqual(seen.map(\.0), ["native/settings"])
        XCTAssertEqual(settings.prefs["numberFormat"], "dot-comma")
        XCTAssertEqual(settings.flags.currency, false)
        XCTAssertEqual(settings.budget.name, "Home")
        XCTAssertEqual(settings.server, NativeSettings.Server(url: "https://sync.example.com", signedIn: true))
        XCTAssertEqual(settings.encryption.enabled, false)
        XCTAssertEqual(settings.sync.pending, false)
        XCTAssertNil(settings.clientVersion)
        XCTAssertEqual(
            settings.limits.first { $0.id == "accounts-register-page-size" },
            NativeSettings.Limit(id: "accounts-register-page-size", value: 120, defaultValue: 50, floor: 1, ceiling: 200))
        XCTAssertEqual(settings.limits.first { $0.id == "native-persist-wait-ms" }?.floor, 100)
        // Every limit an engine handler reads: the Add transaction sheet's five
        // and story 4973's two scheduled-row limits included, sc-5219's storage wait
        // and sc-5463's wait for the budget to open
        XCTAssertEqual(settings.limits.count, 15)
    }

    func testServerInfoDecodesReachableAndUnreachable() async throws {
        var reply = #"{"reachable":true,"version":"26.10.1-alpha.37"}"#
        let client = NativeBridgeClient { _, _ in reply }
        let reachable = try await client.serverInfo()
        XCTAssertEqual(reachable, ServerInfo(reachable: true, version: "26.10.1-alpha.37"))
        reply = #"{"reachable":false,"version":null}"#
        let unreachable = try await client.serverInfo()
        XCTAssertEqual(unreachable, ServerInfo(reachable: false, version: nil))
    }

    func testTheSaveSendsChangesAndTokenAndNullForAReset() async throws {
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return "null"
        }
        let save = try SettingsSave(
            changes: ["dateFormat": .text("yyyy-MM-dd"), "accounts-register-page-size": .limit(nil)], undoToken: "T")
        try await client.saveSettings(save)
        XCTAssertEqual(seen.map(\.0), ["native/settings-save"])
        XCTAssertEqual(
            seen.first?.1,
            #"{"changes":{"accounts-register-page-size":null,"dateFormat":"yyyy-MM-dd"},"undoToken":"T"}"#)
    }

    func testAnEmptySaveOrTokenIsRefusedBeforeTheCall() {
        XCTAssertThrowsError(try SettingsSave(changes: [:]))
        XCTAssertThrowsError(try SettingsSave(changes: ["dateFormat": .text("yyyy-MM-dd")], undoToken: ""))
    }

    func testTheSaveTakesOnlyItsTypedValue() async {
        let client = NativeBridgeClient { _, _ in "null" }
        do {
            _ = try await client.call("native/settings-save", args: ["changes": "x"])
            XCTFail("loose arguments must be refused")
        } catch NativeBridgeError.invalidWrite(let name) {
            XCTAssertEqual(name, "native/settings-save")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testRawSettingsHandlersStayRefused() async {
        let client = NativeBridgeClient { _, _ in "null" }
        for name in ["preferences/save", "save-global-prefs", "subscribe-sign-out", "set-server-url", "key-make", "reset-budget-cache"] {
            XCTAssertFalse(NativeBridgeAllowlist.handlers.contains(name))
            do {
                _ = try await client.call(name)
                XCTFail("\(name) must be refused")
            } catch NativeBridgeError.notAllowlisted {
            } catch {
                XCTFail("unexpected \(error)")
            }
        }
    }
}
