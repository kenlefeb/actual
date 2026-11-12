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

private var utc: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

private func day(_ year: Int, _ month: Int, _ day: Int) -> () -> Date {
    let date = DateComponents(calendar: utc, year: year, month: month, day: day).date!
    return { date }
}

private let march9 = day(2026, 3, 9)

private func client(returning json: String, timeout: TimeInterval = 1) -> NativeBridgeClient {
    NativeBridgeClient(timeout: timeout) { _, _ in json }
}

@MainActor
final class BudgetViewModelTests: XCTestCase {
    func testStartsLoadingThenShowsTheMonthLootCoreSent() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        let model = BudgetViewModel(client: client(returning: json), now: march9, calendar: utc)
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
            }, now: march9, calendar: utc)
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
            }, now: march9, calendar: utc)
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
        let model = BudgetViewModel(client: hanging, now: march9, calendar: utc)
        await model.load()
        XCTAssertEqual(model.state, .failed(.timedOut))
    }

    // 1.3a: a tracking budget shows the web Budget screen until sc-3778 lands
    func testATrackingBudgetFallsBackToTheWebScreen() async throws {
        let model = BudgetViewModel(client: client(returning: try fixtureJSON("budget-month-tracking")), now: march9, calendar: utc)
        await model.load()
        XCTAssertEqual(model.state, .useWebScreen)
    }

    // The real handler throws this text (app.ts); WebKit wraps it in an NSError
    private let noBudgetError = NSError(
        domain: "WKErrorDomain", code: 4,
        userInfo: [
            NSLocalizedDescriptionKey: "A JavaScript exception occurred",
            "WKJavaScriptExceptionMessage": "Error: native/budget-month: no budget for month 2026-03",
        ])

    func testAMonthWithNoBudgetShowsAnEmptyStateNotARetry() async {
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in throw self.noBudgetError }, now: march9, calendar: utc)
        await model.load()
        XCTAssertEqual(model.state, .failed(.noBudgetForMonth))
        XCTAssertFalse(BudgetLoadError.noBudgetForMonth.canRetry)
        XCTAssertTrue(BudgetLoadError.timedOut.canRetry)
        XCTAssertTrue(BudgetLoadError.other.canRetry)
    }

    func testErrorsReadAsPlainSentences() {
        for error in [BudgetLoadError.timedOut, .noBudgetForMonth, .other] {
            XCTAssertFalse(error.message.isEmpty)
            XCTAssertFalse(error.message.contains("Error Domain"))
            XCTAssertFalse(error.message.contains("native/budget-month"))
            XCTAssertTrue(error.message.hasSuffix("."))
        }
    }

    func testAnUnexpectedErrorShowsThePlainMessage() async {
        struct Boom: Error {}
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in throw Boom() }, now: march9, calendar: utc)
        await model.load()
        XCTAssertEqual(model.state, .failed(.other))
    }

    // The month is read again on each load, so an app left open over midnight
    // on the last day of a month shows the new month
    func testAReloadAfterTheMonthRollsOverAsksForTheNewMonth() async throws {
        var seen: [String] = []
        var now = day(2026, 10, 31)
        let json = try fixtureJSON("budget-month-envelope")
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, args in
                seen.append(args)
                return json
            }, now: { now() }, calendar: utc)
        await model.load()
        XCTAssertEqual(model.month, "2026-10")
        now = day(2026, 11, 1)
        await model.load()
        XCTAssertEqual(model.month, "2026-11")
        XCTAssertEqual(seen, [#"{"month":"2026-10"}"#, #"{"month":"2026-11"}"#])
    }

    func testCurrentMonthIsYearDashMonth() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = DateComponents(calendar: calendar, year: 2026, month: 3, day: 9).date!
        XCTAssertEqual(BudgetViewModel.currentMonth(date, calendar: calendar), "2026-03")
    }
}

// native-budget-screen spec (sc-3760): month navigation. The budget's range
// is not listed anywhere handler-free, so loot-core's own "no budget for
// month" answer is the edge: a step into it reads once, fails, and the screen
// stays where it was.
@MainActor
final class BudgetMonthNavigationTests: XCTestCase {
    // A budget that has months first...last, like createAllBudgets' range
    private func rangedClient(_ first: String, _ last: String, reads: @escaping (String) -> Void) throws -> NativeBridgeClient {
        let json = try fixtureJSON("budget-month-envelope")
        return NativeBridgeClient { _, args in
            let month = String(args.dropFirst(10).prefix(7))  // {"month":"2026-03"}
            reads(month)
            if month < first || month > last {
                throw NSError(
                    domain: "WKErrorDomain", code: 4,
                    userInfo: ["WKJavaScriptExceptionMessage": "Error: native/budget-month: no budget for month \(month)"])
            }
            return json
        }
    }

