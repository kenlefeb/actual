import XCTest

// Fork-only (sc-5247). When the page's process ends, the iPhone app reloads its
// own page, and after three reloads in a minute it asks. `-UITestPageDeaths`
// (UITestPageRecovery.swift, Debug builds only) reports the ends to the real
// recovery path; no process is killed here.
final class PageRecoveryUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(deaths: Int, startPath: String? = nil) {
        app.launchArguments = ["-UITestPageDeaths", String(deaths), "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let startPath { app.launchArguments += ["-UITestPageStartPath", startPath] }
        app.launch()
    }

    func testAOneTimeCallbackIsNotReloaded() {
        launch(deaths: 1, startPath: "/openid/callback?code=used")
        let report = app.staticTexts["uiTestPageRecovery"]
        XCTAssertTrue(report.waitForExistence(timeout: 60), "the page never finished loading")
        XCTAssertTrue(report.label.contains("before=/openid/callback?code=used"), report.label)
        let after = report.label.components(separatedBy: "after=").last ?? ""
        XCTAssertFalse(after.contains("openid"), report.label)
        XCTAssertFalse(after.contains("code="), report.label)
    }

    func testThreeReloadsDoNotAsk() {
        launch(deaths: 3)
        XCTAssertTrue(app.staticTexts["uiTestPageRecovery"].waitForExistence(timeout: 90))
        XCTAssertFalse(app.alerts["The budget page stopped working"].exists)
    }

    func testAFourthEndAsksAndReloadStartsOver() {
        launch(deaths: 4)
        let alert = app.alerts["The budget page stopped working"]
        XCTAssertTrue(alert.waitForExistence(timeout: 90), "no sheet after the fourth end")
        // On CI the first tap can have no effect: the recording shows the alert
        // fully on screen and untouched while the page behind it is still
        // starting. So tap again, and log how many it took.
        var taps = 0
        var result = XCTWaiter.Result.timedOut
        while taps < 5 && result != .completed {
            if alert.buttons["Reload"].isHittable {
                alert.buttons["Reload"].tap()
                taps += 1
            }
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: alert)
            result = XCTWaiter.wait(for: [gone], timeout: 4)
        }
        print("page recovery UI test: Reload took \(taps) tap(s)")
        XCTAssertEqual(result, .completed, "Reload did not dismiss the alert after \(taps) taps")
    }
}
