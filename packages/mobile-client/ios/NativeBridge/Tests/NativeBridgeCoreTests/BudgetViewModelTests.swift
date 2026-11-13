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

// The fixture as a handler would answer for `month`, with the given range, or
// without the fields as a server that predates them does (sc-3850)
private func fixtureJSON(_ name: String, month: String? = nil, range: (first: String, last: String)?) throws -> String {
    var object = try JSONSerialization.jsonObject(with: Data(try fixtureJSON(name).utf8)) as! [String: Any]
    if let month { object["month"] = month }
    object["firstMonth"] = range?.first
    object["lastMonth"] = range?.last
    return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
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

private final class Counter { var count = 0 }
private final class Gate { var continuation: CheckedContinuation<Void, Never>? }

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

    // 4.1 (sc-3778): a tracking budget renders natively, from the same shape
    func testATrackingBudgetLoadsWithTheTrackingTotalsAndNoToBudget() async throws {
        let json = try fixtureJSON("budget-month-tracking")
        let model = BudgetViewModel(client: client(returning: json), now: march9, calendar: utc)
        await model.load()
        let expected = try JSONDecoder().decode(BudgetMonth.self, from: Data(json.utf8))
        XCTAssertEqual(model.state, .loaded(expected))
        XCTAssertEqual(expected.budgetType, .tracking)
        XCTAssertNil(expected.totals.toBudget)
        XCTAssertEqual(expected.totals.budgetedIncome, 320000)
        XCTAssertEqual(expected.totals.saved, 180000)
    }

    // The layout follows the snapshot's budgetType on every read
    func testTheLayoutFollowsTheBudgetTypeOfEachRead() async throws {
        let envelope = try fixtureJSON("budget-month-envelope")
        let tracking = try fixtureJSON("budget-month-tracking")
        var reply = envelope
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in reply }, now: march9, calendar: utc)
        func type() -> BudgetMonth.BudgetType? { if case .loaded(let month) = model.state { return month.budgetType } else { return nil } }
        await model.load()
        XCTAssertEqual(type(), .envelope)
        reply = tracking
        await model.load()
        XCTAssertEqual(type(), .tracking)
        reply = envelope
        await model.load()
        XCTAssertEqual(type(), .envelope)
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

    // sc-3796: change events, foreground and background
    private func countingModel(_ json: String, timeout: TimeInterval = 1, reads: Counter) -> BudgetViewModel {
        BudgetViewModel(
            client: NativeBridgeClient(timeout: timeout) { _, _ in
                reads.count += 1
                return json
            }, now: march9, calendar: utc, changeInterval: 0.01)
    }

    private func settle() async { try? await Task.sleep(nanoseconds: 150_000_000) }

    func testAChangeEventRefreshesTheMonth() async throws {
        let reads = Counter()
        let model = countingModel(try fixtureJSON("budget-month-envelope"), reads: reads)
        await model.load()
        model.changeEventReceived()
        await settle()
        XCTAssertEqual(reads.count, 2)
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testABurstInOneFrameReadsOnce() async throws {
        let reads = Counter()
        let model = countingModel(try fixtureJSON("budget-month-envelope"), reads: reads)
        await model.load()
        for _ in 0..<5 { model.changeEventReceived() }
        await settle()
        XCTAssertEqual(reads.count, 2)
    }

    func testNoReadWhileTheSceneIsInactiveAndOneOnBecomingActive() async throws {
        let reads = Counter()
        let model = countingModel(try fixtureJSON("budget-month-envelope"), reads: reads)
        await model.load()
        await model.setSceneActive(false)
        model.changeEventReceived()
        model.changeEventReceived()
        await settle()
        XCTAssertEqual(reads.count, 1)
        await model.setSceneActive(true)
        XCTAssertEqual(reads.count, 2)
        // Already active: no second read
        await model.setSceneActive(true)
        XCTAssertEqual(reads.count, 2)
    }

    // 6.2 and the design: a refresh that times out keeps the last good numbers
    // (the view dims them and offers a retry) instead of replacing them
    func testARefreshThatTimesOutKeepsTheLastGoodNumbers() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        var hang = false
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 0.1) { _, _ in
                if hang { await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in } }
                return json
            }, now: march9, calendar: utc, changeInterval: 0.01)
        await model.load()
        guard case .loaded(let good) = model.state else { return XCTFail("expected loaded, got \(model.state)") }
        hang = true
        model.changeEventReceived()
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(model.state, .stale(good, .timedOut))
        XCTAssertTrue(BudgetLoadError.timedOut.canRetry)
        // The retry brings the numbers back
        hang = false
        await model.load()
        XCTAssertEqual(model.state, .loaded(good))
    }

    func testATimeoutWithNothingLoadedYetShowsTheErrorView() async {
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 0.1) { _, _ in
                await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
                return ""
            }, now: march9, calendar: utc)
        await model.load()
        XCTAssertEqual(model.state, .failed(.timedOut))
    }

    // Numbers for last month must not stay under the new month's title
    func testAFailureAfterTheMonthRolledOverDoesNotKeepLastMonthsNumbers() async throws {
        let json = try fixtureJSON("budget-month-envelope")
        var fail = false
        var now = day(2026, 3, 31)
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, _ in
                if fail { throw NativeBridgeError.timedOut("native/budget-month") }
                return json
            }, now: { now() }, calendar: utc)
        await model.load()
        fail = true
        now = day(2026, 4, 1)
        await model.load()
        XCTAssertEqual(model.state, .failed(.timedOut))
    }

    // Two reads can overlap (an event while a load is in flight); the older
    // answer must not overwrite the newer one
    func testAnOlderReadFinishingLastDoesNotOverwriteANewerOne() async throws {
        let older = try fixtureJSON("budget-month-envelope")
        let newer = try fixtureJSON("budget-month-envelope-jpy")
        let gate = Gate()
        var calls = 0
        let model = BudgetViewModel(
            client: NativeBridgeClient(timeout: 5) { _, _ in
                calls += 1
                if calls == 1 {
                    await withCheckedContinuation { gate.continuation = $0 }
                    return older
                }
                return newer
            }, now: march9, calendar: utc)
        let first = Task { await model.load() }
        try await waitUntil("the first load reached its gate") { gate.continuation != nil }
        await model.load()
        gate.continuation?.resume()
        await first.value
        guard case .loaded(let shown) = model.state else { return XCTFail("expected loaded, got \(model.state)") }
        XCTAssertEqual(shown.currencyCode, "JPY")
    }

    func testCurrentMonthIsYearDashMonth() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = DateComponents(calendar: calendar, year: 2026, month: 3, day: 9).date!
        XCTAssertEqual(BudgetViewModel.currentMonth(date, calendar: calendar), "2026-03")
    }
}