    private func model(_ first: String = "2026-01", _ last: String = "2026-05", reads: @escaping (String) -> Void = { _ in }) throws -> BudgetViewModel {
        BudgetViewModel(client: try rangedClient(first, last, reads: reads), now: march9, calendar: utc)
    }

    func testSteppingBackThreeMonthsReadsEachMonthOnce() async throws {
        var seen: [String] = []
        let model = try model("2025-01", "2026-05") { seen.append($0) }
        await model.load()
        await model.previous()
        await model.previous()
        await model.previous()
        XCTAssertEqual(model.month, "2025-12")
        XCTAssertEqual(seen, ["2026-03", "2026-02", "2026-01", "2025-12"])
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testNextStepsForwardAcrossAYear() async throws {
        let model = try model("2026-01", "2027-02")
        await model.select("2026-12")
        await model.next()
        XCTAssertEqual(model.month, "2027-01")
    }

    func testPreviousAtTheFirstMonthStaysPutAndThenMakesNoRead() async throws {
        var seen: [String] = []
        let model = try model("2026-01", "2026-05") { seen.append($0) }
        await model.select("2026-01")
        XCTAssertTrue(model.canGoPrevious)  // the edge is only learned by asking
        await model.previous()
        XCTAssertEqual(model.month, "2026-01")
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
        XCTAssertFalse(model.canGoPrevious)
        XCTAssertTrue(model.canGoNext)
        let reads = seen.count
        await model.previous()
        XCTAssertEqual(seen.count, reads)
    }

    func testNextAtTheLastMonthStaysPut() async throws {
        let model = try model("2026-01", "2026-05")
        await model.select("2026-05")
        await model.next()
        XCTAssertEqual(model.month, "2026-05")
        XCTAssertFalse(model.canGoNext)
        XCTAssertTrue(model.canGoPrevious)
    }

    func testThePickerReadsTheChosenMonthOnce() async throws {
        var seen: [String] = []
        let model = try model { seen.append($0) }
        await model.select("2026-01")
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen, ["2026-01"])
    }

