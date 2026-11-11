import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge spec (sc-3584): the Swift half of the contract test. It decodes
// the fixtures the loot-core vitest contract test writes, and fails when their
// shape and the Codable types disagree.
private let packagesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: packagesDir.appendingPathComponent(
        "loot-core/src/server/native/fixtures/\(name).json"))
}

// Codable skips unknown keys and treats a missing optional key as nil, so
// decoding alone misses a renamed or added field. Re-encode and compare.
// Canonical JSON (sorted keys, no nulls), so the comparison also runs on Linux
private func canonical(_ data: Data) throws -> String {
    let object = stripNulls(try JSONSerialization.jsonObject(with: data))
    return String(decoding: try JSONSerialization.data(withJSONObject: object, options: .sortedKeys), as: UTF8.self)
}

private func roundTrips(_ data: Data) throws -> Bool {
    let decoded = try JSONDecoder().decode(BudgetMonth.self, from: data)
    return try canonical(JSONEncoder().encode(decoded)) == canonical(data)
}

private func stripNulls(_ value: Any) -> Any {
    if let dict = value as? [String: Any] {
        return dict.filter { !($0.value is NSNull) }.mapValues(stripNulls)
    }
    if let array = value as? [Any] { return array.map(stripNulls) }
    return value
}

final class BudgetMonthContractTests: XCTestCase {
    func testDecodesTheEnvelopeFixture() throws {
        let data = try fixture("budget-month-envelope")
        let month = try JSONDecoder().decode(BudgetMonth.self, from: data)
        XCTAssertEqual(month.budgetType, .envelope)
        XCTAssertEqual(month.totals.toBudget, 140000)
        XCTAssertNil(month.totals.budgetedIncome)
        XCTAssertEqual(month.groups.flatMap(\.categories).count, 3)
        XCTAssertTrue(try roundTrips(data))
    }

    func testDecodesTheTrackingFixture() throws {
        let data = try fixture("budget-month-tracking")
        let month = try JSONDecoder().decode(BudgetMonth.self, from: data)
        XCTAssertEqual(month.budgetType, .tracking)
        XCTAssertNil(month.totals.toBudget)
        XCTAssertEqual(month.totals.budgetedIncome, 320000)
        XCTAssertTrue(try roundTrips(data))
    }

    func testFailsOnAShapeChange() throws {
        var json = try JSONSerialization.jsonObject(with: fixture("budget-month-envelope")) as! [String: Any]
        json["groups"] = nil
        let changed = try JSONSerialization.data(withJSONObject: json)
        XCTAssertThrowsError(try JSONDecoder().decode(BudgetMonth.self, from: changed))

        json = try JSONSerialization.jsonObject(with: fixture("budget-month-envelope")) as! [String: Any]
        json["renamedField"] = 1
        XCTAssertFalse(try roundTrips(JSONSerialization.data(withJSONObject: json)))
    }
}

final class AllowlistTests: XCTestCase {
    func testMatchesThePageAllowlist() throws {
        let data = try Data(contentsOf: packagesDir.appendingPathComponent(
            "desktop-client/src/data/native-bridge-allowlist.json"))
        let page = try JSONDecoder().decode([String].self, from: data)
        XCTAssertEqual(Set(page), NativeBridgeAllowlist.handlers)
    }

    func testRefusesANameOffTheListWithoutCallingThePage() async throws {
        var calls = 0
        let client = NativeBridgeClient { _, _ in
            calls += 1
            return "{}"
        }
        do {
            _ = try await client.call("delete-budget", args: ["id": "x"])
            XCTFail("expected a refusal")
        } catch NativeBridgeError.notAllowlisted(let name) {
            XCTAssertEqual(name, "delete-budget")
        }
        XCTAssertEqual(calls, 0)
    }

    func testForwardsAnAllowlistedRead() async throws {
        let fixtureJSON = String(decoding: try fixture("budget-month-envelope"), as: UTF8.self)
        var seen: (String, String)?
        let client = NativeBridgeClient { name, args in
            seen = (name, args)
            return fixtureJSON
        }
        let month = try await client.budgetMonth("2026-03")
        XCTAssertEqual(seen?.0, "native/budget-month")
        XCTAssertEqual(seen?.1, #"{"month":"2026-03"}"#)
        XCTAssertEqual(month.month, "2026-03")
    }
}

// native-bridge: "Native views survive a suspended engine" (sc-3584)
final class TimeoutTests: XCTestCase {
    func testDefaultsToAboutFiveSeconds() {
        XCTAssertEqual(NativeBridgeClient.defaultTimeout, 5)
    }

    // A transport that never returns and ignores cancellation, like a call
    // into a suspended WebContent process
    private func hangingClient(timeout: TimeInterval) -> NativeBridgeClient {
        NativeBridgeClient(timeout: timeout) { _, _ in
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
            return "{}"
        }
    }

    func testAHungCallThrowsATimeoutNamingTheHandler() async {
        let started = Date()
        do {
            _ = try await hangingClient(timeout: 0.1).call("native/budget-month")
            XCTFail("expected a timeout")
        } catch NativeBridgeError.timedOut(let name) {
            XCTAssertEqual(name, "native/budget-month")
        } catch {
            XCTFail("unexpected error \(error)")
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testAFastCallIsNotAffected() async throws {
        let client = NativeBridgeClient(timeout: 1) { _, _ in "[]" }
        let data = try await client.call("query")
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "[]")
    }

    func testATransportErrorPassesThrough() async {
        struct Boom: Error {}
        let client = NativeBridgeClient(timeout: 1) { _, _ in throw Boom() }
        do {
            _ = try await client.call("query")
            XCTFail("expected an error")
        } catch {
            XCTAssertTrue(error is Boom)
        }
    }
}

final class BenchmarkTests: XCTestCase {
    func testStatsUseNearestRankPercentiles() {
        let stats = BenchmarkStats(timesMs: (1...20).map(Double.init))
        XCTAssertEqual(stats.count, 20)
        XCTAssertEqual(stats.medianMs, 10)
        XCTAssertEqual(stats.p95Ms, 19)
        XCTAssertEqual(stats.maxMs, 20)
    }

    func testRunsOnlyTheBatchedReadAndReportsTheMonthSize() async throws {
        let fixtureJSON = String(decoding: try fixture("budget-month-envelope"), as: UTF8.self)
        var names = Set<String>()
        var calls = 0
        let client = NativeBridgeClient { name, _ in
            names.insert(name)
            calls += 1
            return fixtureJSON
        }
        let result = try await NativeBridgeBenchmark.run(client: client, month: "2026-03", count: 10, warmUp: 2)
        XCTAssertEqual(names, ["native/budget-month"])
        XCTAssertEqual(calls, 12)
        XCTAssertEqual(result.stats.count, 10)
        XCTAssertEqual(result.categories, 3)
        XCTAssertEqual(result.bytes, fixtureJSON.utf8.count)
        XCTAssertTrue(result.summary.contains("median"))
        XCTAssertTrue(result.summary.contains("2026-03"))
    }
}

final class ChangeCoalescerTests: XCTestCase {
    func testABurstOfEventsFiresOnce() {
        let fired = expectation(description: "fired")
        fired.assertForOverFulfill = true
        let coalescer = ChangeCoalescer(interval: 0.05, queue: .main) { fired.fulfill() }
        for _ in 0..<10 { coalescer.notify() }
        wait(for: [fired], timeout: 1)
        // A later event fires again
        let again = expectation(description: "again")
        coalescer.onFire = { again.fulfill() }
        coalescer.notify()
        wait(for: [again], timeout: 1)
    }
}
