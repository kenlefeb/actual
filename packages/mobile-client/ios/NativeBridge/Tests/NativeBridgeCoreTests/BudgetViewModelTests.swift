import Foundation
import XCTest

@testable import NativeBridgeCore

// native-budget-screen spec (sc-3751): the read-only envelope tab's view model,
// the per-screen switch and the tracking fallback. Fake transport, contract fixtures.
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

private func client(returning json: String, timeout: TimeInterval = 1) -> NativeBridgeClient {
    NativeBridgeClient(timeout: timeout) { _, _ in json }
}

@MainActor
final class BudgetViewModelTests: XCTestCase {
    func testStartsLoadingThenShowsTheMonthLootCoreSent() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let model = BudgetViewModel(client: client(returning: json), month: "2026-03")
        XCTAssertEqual(model.state, .loading)
        await model.load()
        let expected = try JSONDecoder().decode(BudgetMonth.self, from: Data(json.utf8))
        // The screen renders loot-core's numbers as they are: no Swift totals
        XCTAssertEqual(model.state, .loaded(expected))
        XCTAssertEqual(expected.totals.toBudget, 140000)
    }

    func testAsksForTheVisibleMonthOnly() async throws {
        var seen: [(String, String)] = []
        let json = try fixtureJSON("budget-month-envelope")
        let model = BudgetViewModel(
            client: NativeBridgeClient { name, args in
                seen.append((name, args))
                return json
            }, month: "2026-03")
        await model.load()
        XCTAssertEqual(seen.count, 1)
        XCTAssertEqual(seen.first?.0, "native/budget-month")
        XCTAssertEqual(seen.first?.1, #"{"month":"2026-03"}"#)
    }

    func testABridgeErrorShowsTheErrorStateAndRetryRecovers() async throws {
        struct Boom: Error {}
        let json = try fixtureJSON("budget-month-envelope")
        var fail = true
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, _ in
                if fail { throw Boom() }
                return json
            }, month: "2026-03")
        await model.load()
        guard case .failed = model.state else { return XCTFail("expected failed, got \(model.state)") }
        fail = false
        await model.load()
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testATimeoutShowsTheErrorStateNotAnEndlessSpinner() async {
        let hanging = NativeBridgeClient(timeout: 0.1) { _, _ in
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
            return "{}"
        }
        let model = BudgetViewModel(client: hanging, month: "2026-03")
        await model.load()
        XCTAssertEqual(model.state, .failed(.timedOut))
    }

    // 1.3a: a tracking budget shows the web Budget screen until sc-3778 lands
    func testATrackingBudgetFallsBackToTheWebScreen() async throws {
        let model = BudgetViewModel(client: client(returning: try fixtureJSON("budget-month-tracking")), month: "2026-03")
        await model.load()
        XCTAssertEqual(model.state, .useWebScreen)
    }

    func testCurrentMonthIsYearDashMonth() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = DateComponents(calendar: calendar, year: 2026, month: 3, day: 9).date!
        XCTAssertEqual(BudgetViewModel.currentMonth(date, calendar: calendar), "2026-03")
    }
}

final class NativeScreenSwitchTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let suite = "NativeScreenSwitchTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }

    func testUnsetMeansTheWebScreen() {
        XCTAssertEqual(NativeScreenSwitch.screen(for: .budget, defaults: defaults()), .web)
    }

    func testOnMeansTheNativeScreenAndOffGoesBack() {
        let defaults = defaults()
        XCTAssertEqual(NativeScreenSwitch.key(for: .budget), "NativeScreen.budget")
        defaults.set(true, forKey: "NativeScreen.budget")
        XCTAssertEqual(NativeScreenSwitch.screen(for: .budget, defaults: defaults), .native)
        defaults.set(false, forKey: "NativeScreen.budget")
        XCTAssertEqual(NativeScreenSwitch.screen(for: .budget, defaults: defaults), .web)
    }

    func testOtherTabsStayWebWhileOnlyBudgetIsSwitchedOn() {
        let defaults = defaults()
        defaults.set(true, forKey: "NativeScreen.budget")
        XCTAssertEqual(NativeScreenSwitch.screen(for: .reports, defaults: defaults), .web)
    }
}

final class BudgetAmountFormatTests: XCTestCase {
    private let us = Locale(identifier: "en_US")

    func testFormatsMinorUnitsWithTheBudgetsDecimalPlaces() {
        XCTAssertEqual(BudgetAmountFormat.string(140000, decimalPlaces: 2, currencyCode: "", locale: us), "1,400.00")
        XCTAssertEqual(BudgetAmountFormat.string(-1250, decimalPlaces: 2, currencyCode: "", locale: us), "-12.50")
        XCTAssertEqual(BudgetAmountFormat.string(1500, decimalPlaces: 0, currencyCode: "", locale: us), "1,500")
    }

    func testUsesTheCurrencyWhenTheBudgetHasOne() {
        XCTAssertEqual(BudgetAmountFormat.string(140000, decimalPlaces: 2, currencyCode: "USD", locale: us), "$1,400.00")
    }

    func testAnAmountThatDoesNotApplyShowsNothing() {
        XCTAssertEqual(BudgetAmountFormat.string(nil, decimalPlaces: 2, currencyCode: "", locale: us), "")
    }
}
