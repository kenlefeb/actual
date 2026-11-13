import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "Transfers follow the move-money rules" and "The native Budget
// screen's write handlers are allowlisted"; native-budget-screen: "Money is
// moved between categories and to-budget" (sc-3787). Fake transport, contract fixtures.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixtureJSON(_ name: String) throws -> String {
    String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json")), as: UTF8.self)
}

private func snapshot(_ name: String = "budget-month-envelope") throws -> BudgetMonth {
    try JSONDecoder().decode(BudgetMonth.self, from: Data(try fixtureJSON(name).utf8))
}

private func object(_ json: String) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
}

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private let march9: () -> Date = {
    DateComponents(calendar: utc, year: 2026, month: 3, day: 9).date!
}

private struct Boom: Error {}

// The envelope fixture: to-budget 140000; rent (balance 30000) and hidden
// power (balance 10000) in Bills; salary is income.
final class TransferValueTests: XCTestCase {
    func testCategoryToCategoryUsesTransferCategoryWithTheSnapshotsCurrency() throws {
        let transfer = try Transfer(from: .category("rent"), to: .category("power"), amount: 1000, in: snapshot("budget-month-envelope-jpy"))
        XCTAssertEqual(transfer.handler, "budget/transfer-category")
        let args = try object(String(decoding: JSONEncoder().encode(transfer), as: UTF8.self))
        XCTAssertEqual(args["from"] as? String, "rent")
        XCTAssertEqual(args["to"] as? String, "power")
        XCTAssertEqual(args["amount"] as? Int, 1000)
        XCTAssertEqual(args["month"] as? String, "2026-03")
        XCTAssertEqual(args["currencyCode"] as? String, "JPY")
    }

    func testCategoryToToBudgetUsesTransferCategory() throws {
        let transfer = try Transfer(from: .category("rent"), to: .toBudget, amount: 1000, in: snapshot())
        XCTAssertEqual(transfer.handler, "budget/transfer-category")
        let args = try object(String(decoding: JSONEncoder().encode(transfer), as: UTF8.self))
        XCTAssertEqual(args["to"] as? String, "to-budget")
    }

    // loot-core's transferCategory would write a budget row for a category named to-budget
    func testToBudgetToACategoryUsesTransferAvailable() throws {
        let transfer = try Transfer(from: .toBudget, to: .category("rent"), amount: 1000, in: snapshot())
        XCTAssertEqual(transfer.handler, "budget/transfer-available")
        let args = try object(String(decoding: JSONEncoder().encode(transfer), as: UTF8.self))
        XCTAssertEqual(Set(args.keys), ["month", "amount", "category"])
        XCTAssertEqual(args["category"] as? String, "rent")
    }

    func testTheWholeBalanceOrTheWholeToBudgetCanMove() throws {
        XCTAssertNoThrow(try Transfer(from: .category("rent"), to: .toBudget, amount: 30000, in: snapshot()))
        XCTAssertNoThrow(try Transfer(from: .toBudget, to: .category("rent"), amount: 140000, in: snapshot()))
    }

    func testRefusesEveryMoveTheRulesForbid() throws {
        let month = try snapshot()
        let refused: [(String, MoveEnd, MoveEnd, Int)] = [
            ("zero", .category("rent"), .toBudget, 0),
            ("negative", .toBudget, .category("rent"), -1),
            ("to itself", .category("rent"), .category("rent"), 1),
            ("to-budget to itself", .toBudget, .toBudget, 1),
            ("income source", .category("salary"), .category("rent"), 1),
            ("income destination", .category("rent"), .category("salary"), 1),
            ("above the balance", .category("rent"), .toBudget, 30001),
            ("above to-budget", .toBudget, .category("rent"), 140001),
            ("unknown category", .category("nope"), .toBudget, 1),
            ("a group id", .category("bills"), .toBudget, 1),
            ("a category named to-budget", .category("to-budget"), .category("rent"), 1),
        ]
        for (label, from, to, amount) in refused {
            XCTAssertThrowsError(try Transfer(from: from, to: to, amount: amount, in: month), label)
        }
    }

