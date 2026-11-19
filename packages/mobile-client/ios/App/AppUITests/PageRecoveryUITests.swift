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

    // sc-5220
    private var notice: XCUIElement { app.staticTexts["pageNotice.text"] }
    private static let noticeText =
        "The app restarted just now, so your last change may not have been saved. Check it, and make it again if it’s missing."

    private func disappears(_ element: XCUIElement, within timeout: TimeInterval) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    func testAnAutomaticReloadShowsTheNoticeAndDismissRemovesIt() {
        launch(deaths: 1)
        XCTAssertTrue(notice.waitForExistence(timeout: 60), "no notice after the reload")
        XCTAssertEqual(notice.label, Self.noticeText)
        let dismiss = app.buttons["pageNotice.dismiss"]
        XCTAssertEqual(dismiss.label, "Dismiss this notice")
        XCTAssertGreaterThanOrEqual(dismiss.frame.height, 44)
        dismiss.tap()
        XCTAssertTrue(disappears(notice, within: 3), "Dismiss left the notice up")
    }

    // The Designer's review of PR 489: the strip takes touches, so it must not
    // lie over a sheet's top bar
    func testASheetOpenedUnderTheNoticeStartsBelowIt() {
        app.launchArguments = ["-UITestPageDeaths", "1", "-UITestPageNoticeSheet", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let cancel = app.buttons["uiTestSheet.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 60), "the sheet never opened")
        XCTAssertTrue(notice.exists, "the notice should still show")
        // The sheet gets its room on the next look, within a moment
        sleep(1)
        let stripBottom = max(notice.frame.maxY, app.buttons["pageNotice.dismiss"].frame.maxY)
        XCTAssertGreaterThanOrEqual(cancel.frame.minY, stripBottom, "the strip covers the sheet's Cancel")
        cancel.tap()
        XCTAssertTrue(disappears(cancel, within: 3), "Cancel under the strip did not get the tap")
    }

    func testTheNoticeHidesByItself() {
        launch(deaths: 1)
        XCTAssertTrue(notice.waitForExistence(timeout: 60))
        XCTAssertTrue(disappears(notice, within: 25), "the notice stayed")
    }

    func testAPlainLaunchShowsNoNotice() {
        launch(deaths: 0, startPath: "/")
        XCTAssertTrue(app.staticTexts["uiTestPageRecoveryReady"].waitForExistence(timeout: 60))
        XCTAssertFalse(notice.exists)
    }

    func testThreeReloadsDoNotAsk() {
        launch(deaths: 3)
        XCTAssertTrue(app.staticTexts["uiTestPageRecovery"].waitForExistence(timeout: 90))
        XCTAssertFalse(app.alerts["The app stopped working"].exists)
    }

    func testAFourthEndAsksAndReloadStartsOver() {
        launch(deaths: 4)
        let alert = app.alerts["The app stopped working"]
        XCTAssertTrue(alert.waitForExistence(timeout: 90), "no sheet after the fourth end")
        // By label: an element query by string is limited to 128 characters
        let message = "Reload to open it again. A change you made in the last moment may not have been saved. Check it, and make it again if it’s missing."
        XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "label == %@", message)).firstMatch.exists, "the alert's message changed")
        XCTAssertFalse(notice.exists, "the alert replaces the notice")
        // sc-5287: on CI the first tap can have no effect. The recording shows the
        // alert fully on screen and untouched while the page behind it is still
        // starting. So allow one more tap, and log how many it took.
        var taps = 0
        var waits = 0
        var result = XCTWaiter.Result.timedOut
        while taps < 2 && waits < 6 && result != .completed {
            if alert.buttons["Reload"].isHittable {
                alert.buttons["Reload"].tap()
                taps += 1
            }
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: alert)
            result = XCTWaiter.wait(for: [gone], timeout: 4)
            waits += 1
        }
        print("page recovery UI test: Reload took \(taps) tap(s)")
        XCTAssertEqual(result, .completed, "Reload did not dismiss the alert after \(taps) taps")
        XCTAssertFalse(notice.waitForExistence(timeout: 5), "the person's own Reload shows no notice")
    }
}
