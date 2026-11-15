import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "Schedules and paychecks are one batched read", "The paycheck
// handlers are allowlisted" and "Native Undo reverses only the native write it
// names" (sc-4341). Decodes the fixtures the loot-core contract test writes.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages
    .appendingPathComponent("loot-core/src/server/native/fixtures")

func paychecksFixture(_ name: String = "schedules-paychecks") throws -> Data {
    try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json"))
}

// Canonical JSON (sorted keys, no nulls), as the budget-month contract test
private func canonical(_ data: Data) throws -> String {
    func strip(_ value: Any) -> Any {
        if let dict = value as? [String: Any] { return dict.filter { !($0.value is NSNull) }.mapValues(strip) }
        if let array = value as? [Any] { return array.map(strip) }
        return value
    }
    let object = strip(try JSONSerialization.jsonObject(with: data))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: .sortedKeys), as: UTF8.self)
}

final class SchedulesPaychecksContractTests: XCTestCase {
    func testDecodesTheFixture() throws {
        let data = try paychecksFixture()
        let read = try JSONDecoder().decode(SchedulesPaychecks.self, from: data)
        XCTAssertTrue(read.enabled)
        XCTAssertEqual(read.summary.nextDate, "2026-11-13")
        XCTAssertEqual(read.summary.netAmount, 240000)
        XCTAssertEqual(read.summary.scheduleCount, 1)
        XCTAssertTrue(read.summary.anyWarning)
        XCTAssertEqual(read.paychecks.first?.next?.deposits.map(\.accountName), ["Savings", "Checking"])
        XCTAssertEqual(read.paychecks.first?.later.count, 3)
        XCTAssertEqual(read.paychecks.first?.clearingWarning?.clearingAccountName, "Acme Paycheck")
        XCTAssertEqual(read.schedules.map(\.status), [.scheduled])
        XCTAssertEqual(try canonical(JSONEncoder().encode(read)), try canonical(data))
    }

    func testDecodesTheEmptyFixture() throws {
        let data = try paychecksFixture("schedules-paychecks-empty")
        let read = try JSONDecoder().decode(SchedulesPaychecks.self, from: data)
        XCTAssertFalse(read.summary.hasPaychecks)
        XCTAssertNil(read.summary.nextDate)
        XCTAssertNil(read.summary.netAmount)
        XCTAssertTrue(read.paychecks.isEmpty)
        XCTAssertEqual(try canonical(JSONEncoder().encode(read)), try canonical(data))
    }

    func testFailsOnAShapeChange() throws {
        var json = try JSONSerialization.jsonObject(with: paychecksFixture()) as! [String: Any]
        json["summary"] = nil
        XCTAssertThrowsError(
            try JSONDecoder().decode(SchedulesPaychecks.self, from: JSONSerialization.data(withJSONObject: json)))
        json = try JSONSerialization.jsonObject(with: paychecksFixture()) as! [String: Any]
        json["renamedField"] = 1
        let changed = try JSONSerialization.data(withJSONObject: json)
        let read = try JSONDecoder().decode(SchedulesPaychecks.self, from: changed)
        XCTAssertNotEqual(try canonical(JSONEncoder().encode(read)), try canonical(changed))
    }

    // A status word loot-core adds later still decodes, as one Swift shows plainly
    func testAnUnknownStatusDecodes() throws {
        let json = #"{"id":"s","name":null,"payeeName":null,"accountName":null,"nextDate":null,"amount":0,"isApprox":false,"completed":false,"status":"later"}"#
        let schedule = try JSONDecoder().decode(SchedulesPaychecks.Schedule.self, from: Data(json.utf8))
        XCTAssertEqual(schedule.status, .other("later"))
    }
}

final class PaycheckWriteTests: XCTestCase {
    private func client(_ seen: @escaping (String, String) -> Void) -> NativeBridgeClient {
        NativeBridgeClient { name, args in
            seen(name, args)
            return "null"
        }
    }