// native-budget-screen spec (sc-3760, sc-3850): month navigation. Every read
// carries the budget's first and last month, so the edges are known from the
// first load; a server that sends no range keeps the older behaviour.
@MainActor
final class BudgetMonthNavigationTests: XCTestCase {
    // The months the fake budget really has, and the range the fake handler
    // reports (nil: a server that predates the fields)
    private final class Budget {
        var first: String
        var last: String
        var advertised: (first: String, last: String)?
        init(_ first: String, _ last: String, advertise: Bool = true) {
            self.first = first
            self.last = last
            advertised = advertise ? (first, last) : nil
        }
    }

    // A budget that has months first...last, like createAllBudgets' range
    private func rangedClient(_ budget: Budget, reads: @escaping (String) -> Void) -> NativeBridgeClient {
        NativeBridgeClient { _, args in
            let month = String(args.dropFirst(10).prefix(7))  // {"month":"2026-03"}
            reads(month)
            if month < budget.first || month > budget.last {
                throw NSError(
                    domain: "WKErrorDomain", code: 4,
                    userInfo: ["WKJavaScriptExceptionMessage": "Error: native/budget-month: no budget for month \(month)"])
            }
            return try fixtureJSON("budget-month-envelope", month: month, range: budget.advertised)
        }
    }

    private func model(_ budget: Budget, reads: @escaping (String) -> Void = { _ in }) -> BudgetViewModel {
        BudgetViewModel(client: rangedClient(budget, reads: reads), now: march9, calendar: utc)
    }

    private func model(_ first: String = "2026-01", _ last: String = "2026-05", reads: @escaping (String) -> Void = { _ in }) -> BudgetViewModel {
        model(Budget(first, last), reads: reads)
    }

