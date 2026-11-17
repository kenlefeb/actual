import Foundation
import XCTest

@testable import NativeBridgeCore

// native-reconcile-flow (sc-4801): the Swift half of the reconcile contract.
// Decodes the fixtures loot-core's reconcile.test.ts writes, and checks the
// typed writes and the presentReconcile message.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json"))
}

// Re-encoded without nulls and with sorted keys, so a renamed or added field fails
private func canonical(_ data: Data) throws -> String {
    func strip(_ value: Any) -> Any {
        if let dict = value as? [String: Any] { return dict.filter { !($0.value is NSNull) }.mapValues(strip) }
        if let array = value as? [Any] { return array.map(strip) }
        return value
    }
    let object = strip(try JSONSerialization.jsonObject(with: data))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: .sortedKeys), as: UTF8.self)
}

private func roundTrips<T: Codable>(_ type: T.Type, _ data: Data) throws -> Bool {
    try canonical(JSONEncoder().encode(JSONDecoder().decode(type, from: data))) == canonical(data)
}

final class ReconcileContractTests: XCTestCase {
    func testDecodesTheMonthFixture() throws {
        let data = try fixture("reconcile-month")
        let month = try JSONDecoder().decode(ReconcileMonth.self, from: data)
        XCTAssertEqual(month.month, "2017-01")
        XCTAssertEqual(month.accounts.map(\.id), ["checking", "savings", "card"])
        XCTAssertEqual(month.accounts.first?.status, .due)
        XCTAssertEqual(month.accounts.first?.detail.cleared, 105000)
        XCTAssertTrue(try roundTrips(ReconcileMonth.self, data))
    }

    func testDecodesTheRowsFixture() throws {
        let data = try fixture("reconcile-rows")
        let rows = try JSONDecoder().decode(ReconcileRows.self, from: data)
        XCTAssertEqual(rows.scope, .toTick)
        XCTAssertEqual(rows.rows.map(\.id), ["split", "food"])
        XCTAssertTrue(rows.rows[0].isParent)
        XCTAssertEqual(rows.rows[1].payee, "Grocer")
        XCTAssertEqual(rows.summary, ReconcileSummary(statement: 95000, cleared: 105000, difference: -10000))
        XCTAssertTrue(try roundTrips(ReconcileRows.self, data))
    }

    func testAStatusAddedLaterStillDecodes() throws {
        var json = try JSONSerialization.jsonObject(with: fixture("reconcile-month")) as! [String: Any]
        var accounts = json["accounts"] as! [[String: Any]]
        accounts[0]["status"] = "something-new"
        json["accounts"] = accounts
        let month = try JSONDecoder().decode(ReconcileMonth.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(month.accounts[0].status, .other("something-new"))
    }
}

final class ReconcileWriteTests: XCTestCase {
    func testATickNeedsRowsAndAToken() {
        XCTAssertThrowsError(try ReconcileTick(accountId: "a", ids: [], cleared: true))
        XCTAssertThrowsError(try ReconcileTick(accountId: "", ids: ["t"], cleared: true))
        XCTAssertThrowsError(try ReconcileTick(accountId: "a", ids: ["t"], cleared: true, undoToken: ""))
        XCTAssertNoThrow(try ReconcileTick(accountId: "a", ids: ["t"], cleared: true))
    }

    func testTheListCapsAt500() {
        XCTAssertThrowsError(try ReconcileListSet(excluded: (0...500).map { "a\($0)" }))
        XCTAssertNoThrow(try ReconcileListSet(excluded: ["a"]))
    }

    func testASaveCarriesNoWho() throws {
        let save = try StatementBalanceSave(accountId: "a", amount: 46541, source: .bankSync, asOf: "2026-11-16")
        let json = String(decoding: try JSONEncoder().encode(save), as: UTF8.self)
        XCTAssertFalse(json.contains("entered_by"))
        XCTAssertThrowsError(try StatementBalanceSave(accountId: "a", amount: 1, source: .entered, asOf: "16 Nov"))
    }

    func testTheClientSendsATickOnlyAsItsTypedValue() async throws {
        var seen: [(String, String)] = []
        let summary = #"{"statement":100820,"cleared":100820,"difference":0}"#
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return summary
        }
        do {
            _ = try await client.call("native/reconcile-tick", args: ["account_id": "a"])
            XCTFail("expected a refusal")
        } catch NativeBridgeError.invalidWrite(let name) {
            XCTAssertEqual(name, "native/reconcile-tick")
        }
        let result = try await client.reconcileTick(try ReconcileTick(accountId: "a", ids: ["t"], cleared: true, undoToken: "T"))
        XCTAssertEqual(result.difference, 0)
        XCTAssertEqual(seen.map(\.0), ["native/reconcile-tick"])
        XCTAssertEqual(seen.first?.1, #"{"account_id":"a","cleared":true,"ids":["t"],"undoToken":"T"}"#)
    }

    func testTheConsumeIsNeverAllowlisted() {
        XCTAssertFalse(NativeBridgeAllowlist.handlers.contains("account-statement-balance-consume"))
        XCTAssertTrue(NativeBridgeAllowlist.handlers.isSuperset(of: [
            "native/reconcile-month", "native/reconcile-rows", "native/reconcile-tick", "native/reconcile-list-set",
            "account-statement-balance-prefill", "account-statement-balance-save", "account-statement-balance-get",
        ]))
    }
}

// native-bridge: "The reconcile handlers are allowlisted", presentReconcile.
// The origin check is PageOriginGuard's (PageOriginGuardTests).
final class PresentReconcileTests: XCTestCase {
    let open: Set<String> = ["checking", "card"]

    func testAKnownOpenAccountOpensStepOne() {
        XCTAssertEqual(PresentReconcile(body: ["type": "presentReconcile", "account_id": "checking"], openAccounts: open), .account("checking"))
    }

    func testTheBannerOpensTheChecklist() {
        XCTAssertEqual(PresentReconcile(body: ["type": "presentReconcile", "checklist": true], openAccounts: open), .checklist)
    }

    func testAnythingElseIsIgnored() {
        for id in ["savings", "../checking", "", "CHECKING"] as [Any] + [42, NSNull(), ["checking"]] {
            XCTAssertNil(PresentReconcile(body: ["type": "presentReconcile", "account_id": id], openAccounts: open), "\(id)")
        }
        XCTAssertNil(PresentReconcile(body: ["type": "route", "account_id": "checking"], openAccounts: open))
        XCTAssertNil(PresentReconcile(body: "presentReconcile", openAccounts: open))
    }
}

// task 2.3: NativeScreen.reconcile reads on when unset (Ken, 2026-11-15)
final class ReconcileSwitchTests: XCTestCase {
    func testIsOnWhenUnsetAndOffWhenTurnedOff() {
        let suite = "ReconcileSwitchTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(NativeScreenSwitch.reconcileKey, "NativeScreen.reconcile")
        XCTAssertTrue(NativeScreenSwitch.isReconcileNative(defaults: defaults))
        defaults.set(false, forKey: NativeScreenSwitch.reconcileKey)
        XCTAssertFalse(NativeScreenSwitch.isReconcileNative(defaults: defaults))
        XCTAssertTrue(NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost").contains(#""reconcile": false"#))
        defaults.set(true, forKey: NativeScreenSwitch.reconcileKey)
        XCTAssertTrue(NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost").contains(#""reconcile": true"#))
    }
}
