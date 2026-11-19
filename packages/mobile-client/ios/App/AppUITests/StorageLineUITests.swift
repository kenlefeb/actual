import XCTest

// Fork-only (sc-5296). The storage status line ("native-durable-writes") must
// never cover what a person needs. On Reconcile step 2 iOS puts the search
// field at the bottom of the sheet, where it doesn't follow the safe area the
// line reserves. `-ReconcileDemo step2` and `-UITestStorageLine unstored`
// (Debug builds only) show that screen with the line held up.
final class StorageLineUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ text: String, timeout: TimeInterval = 30) -> XCUIElement {
        let found = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "no \"\(text)\" on screen")
        return found
    }

    private func checkReconcileSearchField(_ extra: [String]) {
        app.launchArguments = ["-ReconcileDemo", "step2", "-UITestStorageLine", "unstored", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        checkSearchFieldAndLine(shot: nil)
    }

    // The way the story reached it: the demo budget, an account's register,
    // its ••• menu, Reconcile, then step 1 into step 2. Bank of America is
    // already balanced, so step 2 has no rows, and then iOS puts the search
    // field at the bottom of the sheet (the case -ReconcileDemo step2 lacks).
    private func checkTheRealFlow(_ extra: [String], shot: String) {
        app.launchArguments = ["-UITestStorageLine", "unstored", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        // A later run in the same simulator finds the demo budget already open
        let accounts = app.tabBars.buttons["Accounts"]
        let demo = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Try the demo")).firstMatch
        let deadline = Date().addingTimeInterval(120)
        while !accounts.exists && !demo.exists && Date() < deadline { sleep(1) }
        if !accounts.exists { demo.tap() }
        XCTAssertTrue(accounts.waitForExistence(timeout: 90), "the demo budget did not open")
        accounts.tap()
        let row = NSPredicate(format: "label CONTAINS %@", "Bank of America")
        let account = app.buttons.matching(row).firstMatch
        // At the largest text size the row starts below the screen
        _ = account.waitForExistence(timeout: 20)
        for _ in 0..<6 where !account.isHittable { app.swipeUp() }
        if account.waitForExistence(timeout: 10) {
            account.tap()
        } else {
            let text = app.staticTexts.matching(row).firstMatch
            XCTAssertTrue(text.waitForExistence(timeout: 5), "no Bank of America row")
            text.tap()
        }
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 30), "the register did not open")
        app.buttons["More"].tap()
        app.buttons["Reconcile"].tap()
        // A reconcile an earlier test left in progress opens again at step 2
        let useCleared = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Use cleared balance")).firstMatch
        let stepTwo = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Step 2 of 4")).firstMatch
        let stepDeadline = Date().addingTimeInterval(30)
        while !useCleared.exists && !stepTwo.exists && Date() < stepDeadline { sleep(1) }
        if !stepTwo.exists {
            checkTheEditedFieldIsClear()
            tapOnScreen("Use cleared balance")
            tapOnScreen("Confirm balance")
            let carryOn = app.buttons["Continue"]
            if carryOn.waitForExistence(timeout: 5) { carryOn.tap() }
        }
        // CI (iPhone 16e, iOS 26.2, AX5) once ended on the register here, with
        // the sheet gone, so say so rather than report a missing search field
        if !stepTwo.waitForExistence(timeout: 30) {
            keepScreen("Reconcile did not reach step 2")
            XCTFail("Reconcile did not reach step 2")
            return
        }
        checkSearchFieldAndLine(shot: shot)
    }

    // Step 1 opens with the statement amount being edited and the keyboard up.
    // The Designer's rule (PR 494): the line then takes at most a third of the
    // space above the keyboard, so the field stays readable and can be tapped.
    private func checkTheEditedFieldIsClear() {
        let edited = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        guard edited.waitForExistence(timeout: 5) else { return }
        XCTAssertTrue(edited.isHittable, "the field being edited is covered")
        let line = app.staticTexts["storage.line"]
        if line.exists {
            XCTAssertFalse(line.frame.insetBy(dx: -12, dy: -6).intersects(edited.frame), "the line covers the field being edited")
        }
        // The keyboard itself can cover the step's buttons, as anywhere in iOS;
        // a person closes it with its ✓ key before tapping them
        app.typeText("\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "the keyboard stayed up")
    }

    // At the largest text size a button can sit below the sheet's visible
    // part, where a tap lands on whatever is there instead
    private func tapOnScreen(_ label: String) {
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no \"\(label)\" button")
        for _ in 0..<5 where !button.isHittable { app.swipeUp() }
        if !button.isHittable {
            keepScreen("\"\(label)\" can't be reached")
            save("unreachable-\(label.prefix(12))")
            print("unreachable \(label): \(button.frame)")
        }
        XCTAssertTrue(button.isHittable, "\"\(label)\" can't be reached")
        button.tap()
    }

    // A screenshot kept with the result, and the screen's elements in the log,
    // since a CI result bundle is a download
    private func keepScreen(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        print("\(name):\n\(app.debugDescription.prefix(8000))")
    }

    private func checkSearchFieldAndLine(shot: String?) {
        // Reconcile's own field, not the register's behind the sheet
        let field = app.searchFields.matching(NSPredicate(format: "placeholderValue == %@", "Find amount")).firstMatch
        if !field.waitForExistence(timeout: 60) {
            keepScreen("step 2 without a search field")
            if let shot { save("\(shot)-no-field") }
            XCTFail("no search field on step 2")
            return
        }
        let line = app.staticTexts["storage.line"]
        XCTAssertTrue(line.waitForExistence(timeout: 10), "the line is not showing")
        // The line looks for what it must avoid every 0.1 s
        sleep(1)
        // The label sits 6 points inside the line's pill
        let pill = line.frame.insetBy(dx: -12, dy: -6)
        // For the Designer, outside the scratchpad
        if let shot { save(shot) }
        XCTAssertFalse(pill.intersects(field.frame), "the line \(pill) covers the search field \(field.frame)")
        field.tap()
        field.typeText("12")
        XCTAssertEqual(field.value as? String, "12", "the field did not take the tap")
    }

    // For the Designer, outside the scratchpad; does nothing on a CI runner without that folder
    private func save(_ name: String) {
        let home = NSHomeDirectory().components(separatedBy: "/Library/Developer/CoreSimulator").first ?? NSHomeDirectory()
        try? XCUIScreen.main.screenshot().pngRepresentation.write(
            to: URL(fileURLWithPath: "\(home)/Library/Developer/HomeEconomicsSpike/storage-line-5296/\(name).png"))
    }

    func testOnReconcileStepTwoTheLineLeavesTheSearchFieldReadable() {
        checkReconcileSearchField([])
    }

    func testThroughTheRealFlowTheLineLeavesTheSearchFieldReadable() {
        checkTheRealFlow([], shot: "real-flow-step2-light")
    }

    func testThroughTheRealFlowInDarkModeTooTheLineLeavesTheSearchFieldReadable() {
        XCUIDevice.shared.appearance = .dark
        defer { XCUIDevice.shared.appearance = .light }
        // The test itself sets dark, so the same placement checks run in it
        checkTheRealFlow([], shot: "real-flow-step2-dark")
    }

    func testThroughTheRealFlowAtTheLargestTextSizeTooTheLineLeavesTheSearchFieldReadable() {
        checkTheRealFlow(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"], shot: "real-flow-step2-ax5")
    }

    func testAtTheLargestTextSizeTooTheLineLeavesTheSearchFieldReadable() {
        checkReconcileSearchField(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    }
}