    func testRefusesAnyMoveOnATrackingMonth() throws {
        XCTAssertThrowsError(try Transfer(from: .category("rent"), to: .toBudget, amount: 1, in: snapshot("budget-month-tracking")))
    }
}

final class TransferAllowlistTests: XCTestCase {
    func testBothTransferHandlersAreAllowlistedWrites() {
        XCTAssertTrue(NativeBridgeAllowlist.writes.isSuperset(of: ["budget/transfer-category", "budget/transfer-available"]))
    }

    func testATransferIsForwardedUnderItsOwnHandler() async throws {
        var seen: [String] = []
        let client = NativeBridgeClient { name, _ in
            seen.append(name)
            return "null"
        }
        let month = try snapshot()
        try await client.transfer(Transfer(from: .toBudget, to: .category("rent"), amount: 1, in: month))
        try await client.transfer(Transfer(from: .category("rent"), to: .toBudget, amount: 1, in: month))
        XCTAssertEqual(seen, ["budget/transfer-available", "budget/transfer-category"])
    }

    // Only the typed Transfer, under the handler it chose, ever reaches the page
    func testATransferNameWithOtherArgumentsIsRefused() async throws {
        var calls = 0
        let client = NativeBridgeClient { _, _ in
            calls += 1
            return "null"
        }
        let available = try Transfer(from: .toBudget, to: .category("rent"), amount: 1, in: snapshot())
        let attempts: [() async throws -> Data] = [
            { try await client.call("budget/transfer-category", args: ["from": "rent", "to": "to-budget"]) },
            { try await client.call("budget/transfer-available") },
            { try await client.call("budget/transfer-category", args: available) },
            { try await client.call("budget/transfer-available", args: BudgetAmountWrite(category: "rent", month: "2026-03", amount: 1)) },
            { try await client.call("budget/budget-amount", args: available) },
        ]
        for attempt in attempts {
            do {
                _ = try await attempt()
                XCTFail("expected a refusal")
            } catch NativeBridgeError.invalidWrite {
            } catch {
                XCTFail("unexpected error \(error)")
            }
        }
        XCTAssertEqual(calls, 0)
    }
}

