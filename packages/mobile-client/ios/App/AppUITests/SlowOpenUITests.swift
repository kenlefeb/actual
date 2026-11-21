import XCTest

// Fork-only (sc-5496, native-budget-opened-signal). "A slow open is testable".
// On a page built with FORK_TEST_HOOKS=true and FORK_TEST_SLOW_OPEN_MS=10000 (above the
// engine's 4 s open wait, by enough that Retry stays up for seconds), the native Budget
// screen loads after the first open (a native screen exists only once a budget is open).
// Then the page's process is ended through the app's real recovery path
// (-UITestPageDeaths): the tab bar stays, the new page reopens the budget slowly, and the
// read the Budget screen makes during that open is refused. The test shows that sequence:
// Retry over the numbers the screen kept (after the engine's 4 s wait), then Retry going
// away with no tap, not before the open could finish. It fails loudly when the hook is
// absent: with no slow open there is no Retry.
//
// What it does NOT show: that the budget-opened signal did it. A screen that already shows
// numbers (stale) ignores the signal by design and also re-reads on the change events the
// open sends, and no native screen can be first created during an open on the iPhone (the
// tab bar waits for the open), so a control that drops only the signal still recovers. The
// signal's own proof is the view-model unit tests (BudgetOpenedTests) and the Mac slow-open
// test, whose screen has no numbers and is wired to the signal alone, with a control.
// Skips unless the runner sets TEST_RUNNER_SLOW_OPEN=1; the hooks page is a Debug simulator
// build's only (check-release-page.sh refuses it in a Release build).
final class SlowOpenUITests: XCTestCase {
    private let app = XCUIApplication()
    private let delay: TimeInterval = 10  // FORK_TEST_SLOW_OPEN_MS=10000
    private var numbers: XCUIElement { app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "To budget")).firstMatch }
    private var retry: XCUIElement { app.buttons["Retry"] }

    private func poll(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            usleep(100_000)
        }
        return condition()
    }

    func testASlowReopenRefusesTheReadAndRetryGoesAwayWithNoTap() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SLOW_OPEN"] == "1", "needs TEST_RUNNER_SLOW_OPEN=1 and a slow-open page")
        continueAfterFailure = false
        // The page ends 20 s after it starts, well after the first slow open is over
        app.launchArguments = ["-UITestPageDeaths", "1", "-UITestPageDeathDelay", "20", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        if !poll(60, { numbers.exists || demo.exists }) { XCTFail("neither a budget nor the demo showed") }
        if demo.exists && !numbers.exists { demo.tap() }
        XCTAssertTrue(numbers.waitForExistence(timeout: 120), "the Budget screen never loaded after the first open")
        XCTAssertFalse(retry.exists, "Retry showed before the page ended")

        // The page ends and reopens the budget slowly. The refusal is visible first
        XCTAssertTrue(poll(120) { retry.exists }, "no Retry: the read was never refused, so the slow open is not in effect")
        let refused = Date()
        // Then Retry goes by itself (no tap), and not before the open could finish
        XCTAssertTrue(poll(60) { !retry.exists }, "Retry never went away without a tap")
        let recoveredAfter = Date().timeIntervalSince(refused)
        XCTAssertGreaterThanOrEqual(recoveredAfter, delay - 4 - 2, "Retry went away before the \(Int(delay)) s open could finish")
        XCTAssertTrue(numbers.exists, "the numbers are gone after the recovery")
        print(String(format: "slow open evidence (iPhone): Retry seen after the 4 s open wait; gone %.1f s later (open of %.0f s), no tap on Retry", recoveredAfter, delay))
    }
}