    func testThePickerOffersNoMonthBeyondAnEdgeAndRefusesItWithoutARead() async throws {
        var seen: [String] = []
        let model = try model("2026-01", "2026-05") { seen.append($0) }
        await model.select("2026-01")
        XCTAssertTrue(model.pickerMonths.contains("2025-12"))  // not known yet
        await model.previous()  // learns 2025-12 does not exist
        XCTAssertFalse(model.pickerMonths.contains("2025-12"))
        XCTAssertFalse(model.pickerMonths.contains("2025-06"))
        XCTAssertTrue(model.pickerMonths.contains("2026-01"))
        let reads = seen.count
        await model.select("2025-06")
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen.count, reads)
    }

    func testAMonthOutsideTheRangeKeepsTheLastGoodNumbers() async throws {
        let model = try model("2026-01", "2026-05")
        await model.select("2026-01")
        let before = model.state
        await model.previous()
        XCTAssertEqual(model.state, before)
    }

    func testTheVisibleMonthSurvivesLeavingTheTab() async throws {
        var seen: [String] = []
        let model = try model { seen.append($0) }
        await model.load()
        await model.previous()
        await model.previous()
        // The tab showing again calls load(): same month, not the current one
        await model.load()
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen.last, "2026-01")
    }

    func testATimeoutOnAStepShowsRetryForThatMonth() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        var hang = false
        var seen: [String] = []
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 0.1) { _, args in
                seen.append(args)
                if hang {
                    await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
                }
                return json
            }, now: march9, calendar: utc)
        await model.load()
        hang = true
        await model.previous()
        XCTAssertEqual(model.month, "2026-02")
        XCTAssertEqual(model.state, .failed(.timedOut))
        hang = false
        await model.load()  // the retry button
        XCTAssertEqual(seen.last, #"{"month":"2026-02"}"#)
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
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

final class BudgetAmountStyleTests: XCTestCase {
    private func style(
        _ code: String = "", symbol: String = "", places: Int = 2, position: BudgetMonth.SymbolPosition = .before,
        space: Bool = false, format: BudgetMonth.NumberFormat = .commaDot, hideFraction: Bool = false
    ) -> BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: code, currencySymbol: symbol, decimalPlaces: places, symbolPosition: position,
            symbolSpace: space, numberFormat: format, hideFraction: hideFraction)
    }

    func testANegativeAmountWithACurrency() {
        XCTAssertEqual(BudgetAmountFormat.string(-1250, style: style("USD", symbol: "$")), "-$12.50")
    }

    func testNumberFormatsLikeTheWeb() {
        XCTAssertEqual(BudgetAmountFormat.string(140000, style: style(format: .dotComma)), "1.400,00")
        XCTAssertEqual(BudgetAmountFormat.string(140000, style: style(format: .spaceComma)), "1\u{202F}400,00")
        XCTAssertEqual(BudgetAmountFormat.string(123_456_789, style: style(format: .apostropheDot)), "1\u{2019}234\u{2019}567.89")
        XCTAssertEqual(BudgetAmountFormat.string(12_345_678_900, style: style(format: .commaDotIn)), "12,34,56,789.00")
    }

    func testHideFractionShowsWholeUnits() {
        XCTAssertEqual(BudgetAmountFormat.string(140000, style: style(hideFraction: true)), "1,400")
        XCTAssertEqual(BudgetAmountFormat.string(-140050, style: style("USD", symbol: "$", hideFraction: true)), "-$1,401")
    }

    func testSymbolAfterWithAThinSpace() {
        let yen = style("JPY", symbol: "¥", places: 0, position: .after, space: true, format: .dotComma)
        XCTAssertEqual(BudgetAmountFormat.string(140000, style: yen), "140.000\u{202F}¥")
        XCTAssertEqual(BudgetAmountFormat.string(-1500, style: yen), "-1.500\u{202F}¥")
    }

    func testNoCurrencyShowsNoSymbol() {
        XCTAssertEqual(BudgetAmountFormat.string(5, style: style(symbol: "x")), "0.05")
        XCTAssertEqual(BudgetAmountFormat.string(nil, style: style()), "")
        XCTAssertEqual(BudgetAmountFormat.string(0, style: style()), "0.00")
    }

    func testTheJPYFixtureDecodesAndFormatsWithZeroDecimals() throws {
        let month = try JSONDecoder().decode(BudgetMonth.self, from: Data(try fixtureJSON("budget-month-envelope-jpy").utf8))
        XCTAssertEqual(month.currencyCode, "JPY")
        XCTAssertEqual(month.currencyDecimalPlaces, 0)
        XCTAssertEqual(BudgetAmountFormat.string(month.totals.toBudget, style: month.amountStyle), "140.000\u{202F}¥")
    }

    func testTonesFollowTheSign() {
        XCTAssertEqual(BudgetAmountFormat.tone(-1), .negative)
        XCTAssertEqual(BudgetAmountFormat.tone(1), .positive)
        XCTAssertEqual(BudgetAmountFormat.tone(0), .zero)
        XCTAssertEqual(BudgetAmountFormat.tone(nil), .zero)
    }
}

final class BudgetGroupsTests: XCTestCase {
    func testIncomeIsSeparateFromExpenseGroupsAndHiddenRowsAreLeftOut() throws {
        let month = try JSONDecoder().decode(BudgetMonth.self, from: Data(try fixtureJSON("budget-month-envelope").utf8))
        XCTAssertEqual(month.incomeGroups.map(\.name), ["Income"])
        XCTAssertEqual(month.expenseGroups.map(\.name), ["Bills"])
        // Power is hidden in the fixture
        XCTAssertEqual(month.expenseGroups.first?.visibleCategories.map(\.name), ["Rent"])
    }
}

final class NativeScreensScriptTests: XCTestCase {
    // After a toggle and a page reload the script must say what is on now
    func testTheScriptFollowsTheSwitchNotTheValueAtLaunch() {
        let suite = "NativeScreensScriptTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(NativeScreensScript.source(defaults: defaults), #"window.__actualNativeScreens = {"budget": false};"#)
        defaults.set(true, forKey: "NativeScreen.budget")
        XCTAssertEqual(NativeScreensScript.source(defaults: defaults), #"window.__actualNativeScreens = {"budget": true};"#)
    }
}