@MainActor
final class MoveMoneyViewModelTests: XCTestCase {
    private func loadedModel(
        fixture: String = "budget-month-envelope", afterWrite: String? = nil, writeError: Error? = nil,
        calls: @escaping (String, String) -> Void
    ) async throws -> BudgetViewModel {
        let json = try fixtureJSON(fixture)
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 1) { name, args in
                calls(name, args)
                if name.hasPrefix("budget/") {
                    if let writeError { throw writeError }
                    return "null"
                }
                return afterWrite ?? json
            }, now: march9, calendar: utc)
        await model.load()
        return model
    }

    func testToBudgetToACategoryCallsTransferAvailableThenReadsAgain() async throws {
        var seen: [(String, String)] = []
        let reread = try fixtureJSON("budget-month-envelope")
            .replacingOccurrences(of: #""toBudget": 140000"#, with: #""toBudget": 139000"#)
        let model = try await loadedModel(afterWrite: reread) { seen.append(($0, $1)) }
        let moved = await model.moveMoney(month: "2026-03", from: .toBudget, to: .category("rent"), text: "10.00")
        XCTAssertTrue(moved)
        XCTAssertEqual(seen.map(\.0), ["native/budget-month", "budget/transfer-available", "native/budget-month"])
        let args = try object(seen[1].1)
        XCTAssertEqual(args["amount"] as? Int, 1000)
        XCTAssertEqual(args["category"] as? String, "rent")
        guard case .loaded(let month) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(month.totals.toBudget, 139000)
        XCTAssertNil(model.saveError)
    }

    func testCategoryToCategoryCallsTransferCategoryWithTheSnapshotsCurrency() async throws {
        var seen: [(String, String)] = []
        let model = try await loadedModel(fixture: "budget-month-envelope-jpy") { seen.append(($0, $1)) }
        let moved = await model.moveMoney(month: "2026-03", from: .category("rent"), to: .category("power"), text: "100")
        XCTAssertTrue(moved)
        XCTAssertEqual(seen.map(\.0), ["native/budget-month", "budget/transfer-category", "native/budget-month"])
        let args = try object(seen[1].1)
        XCTAssertEqual(args["from"] as? String, "rent")
        XCTAssertEqual(args["to"] as? String, "power")
        XCTAssertEqual(args["amount"] as? Int, 100)
        XCTAssertEqual(args["currencyCode"] as? String, "JPY")
    }

    func testCategoryToToBudgetCallsTransferCategory() async throws {
        var seen: [(String, String)] = []
        let model = try await loadedModel { seen.append(($0, $1)) }
        let moved = await model.moveMoney(month: "2026-03", from: .category("rent"), to: .toBudget, text: "1")
        XCTAssertTrue(moved)
        XCTAssertEqual(seen.map(\.0), ["native/budget-month", "budget/transfer-category", "native/budget-month"])
        XCTAssertEqual(try object(seen[1].1)["to"] as? String, "to-budget")
    }

    func testAFailedMoveKeepsTheOldNumbersAndIsNotRetried() async throws {
        var seen: [String] = []
        let model = try await loadedModel(writeError: Boom()) { name, _ in seen.append(name) }
        let before = model.state
        let moved = await model.moveMoney(month: "2026-03", from: .toBudget, to: .category("rent"), text: "10")
        XCTAssertFalse(moved)
        XCTAssertEqual(model.state, before)
        XCTAssertEqual(model.saveError, .failed)
        XCTAssertEqual(seen, ["native/budget-month", "budget/transfer-available"])
    }

    func testAMoveTheRulesForbidIsNeverSent() async throws {
        var writes = 0
        let model = try await loadedModel { name, _ in if name.hasPrefix("budget/") { writes += 1 } }
        let attempts: [(String, MoveEnd, MoveEnd, String)] = [
            ("2026-03", .category("rent"), .toBudget, "300.01"),
            ("2026-03", .category("rent"), .category("rent"), "1"),
            ("2026-03", .toBudget, .category("rent"), "0"),
            ("2026-03", .toBudget, .category("rent"), "ten"),
            ("2026-02", .toBudget, .category("rent"), "1"),
        ]
        for (month, from, to, text) in attempts {
            let moved = await model.moveMoney(month: month, from: from, to: to, text: text)
            XCTAssertFalse(moved, "\(from) \(to) \(text)")
            XCTAssertNotNil(model.saveError)
        }
        XCTAssertEqual(writes, 0)
    }

    func testATrackingMonthOffersNoMove() async throws {
        var writes = 0
        let model = try await loadedModel(fixture: "budget-month-tracking") { name, _ in if name.hasPrefix("budget/") { writes += 1 } }
        XCTAssertFalse(model.canMoveMoney)
        let moved = await model.moveMoney(month: "2026-03", from: .category("rent"), to: .toBudget, text: "1")
        XCTAssertFalse(moved)
        XCTAssertEqual(writes, 0)
    }

    func testAnEnvelopeMonthOffersTheMove() async throws {
        let model = try await loadedModel { _, _ in }
        XCTAssertTrue(model.canMoveMoney)
    }

    // native-budget-screen: "The sheet shows the limit"
    func testTheSheetPrefillsTheSourcesBalanceAndShowsTheLimit() async throws {
        let model = try await loadedModel { _, _ in }
        XCTAssertEqual(model.movePrefill(from: .category("rent")), "300.00")
        XCTAssertEqual(model.moveLimitMessage(from: .category("rent")), "You can move up to 300.00")
        XCTAssertEqual(model.movePrefill(from: .toBudget), "1400.00")
        XCTAssertTrue(model.canConfirmMove(from: .category("rent"), to: .toBudget, text: "300.00"))
        XCTAssertFalse(model.canConfirmMove(from: .category("rent"), to: .toBudget, text: "300.01"))
        XCTAssertFalse(model.canConfirmMove(from: .category("rent"), to: .category("rent"), text: "1"))
    }
}
