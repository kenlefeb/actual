import Foundation
import XCTest

@testable import NativeBridgeCore

// native-paychecks-screen (sc-4309): the Budget tab's summary row takes its
// state from the read's `summary` block; Swift picks and adds up nothing.
final class PaycheckSummaryRowTests: XCTestCase {
    private func read(_ edit: (inout [String: Any]) -> Void = { _ in }, summary: (inout [String: Any]) -> Void = { _ in }) throws
        -> SchedulesPaychecks
    {
        var object = try JSONSerialization.jsonObject(with: paychecksFixture()) as! [String: Any]
        var inner = object["summary"] as! [String: Any]
        summary(&inner)
        object["summary"] = inner
        edit(&object)
        return try JSONDecoder().decode(SchedulesPaychecks.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testShowsLootCoresValues() throws {
        let read = try read()
        XCTAssertEqual(
            PaycheckSummaryRow(read: read, switchOn: true),
            .upcoming(date: "2026-11-13", net: 240000, scheduleCount: 1, warning: true, style: read.amountStyle))
    }

    func testNoWarningWhenLootCoreReportsNone() throws {
        let read = try read(summary: { $0["anyWarning"] = false })
        guard case .upcoming(_, _, _, let warning, _)? = PaycheckSummaryRow(read: read, switchOn: true) else { return XCTFail("no row") }
        XCTAssertFalse(warning)
    }

    func testNoPaychecksPromptsToAddOneWithNoNumbers() throws {
        let read = try JSONDecoder().decode(SchedulesPaychecks.self, from: paychecksFixture("schedules-paychecks-empty"))
        XCTAssertEqual(PaycheckSummaryRow(read: read, switchOn: true), .addPrompt)
    }

    func testEveryPaycheckEndedSaysNoneUpcoming() throws {
        let read = try read(summary: {
            $0["nextDate"] = NSNull()
            $0["netAmount"] = NSNull()
            $0["anyWarning"] = false
        })
        XCTAssertEqual(PaycheckSummaryRow(read: read, switchOn: true), .noneUpcoming(scheduleCount: 1, warning: false))
    }

    func testHiddenWhileTheSwitchIsOff() throws {
        XCTAssertNil(PaycheckSummaryRow(read: try read(), switchOn: false))
    }

    func testHiddenWhileThePaychecksFeatureIsOff() throws {
        XCTAssertNil(PaycheckSummaryRow(read: try read({ $0["enabled"] = false }), switchOn: true))
    }

    func testHiddenBeforeTheFirstRead() {
        XCTAssertNil(PaycheckSummaryRow(read: nil, switchOn: true))
    }

    @MainActor
    func testTheViewModelKeepsTheRowOnAFailedReRead() async throws {
        let json = String(decoding: try paychecksFixture(), as: UTF8.self)
        let failing = FailFlag()
        let client = NativeBridgeClient(timeout: 1) { _, _ in
            if failing.on { throw NativeBridgeError.timedOut("native/schedules-paychecks") }
            return json
        }
        let model = PaychecksViewModel(client: client)
        model.summaryEnabled = true
        await model.load()
        let before = model.summaryRow
        XCTAssertNotNil(before)
        failing.on = true
        await model.load()
        XCTAssertEqual(before, model.summaryRow)
    }
}

private final class FailFlag: @unchecked Sendable { var on = false }

// Going back from the list keeps the Budget tab (its month and scroll) alive:
// its overlay is kept, not rebuilt, while the list shows over it
final class BudgetOverlayKeepTests: XCTestCase {
    private func keeps(_ path: String, _ tab: NativeTab, budget: Bool = true, bar: Bool = true, paychecks: Bool) -> Bool {
        NativeScreenSwitch.keepsBudgetOverlay(budgetNative: budget, tabBarShown: bar, path: path, selected: tab, paychecksNative: paychecks)
    }

    func testKeptWhileTheListShowsOverItFromTheBudgetTab() {
        XCTAssertTrue(keeps("/budget", .budget, paychecks: false))
        XCTAssertTrue(keeps("/schedules", .budget, paychecks: true))
    }

    func testNotKeptElsewhere() {
        // Schedules opened from Settings, or with the paychecks switch off, is the web's
        XCTAssertFalse(keeps("/schedules", .settings, paychecks: true))
        XCTAssertFalse(keeps("/schedules", .budget, paychecks: false))
        XCTAssertFalse(keeps("/budget", .budget, budget: false, paychecks: true))
        XCTAssertFalse(keeps("/budget", .budget, bar: false, paychecks: true))
    }
}