    func testOpeningOnTheFirstMonthDisablesPreviousWithNoStepSent() async {
        var seen: [String] = []
        let model = model("2026-03", "2026-05") { seen.append($0) }
        await model.load()
        XCTAssertFalse(model.canGoPrevious)
        XCTAssertTrue(model.canGoNext)
        XCTAssertEqual(model.pickerMonths.first, "2026-03")
        await model.previous()
        XCTAssertEqual(seen, ["2026-03"])
    }

    func testOpeningOnTheLastMonthDisablesNext() async {
        let model = model("2026-01", "2026-03")
        await model.load()
        XCTAssertFalse(model.canGoNext)
        XCTAssertTrue(model.canGoPrevious)
        XCTAssertEqual(model.pickerMonths.last, "2026-03")
    }

    func testAMonthInTheMiddleHasBothControlsAndThePickerIsTheWholeRange() async {
        let model = model("2025-11", "2026-04")
        await model.load()
        XCTAssertTrue(model.canGoPrevious)
        XCTAssertTrue(model.canGoNext)
        XCTAssertEqual(model.pickerMonths, ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"])
    }

    func testALongRangeIsOfferedWholeWithoutAWindow() async {
        let model = model("2016-01", "2027-03")
        await model.load()
        XCTAssertEqual(model.pickerMonths.count, 135)
        XCTAssertEqual(model.pickerMonths.first, "2016-01")
    }

    func testALaterMonthIsOfferedAfterTheNextReadWithNoRelaunch() async {
        let budget = Budget("2026-01", "2026-03")
        let model = model(budget)
        await model.load()
        XCTAssertFalse(model.canGoNext)
        budget.last = "2026-05"
        budget.advertised = (budget.first, "2026-05")
        await model.load()  // a cells-changed re-read, a pull to refresh or the tab showing again
        XCTAssertTrue(model.canGoNext)
        XCTAssertEqual(model.pickerMonths.last, "2026-05")
    }

    func testAFailedReadKeepsTheLastRange() async {
        struct Boom: Error {}
        var fail = false
        let json = try! fixtureJSON("budget-month-envelope", range: ("2026-03", "2026-05"))
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, _ in
                if fail { throw Boom() }
                return json
            }, now: march9, calendar: utc)
        await model.load()
        fail = true
        await model.load()
        guard case .stale = model.state else { return XCTFail("expected stale, got \(model.state)") }
        XCTAssertFalse(model.canGoPrevious)
        XCTAssertEqual(model.pickerMonths, ["2026-03", "2026-04", "2026-05"])
    }

    func testWithoutARangeTheControlsStayEnabledAndThePickerIsAWindow() async {
        let model = model(Budget("2026-01", "2026-05", advertise: false))
        await model.load()
        XCTAssertTrue(model.canGoPrevious)
        XCTAssertTrue(model.canGoNext)
        XCTAssertEqual(model.pickerMonths.count, 37)
        XCTAssertEqual(model.pickerMonths.first, "2024-03")
        XCTAssertEqual(model.pickerMonths.last, "2027-03")
    }

    func testARefusedStepWithoutARangeIsNotRemembered() async {
        var seen: [String] = []
        let budget = Budget("2026-01", "2026-05", advertise: false)
        let model = model(budget) { seen.append($0) }
        await model.select("2026-01")
        await model.previous()  // refused: the budget has nothing before 2026-01
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertTrue(model.canGoPrevious)
        XCTAssertTrue(model.pickerMonths.contains("2025-12"))
        let reads = seen.count
        await model.previous()  // asked again, not skipped
        XCTAssertEqual(seen.count, reads + 1)
        // A later read that has the range decides afresh
        budget.advertised = ("2026-01", "2026-05")
        await model.load()
        XCTAssertFalse(model.canGoPrevious)
    }

    func testAStepRefusedDespiteARangeKeepsTheMonthAndTheNextReadRefreshesTheRange() async {
        // The range says 2025-12 exists but the budget has lost it (a race)
        let budget = Budget("2026-01", "2026-05")
        budget.advertised = ("2025-12", "2026-05")
        let model = model(budget)
        await model.select("2026-01")
        let before = model.state
        await model.previous()
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(model.state, before)
        budget.advertised = ("2026-01", "2026-05")
        await model.load()
        XCTAssertFalse(model.canGoPrevious)
    }

    func testSteppingBackThreeMonthsReadsEachMonthOnce() async throws {
        var seen: [String] = []
        let model = model("2025-01", "2026-05") { seen.append($0) }
        await model.load()
        await model.previous()
        await model.previous()
        await model.previous()
        XCTAssertEqual(model.month, "2025-12")
        XCTAssertEqual(seen, ["2026-03", "2026-02", "2026-01", "2025-12"])
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testNextStepsForwardAcrossAYear() async throws {
        let model = model("2026-01", "2027-02")
        await model.select("2026-12")
        await model.next()
        XCTAssertEqual(model.month, "2027-01")
    }

    func testPreviousAtTheFirstMonthStaysPutAndMakesNoRead() async throws {
        var seen: [String] = []
        let model = model("2026-01", "2026-05") { seen.append($0) }
        await model.select("2026-01")
        XCTAssertFalse(model.canGoPrevious)
        let reads = seen.count
        await model.previous()
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen.count, reads)
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testNextAtTheLastMonthStaysPut() async throws {
        let model = model("2026-01", "2026-05")
        await model.select("2026-05")
        await model.next()
        XCTAssertEqual(model.month, "2026-05")
        XCTAssertFalse(model.canGoNext)
        XCTAssertTrue(model.canGoPrevious)
    }

    func testThePickerReadsTheChosenMonthOnce() async throws {
        var seen: [String] = []
        let model = model { seen.append($0) }
        await model.select("2026-01")
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen, ["2026-01"])
    }

    func testThePickerRefusesAMonthOutsideTheRangeWithoutARead() async throws {
        var seen: [String] = []
        let model = model("2026-01", "2026-05") { seen.append($0) }
        await model.select("2026-01")
        XCTAssertFalse(model.pickerMonths.contains("2025-12"))
        let reads = seen.count
        await model.select("2025-06")
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen.count, reads)
    }

    func testTheVisibleMonthSurvivesLeavingTheTab() async throws {
        var seen: [String] = []
        let model = model { seen.append($0) }
        await model.load()
        await model.previous()
        await model.previous()
        // The tab showing again calls load(): same month, not the current one
        await model.load()
        XCTAssertEqual(model.month, "2026-01")
        XCTAssertEqual(seen.last, "2026-01")
    }

    // Taps do not wait for the read before them: the last tap wins, and a slow
    // earlier read must not put an older month back on screen.
    func testASlowEarlierReadDoesNotOverwriteALaterTap() async throws {
        let json = try fixtureJSON("budget-month-envelope", range: nil)
        var slow: CheckedContinuation<Void, Never>?
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, args in
                if args == #"{"month":"2026-02"}"# {
                    await withCheckedContinuation { slow = $0 }
                }
                return json
            }, now: march9, calendar: utc)
        await model.load()
        async let first: Void = model.select("2026-02")
        try await waitUntil("the 2026-02 read was held") { slow != nil }
        await model.select("2026-04")
        slow?.resume()
        await first
        XCTAssertEqual(model.month, "2026-04")
    }

    func testTwoQuickPreviousTapsStepTwoMonths() async throws {
        let json = try fixtureJSON("budget-month-envelope", range: nil)
        var gate: CheckedContinuation<Void, Never>?
        let model = BudgetViewModel(
            client: NativeBridgeClient { _, args in
                if args == #"{"month":"2026-02"}"# {
                    await withCheckedContinuation { gate = $0 }
                }
                return json
            }, now: march9, calendar: utc)
        await model.load()
        async let first: Void = model.previous()
        try await waitUntil("the 2026-02 read was held") { gate != nil }
        await model.previous()  // the 2026-02 read is still in flight
        gate?.resume()
        await first
        XCTAssertEqual(model.month, "2026-01")
    }

    func testATimeoutOnAStepShowsRetryForThatMonth() async throws {
        let json = try fixtureJSON("budget-month-envelope", range: nil)
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
        XCTAssertTrue(NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost").contains(#"window.__actualNativeScreens = {"budget": false};"#))
        defaults.set(true, forKey: "NativeScreen.budget")
        XCTAssertTrue(NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost").contains(#"window.__actualNativeScreens = {"budget": true};"#))
    }
}
