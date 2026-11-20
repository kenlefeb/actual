import XCTest

// Fork-only (sc-5219, Security's ruling as the Designer revised it). "A page
// without the guard confirms no write" and "A mismatch Reload didn't fix is told
// once with OK", seen in the running app, run by hand: skips unless the runner
// sets TEST_RUNNER_UNGUARDED to
//   off | missing   a Debug build: `-UITestPageUnguarded` (NativeChromePlugin.swift)
//                   loads the page without the guard while the shell stays opted in
//   page            any build, Release included, with a staged test page built with
//                   FORK_TEST_HOOKS and FORK_TEST_PAGE_UNGUARDED (a Release build
//                   needs FORK_RELEASE_SMOKE_TEST_PAGE=YES to bundle it)
// With TEST_RUNNER_UNGUARDED_KILL=1 it prints "kill the page now" and the runner
// ends the page process, so the next page load can be checked for no notice.
// TEST_RUNNER_UNGUARDED_RUN names the screenshot folder; TEST_RUNNER_UNGUARDED_LOOK
// is "light", "dark" or "ax5".
final class UnguardedPageUITests: XCTestCase {
    private let app = XCUIApplication()
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var mode: String { env["UNGUARDED"] ?? "" }
    private var run: String { env["UNGUARDED_RUN"] ?? "run" }
    private var look: String { env["UNGUARDED_LOOK"] ?? "light" }
    private var strip: XCUIElement { app.staticTexts["pageNotice.text"] }
    private var button: XCUIElement { app.buttons["pageNotice.dismiss"] }
    private var line: XCUIElement { app.staticTexts["storage.line"] }
    private let reloadText = "This device can't confirm that changes are saved. Reload the app."
    private let okText = "Reload didn't fix it."
    private let unconfirmed = "Still saving to this device. Keep the app open."

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.appearance = .light
    }

    private func evidence(_ text: String) { print("unguarded evidence: \(text)") }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let home = NSHomeDirectory().components(separatedBy: "/Library/Developer/CoreSimulator").first ?? NSHomeDirectory()
        let folder = URL(fileURLWithPath: "\(home)/Library/Developer/HomeEconomicsSpike/guard-flip-5219/\(run)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: folder.appendingPathComponent("\(name)-\(look).png"))
    }

    // Shown, or still shown: one of the unguarded notices, with its button
    private func notice(_ text: String, button label: String, within timeout: TimeInterval) -> Bool {
        let found = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", text), object: strip)
        return XCTWaiter.wait(for: [found], timeout: timeout) == .completed && button.label == label
    }

    private var anUnguardedNoticeShows: Bool {
        strip.exists && (strip.label.hasPrefix(reloadText) || strip.label.hasPrefix(okText))
    }

    private func openDemoBudget() {
        let accounts = app.tabBars.buttons["Accounts"]
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        let deadline = Date().addingTimeInterval(180)
        while !accounts.exists && !demo.exists && Date() < deadline { sleep(1) }
        if !accounts.exists { demo.tap() }
        XCTAssertTrue(accounts.waitForExistence(timeout: 120), "the demo budget did not open")
    }

    func testAnUnguardedPageConfirmsNoWriteAndAReloadThatDoesntFixItIsToldOnceWithOK() throws {
        try XCTSkipUnless(["off", "missing", "page"].contains(mode), "needs TEST_RUNNER_UNGUARDED off, missing or page")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if mode != "page" { app.launchArguments += ["-UITestPageUnguarded", mode] }
        if look == "ax5" { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        if look == "dark" { XCUIDevice.shared.appearance = .dark }
        app.launch()

        // First page load: Reload, reachable
        XCTAssertTrue(notice(reloadText, button: "Reload the app", within: 120), "no unguarded notice with Reload")
        evidence("first load: \(strip.label); Reload hittable = \(button.isHittable)")
        save("1-unguarded-reload")
        XCTAssertTrue(button.isHittable, "Reload can't be reached")
        button.tap()

        // The reloaded page is still unguarded: once more, with OK and the PO's words
        XCTAssertTrue(notice(okText, button: "OK, close this notice", within: 120), "no OK notice after a Reload that didn't fix it")
        evidence("after Reload: \(strip.label); OK hittable = \(button.isHittable)")
        save("2-unguarded-ok")
        XCTAssertTrue(button.isHittable, "OK can't be reached")
        button.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: strip)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, "OK left the notice up")

        // After OK: the budget is usable, rows visible
        openDemoBudget()
        app.tabBars.buttons["Budget"].tap()
        let food = app.collectionViews.buttons["Food"].firstMatch
        XCTAssertTrue(food.waitForExistence(timeout: 60), "no Food row on the Budget tab after OK")
        save("3-after-ok-budget")

        // A change: never confirmed, and the line says so, even in Release where the line is otherwise off
        let field = app.textFields["Budgeted Food"]
        for dy in [0.75, 0.45, 0.3, 0.2] where !field.exists {
            food.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: dy)).tap()
            _ = field.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(field.exists, "the budgeted amount's edit sheet did not open")
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + "123")
        app.navigationBars.buttons["Save"].tap()
        sleep(10)
        evidence("10 s after the change: line = \(line.exists ? line.label : "none"); alert = \(app.alerts.firstMatch.exists); notice = \(strip.exists ? strip.label : "none")")
        save("4-after-change-line")
        XCTAssertEqual(line.exists ? line.label : "", unconfirmed, "the storage line doesn't show the unconfirmed change")
        XCTAssertFalse(app.alerts.firstMatch.exists, "something claimed the change was saved")
        XCTAssertFalse(anUnguardedNoticeShows, "an unguarded notice came back after OK")

        // The next page load, still unguarded: no notice of either kind, and the line still says unconfirmed
        guard env["UNGUARDED_KILL"] == "1" else { return }
        evidence("kill the page now")
        // The runner ends the page process; the shell reloads it on its own
        sleep(40)
        let watch = Date().addingTimeInterval(20)
        var cameBack = false
        while Date() < watch {
            if anUnguardedNoticeShows { cameBack = true }
            sleep(1)
        }
        evidence("after the page process ended: notice = \(strip.exists ? strip.label : "none"); line = \(line.exists ? line.label : "none")")
        save("5-next-page-load")
        XCTAssertFalse(cameBack, "an unguarded notice came back on the next page load")
    }
}
