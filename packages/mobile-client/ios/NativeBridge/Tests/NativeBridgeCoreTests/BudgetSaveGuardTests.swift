import Foundation
import XCTest

@testable import NativeBridgeCore

// native-budget-screen: "Budgeted amounts are edited through loot-core". A save
// is refused while a month step (previous, next or select) is pending, and
// allowed once it settles (sc-3868, guard from sc-3769). Fake transport; the
// step's read is held on a gate, so the order is fixed without sleeps.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // NativeBridgeCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // NativeBridge
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile-client
    .deletingLastPathComponent()  // packages
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private let march9: () -> Date = {
    DateComponents(calendar: utc, year: 2026, month: 3, day: 9).date!
}

private final class StepGate { var continuation: CheckedContinuation<Void, Never>? }

@MainActor
final class BudgetSaveGuardTests: XCTestCase {
    func testASaveDuringAPendingMonthStepMakesNoWriteAndOneAfterItSettles() async throws {
        let json = String(decoding: try Data(contentsOf: fixturesDir.appendingPathComponent("budget-month-envelope.json")), as: UTF8.self)
        let gate = StepGate()
        var held = false
        var writes = 0
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 5) { name, args in
                if name == "budget/budget-amount" {
                    writes += 1
                    return "null"
                }
                // Only the first read of the stepped-to month waits; the re-read after a save must not
                if args.contains("2026-04"), !held {
                    held = true
                    await withCheckedContinuation { gate.continuation = $0 }
                }
                return json
            }, now: march9, calendar: utc)
        await model.load()

        let step = Task { await model.next() }
        try await waitUntil("the month step read reached its gate") { gate.continuation != nil }

        let refused = await model.saveBudgeted(month: "2026-03", category: "rent", text: "125.00")
        XCTAssertFalse(refused)
        XCTAssertEqual(writes, 0)

        gate.continuation?.resume()
        await step.value

        let saved = await model.saveBudgeted(month: "2026-03", category: "rent", text: "125.00")
        XCTAssertTrue(saved)
        XCTAssertEqual(writes, 1)
    }
}
