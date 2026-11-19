import XCTest

// Fork-only (sc-5219, Security's ruling). "A page without the guard confirms no
// write", seen in the running app, run by hand: skips unless the runner sets
// TEST_RUNNER_UNGUARDED to "off" or "missing" (what the page's ready says).
// `-UITestPageUnguarded` (NativeChromePlugin.swift, Debug only) loads the page
// without the guard while the shell stays opted in.
// TEST_RUNNER_UNGUARDED_RUN names the screenshot folder; TEST_RUNNER_UNGUARDED_LOOK
// is "light", "dark" or "ax5".
final class UnguardedPageUITests: XCTestCase {
    private let app = XCUIApplication()
    private var mode: String { ProcessInfo.processInfo.environment["UNGUARDED"] ?? "" }
    private var run: String { ProcessInfo.processInfo.environment["UNGUARDED_RUN"] ?? "run" }
    private var look: String { ProcessInfo.processInfo.environment["UNGUARDED_LOOK"] ?? "light" }
    private var strip: XCUIElement { app.staticTexts["pageNotice.text"] }
    private var button: XCUIElement { app.buttons["pageNotice.dismiss"] }
    private var line: XCUIElement { app.staticTexts["storage.line"] }
    private let text = "This device can't confirm that changes are saved. Reload the app."

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

    // Shown, or still shown, with Reload: the unguarded notice
    private func noticeIsUp(within timeout: TimeInterval) -> Bool {
        strip.waitForExistence(timeout: timeout) && strip.label.hasPrefix(text) && button.label == "Reload the app"
    }

    func testAnUnguardedPageConfirmsNoWriteAndOffersReloadOncePerPageLoad() throws {
        try XCTSkipUnless(["off", "missing"].contains(mode), "needs TEST_RUNNER_UNGUARDED off or missing")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-UITestPageUnguarded", mode]
        if look == "ax5" { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        if look == "dark" { XCUIDevice.shared.appearance = .dark }
        app.launch()
        XCTAssertTrue(noticeIsUp(within: 120), "no unguarded notice on the first page load")
        evidence("first load: \(strip.label)")
        save("unguarded-notice")

        // A change on the demo budget: never confirmed, so the line stays at not yet stored
        let accounts = app.tabBars.buttons["Accounts"]
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        let deadline = Date().addingTimeInterval(180)
        while !accounts.exists && !demo.exists && Date() < deadline { sleep(1) }
        if !accounts.exists { demo.tap() }
        XCTAssertTrue(accounts.waitForExistence(timeout: 120), "the demo budget did not open")
        app.tabBars.buttons["Budget"].tap()
        let food = app.collectionViews.buttons["Food"].firstMatch
        XCTAssertTrue(food.waitForExistence(timeout: 60), "no Food row on the Budget tab")
        let field = app.textFields["Budgeted Food"]
        for dy in [0.75, 0.45] where !field.exists {
            food.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: dy)).tap()
            _ = field.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(field.exists, "the budgeted amount's edit sheet did not open")
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + "123")
        app.navigationBars.buttons["Save"].tap()
        sleep(10)
        evidence("10 s after the change: line = \(line.exists ? line.label : "none"); alert = \(app.alerts.firstMatch.exists)")
        save("unguarded-after-change")
        XCTAssertEqual(line.exists ? line.label : "", "Still saving to this device. Keep the app open.")
        XCTAssertFalse(app.alerts.firstMatch.exists, "something claimed the change was saved")
        XCTAssertTrue(noticeIsUp(within: 1), "the notice went away on its own")

        // Reload: the new page is still unguarded, so the notice returns and stays, with no reload of its own
        button.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: strip)
        let closed = XCTWaiter.wait(for: [gone], timeout: 10) == .completed
        evidence("Reload closed the notice = \(closed)")
        XCTAssertTrue(noticeIsUp(within: 120), "no notice for the reloaded, still unguarded page")
        sleep(15)
        evidence("15 s after it returned: notice up = \(noticeIsUp(within: 1))")
        save("unguarded-after-reload")
        XCTAssertTrue(noticeIsUp(within: 1), "the returned notice did not stay")
    }
}
