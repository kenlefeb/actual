import XCTest

// Fork-only (sc-5496, native-budget-opened-signal). "A slow open is testable":
// on a page built with FORK_TEST_HOOKS=true and FORK_TEST_SLOW_OPEN_MS=6000 (above
// the engine's 4 s open wait), opening the demo budget makes the native Accounts
// list's first read be refused, and the list must still load with no tap on Retry.
// Skips unless the runner sets TEST_RUNNER_SLOW_OPEN=1; the page is a Debug
// simulator build's only (a Release or archive build refuses it, check-release-page.sh).
final class SlowOpenUITests: XCTestCase {
    private let app = XCUIApplication()

    func testAccountsLoadsWithNoTapOnRetryDuringASlowOpen() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SLOW_OPEN"] == "1", "needs TEST_RUNNER_SLOW_OPEN=1 and a slow-open page")
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()

        let accounts = app.tabBars.buttons["Accounts"]
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        let deadline = Date().addingTimeInterval(180)
        while !accounts.exists && !demo.exists && Date() < deadline { sleep(1) }
        let tapped = Date()
        if !accounts.exists { demo.tap() }
        XCTAssertTrue(accounts.waitForExistence(timeout: 120), "the demo budget did not open")
        accounts.tap()

        // The list's header, from loot-core's own sections (the fixture test reads the same text)
        let list = app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", "On Budget")).firstMatch
        let retry = app.buttons["Retry"]
        var sawRetry = false
        let listDeadline = Date().addingTimeInterval(60)
        while !list.exists && Date() < listDeadline {
            if retry.exists { sawRetry = true }
            usleep(200_000)
        }
        XCTAssertTrue(list.exists, "the Accounts list never loaded and nothing tapped Retry; Retry showed = \(sawRetry)")
        print(String(format: "slow open evidence: Accounts list loaded %.1f s after the demo tap; Retry was shown = %@; never tapped",
                     Date().timeIntervalSince(tapped), sawRetry ? "yes" : "no"))
    }
}