    func testSendsTheSkipAsItsTypedValue() async throws {
        var seen: [(String, String)] = []
        try await client { seen.append(($0, $1)) }.skipNextPaycheck(try PaycheckSkip(id: "acme", undoToken: "T"))
        XCTAssertEqual(seen.map(\.0), ["paycheck-skip-next"])
        XCTAssertEqual(seen.map(\.1), [#"{"id":"acme","undoToken":"T"}"#])
    }

    func testSendsNativeUndoWithItsToken() async throws {
        var seen: [(String, String)] = []
        try await client { seen.append(($0, $1)) }.undo(try NativeUndo(token: "T"))
        XCTAssertEqual(seen.map(\.0), ["native/undo"])
        XCTAssertEqual(seen.map(\.1), [#"{"token":"T"}"#])
    }

    func testRefusesAnEmptyIdOrToken() {
        XCTAssertThrowsError(try PaycheckSkip(id: "", undoToken: "T"))
        XCTAssertThrowsError(try PaycheckSkip(id: "acme", undoToken: ""))
        XCTAssertThrowsError(try NativeUndo(token: ""))
    }

    func testRefusesLooseArgumentsForThePaycheckWrites() async {
        var calls = 0
        let client = client { _, _ in calls += 1 }
        for name in ["paycheck-skip-next", "native/undo"] {
            do {
                _ = try await client.call(name, args: ["id": "acme", "token": "T"])
                XCTFail("expected a refusal")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .invalidWrite(name))
            }
        }
        XCTAssertEqual(calls, 0)
    }

    func testRefusesBareUndoRedoAndOtherPaycheckHandlers() async {
        var calls = 0
        let client = client { _, _ in calls += 1 }
        for name in ["undo", "redo", "paycheck-create", "paycheck-update", "account-set-business-days"] {
            do {
                _ = try await client.call(name)
                XCTFail("expected a refusal")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .notAllowlisted(name))
            }
        }
        XCTAssertEqual(calls, 0)
    }

    func testReadsTheBatchedRead() async throws {
        let json = String(decoding: try paychecksFixture(), as: UTF8.self)
        var seen: [(String, String)] = []
        let client = NativeBridgeClient { name, args in
            seen.append((name, args))
            return json
        }
        let read = try await client.schedulesPaychecks()
        XCTAssertEqual(seen.map(\.0), ["native/schedules-paychecks"])
        XCTAssertEqual(seen.map(\.1), ["{}"])
        XCTAssertEqual(read.paychecks.count, 1)
    }
}

// Only a sync-event's table names are read; its error meta never is (sc-3884)
final class NativeBridgeEventTablesTests: XCTestCase {
    func testReadsOnlyTheTableNamesOfASyncEvent() {
        let body: [String: Any] = [
            "event": "sync-event",
            "payload": ["type": "applied", "tables": ["schedules", 7, "paychecks"], "meta": ["url": "https://x"]],
        ]
        XCTAssertEqual(NativeBridgeEvent.tables(of: body), ["schedules", "paychecks"])
    }

    func testHasNoTablesForOtherEventsOrShapes() {
        XCTAssertEqual(NativeBridgeEvent.tables(of: ["event": "cells-changed", "payload": ["tables": ["x"]]]), [])
        XCTAssertEqual(NativeBridgeEvent.tables(of: ["event": "sync-event", "payload": "nope"]), [])
        XCTAssertEqual(NativeBridgeEvent.tables(of: "nope"), [])
    }
}

// sc-4341 review: amounts read as the web list writes them (SchedulesListItem)
final class ScheduleAmountTextTests: XCTestCase {
    private func schedule(_ amount: Int, approx: Bool) throws -> SchedulesPaychecks.Schedule {
        let json = #"{"id":"s","name":null,"payeeName":null,"accountName":null,"nextDate":null,"amount":\#(amount),"isApprox":\#(approx),"completed":false,"status":"scheduled"}"#
        return try JSONDecoder().decode(SchedulesPaychecks.Schedule.self, from: Data(json.utf8))
    }

    func testMatchesTheWebSigns() throws {
        let style = try JSONDecoder().decode(SchedulesPaychecks.self, from: paychecksFixture()).amountStyle
        XCTAssertEqual(try schedule(-14000, approx: true).amountText(style: style), "~140.00")
        XCTAssertEqual(try schedule(-190000, approx: false).amountText(style: style), "1,900.00")
        XCTAssertEqual(try schedule(5000, approx: false).amountText(style: style), "+50.00")
        XCTAssertEqual(try schedule(5000, approx: true).amountText(style: style), "~+50.00")
    }
}
