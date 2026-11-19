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
    private func checkTheRealFlow(
        _ extra: [String], shot: String, stopAtStepOne: Bool = false, atStepOne: (() -> Void)? = nil
    ) {
        openBankOfAmerica(extra)
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 30), "the register did not open")
        app.buttons["More"].tap()
        app.buttons["Reconcile"].tap()
        continueToStepTwo(shot: shot, stopAtStepOne: stopAtStepOne, atStepOne: atStepOne)
    }

    // The demo budget's Bank of America register, with the line held up
    private func openBankOfAmerica(_ extra: [String]) {
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
    }

    private func continueToStepTwo(shot: String, stopAtStepOne: Bool, atStepOne: (() -> Void)?) {
        // A reconcile an earlier test left in progress opens again at step 2
        let useCleared = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Use cleared balance")).firstMatch
        let stepTwo = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Step 2 of 4")).firstMatch
        let stepDeadline = Date().addingTimeInterval(30)
        while !useCleared.exists && !stepTwo.exists && Date() < stepDeadline { sleep(1) }
        if !stepTwo.exists {
            atStepOne?()
            if stopAtStepOne { return }
            checkTheEditedFieldIsClear(shot: "\(shot)-step1-keyboard")
            scrollAboveTheConfirmBar("Use cleared balance").tap()
            reachOnScreen("Confirm balance").tap()
            // Using the cleared balance always shows this note first
            let carryOn = app.alerts.buttons["Continue"]
            XCTAssertTrue(carryOn.waitForExistence(timeout: 10), "no note after Confirm balance")
            carryOn.tap()
        }
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
    private func checkTheEditedFieldIsClear(shot: String? = nil) {
        // A hidden keyboard can still be listed, so its "1" key must be hittable
        let one = app.keyboards.keys["1"]
        // Step 1 always opens with the amount being edited (story 5378: a
        // keyboard that never came must fail the test, not skip the check)
        guard one.waitForExistence(timeout: 5), one.isHittable else {
            XCTFail("the keyboard is not up on step 1")
            return
        }
        // The line follows every 0.1 s
        sleep(1)
        if let shot { save(shot) }
        let edited = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        if edited.exists {
            XCTAssertTrue(edited.isHittable, "the field being edited is covered")
            let line = app.staticTexts["storage.line"]
            if line.exists {
                XCTAssertFalse(line.frame.insetBy(dx: -12, dy: -6).intersects(edited.frame), "the line covers the field being edited")
            }
        }
        // The keyboard itself can cover the step's buttons, as anywhere in iOS;
        // a person closes it with its ✓ key before tapping them
        app.typeText("\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "the keyboard stayed up")
    }

    // Story 5357: at the largest text size "Use cleared balance" starts behind
    // the bottom Confirm bar, where XCUITest still calls it hittable and a tap
    // lands on the bar. So drag the sheet, as a finger would, until the whole
    // button is above the bar.
    private func scrollAboveTheConfirmBar(_ label: String) -> XCUIElement {
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no \"\(label)\" button")
        let bar = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Confirm balance")).firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 10), "no Confirm balance")
        // Drag inside the scrolling part, just above the bar: at this size the
        // bar and the storage line take much of the screen, and a drag that
        // starts on them scrolls nothing
        let origin = app.coordinate(withNormalizedOffset: .zero)
        for _ in 0..<10 where button.frame.maxY > bar.frame.minY {
            let from = bar.frame.minY - 20
            origin.withOffset(CGVector(dx: bar.frame.midX, dy: from))
                .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: bar.frame.midX, dy: max(140, from - 150))))
        }
        if button.frame.maxY > bar.frame.minY {
            keepScreen("\"\(label)\" can't be scrolled above the Confirm bar")
            save("cannot-scroll-\(label.prefix(3))")
            print("cannot scroll: keyboards=\(app.keyboards.count) keys=\(app.keyboards.keys.count)")
        }
        XCTAssertLessThanOrEqual(button.frame.maxY, bar.frame.minY, "\"\(label)\" can't be scrolled above the Confirm bar")
        return button
    }

    // Scrolls a button into reach and checks nothing, the line included, covers it
    @discardableResult
    private func reachOnScreen(_ label: String) -> XCUIElement {
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no \"\(label)\" button")
        for _ in 0..<5 where !button.isHittable { app.swipeUp() }
        if !button.isHittable {
            keepScreen("\"\(label)\" can't be reached")
            print("unreachable \(label): \(button.frame)")
        }
        XCTAssertTrue(button.isHittable, "\"\(label)\" can't be reached")
        return button
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
    private func save(_ name: String, folder: String = "storage-line-5296") {
        let home = NSHomeDirectory().components(separatedBy: "/Library/Developer/CoreSimulator").first ?? NSHomeDirectory()
        let directory = "\(home)/Library/Developer/HomeEconomicsSpike/\(folder)"
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(directory)/\(name).png"))
    }

    // MARK: Placement (story 5383, tasks 6.1 to 6.3 of native-durable-writes)

    private var line: XCUIElement { app.staticTexts["storage.line"] }

    // The line's pill, around its label
    private var pill: CGRect { line.frame.insetBy(dx: -12, dy: -6) }

    private func shot(_ name: String) {
        let size = app.launchArguments.contains("UICTContentSizeCategoryAccessibilityXXXL") ? "ax5" : "default"
        let look = XCUIDevice.shared.appearance == .dark ? "dark" : "light"
        save("\(name)-\(size)-\(look)", folder: "storage-line-5297")
    }

    // A posted register row whose bottom is close to the line: the lowest one
    // wholly above it (scheduled rows have no menu)
    private func lowRow() -> XCUIElement {
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let rows = app.buttons.matching(NSPredicate(
            format: "label CONTAINS ', ' AND NOT (label CONTAINS 'Bank of America') AND NOT (label CONTAINS[c] 'scheduled')"))
        // At the largest text size the upcoming rows take several screens, so
        // keep scrolling until a posted row sits wholly above the line
        for _ in 0..<12 {
            origin.withOffset(CGVector(dx: 200, dy: 500)).press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 200, dy: 250)))
            sleep(1)
            let top = pill.minY
            let candidates = (0..<min(rows.count, 40)).map { rows.element(boundBy: $0) }
                .filter { $0.frame.maxY <= top && $0.frame.minY > 150 }
            if let lowest = candidates.max(by: { $0.frame.maxY < $1.frame.maxY }) { return lowest }
        }
        keepScreen("no posted row above the line")
        return rows.firstMatch
    }

    // One pass through the places tasks 6.1 to 6.3 name: a context menu from a
    // low row, the Categorize sheet scrolled to its end, the Undo bar after
    // the change, and the line back above the tab bar once the sheet closes
    private func checkPlacementInTheRegister(_ extra: [String]) {
        openBankOfAmerica(extra)
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 30), "the register did not open")
        XCTAssertTrue(line.waitForExistence(timeout: 30), "the line is not showing")
        sleep(1)
        shot("register")

        // 6.2: a context menu from a low row has no item under the line
        let row = lowRow()
        row.press(forDuration: 1.2)
        let categorize = app.buttons["Categorize"]
        XCTAssertTrue(categorize.waitForExistence(timeout: 10), "no context menu on \(row.label)")
        sleep(1)
        shot("context-menu")
        if line.exists {
            for item in ["Categorize", "Clear", "Unclear", "Delete"] where app.buttons[item].exists {
                XCTAssertFalse(pill.intersects(app.buttons[item].frame), "the line \(pill) covers the menu's \(item) \(app.buttons[item].frame)")
            }
        }

        // 6.1: the last row of the Categorize sheet scrolls clear of the line
        categorize.tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), "the Categorize sheet did not open")
        let last = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Income")).firstMatch
        let origin = app.coordinate(withNormalizedOffset: .zero)
        for _ in 0..<15 {
            origin.withOffset(CGVector(dx: 200, dy: 500)).press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 200, dy: 250)))
        }
        sleep(1)
        shot("sheet-end")
        XCTAssertTrue(last.exists, "no Income row (the last category) in the Categorize sheet")
        XCTAssertLessThanOrEqual(last.frame.maxY, pill.minY, "the sheet's last row \(last.frame) ends under the line \(pill)")

        // 6.3: the Undo bar above the line, by frames, and the line back above the tab bar
        last.tap()
        let undo = app.buttons["Undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 10), "no Undo after the change")
        sleep(1)
        shot("undo")
        // The Undo bar is the button plus the bar's 16-point padding
        XCTAssertLessThanOrEqual(undo.frame.maxY + 16, pill.minY, "the Undo bar ends under the line")
        let tabBar = app.tabBars.firstMatch
        XCTAssertLessThanOrEqual(pill.maxY, tabBar.frame.minY, "the line \(pill) is not above the tab bar \(tabBar.frame)")
        undo.tap()
    }

    // Story 5383, the Designer's rule: with the keyboard up the line's only
    // place is directly above the keyboard, and it hides if it would cover the
    // field being edited. It never goes to the top, where it lay over a
    // sheet's close button and title. The size comes from the SIZE
    // environment value, so a run can also look for the short form.
    func testWithTheKeyboardUpAtALargeSizeTheLineLeavesTheSheetClear() {
        let size = ProcessInfo.processInfo.environment["SIZE"] ?? "UICTContentSizeCategoryAccessibilityXL"
        checkTheRealFlow(["-UIPreferredContentSizeCategoryName", size], shot: "large", stopAtStepOne: true) {
            let keyboard = self.app.keyboards.firstMatch
            XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "the keyboard is not up on step 1")
            // The line follows every 0.1 s
            sleep(2)
            self.save("keyboard-\(size.replacingOccurrences(of: "UICTContentSizeCategory", with: ""))", folder: "storage-line-5297")
            let close = self.app.buttons["Close without saving a balance"]
            let title = self.app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Step 1 of 4")).firstMatch
            let edited = self.app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
            for (name, element) in [("close button", close), ("step title", title), ("amount field", edited)] {
                XCTAssertTrue(element.exists, "no \(name)")
                if self.line.exists {
                    XCTAssertFalse(self.pill.intersects(element.frame), "the line \(self.pill) covers the \(name) \(element.frame)")
                }
            }
            XCTAssertTrue(close.isHittable, "the close button can't be tapped")
            XCTAssertTrue(edited.isHittable, "the amount field can't be tapped")
            if self.line.exists {
                XCTAssertLessThanOrEqual(self.pill.maxY, keyboard.frame.minY, "the line is not above the keyboard")
                XCTAssertGreaterThanOrEqual(self.pill.minY, keyboard.frame.minY * 2 / 3 - 16, "the line is not directly above the keyboard")
            }
        }
    }

    func testInTheRegisterTheLineLeavesMenusSheetsAndTheUndoBarClear() {
        checkPlacementInTheRegister([])
    }

    func testAtTheLargestTextSizeTooTheLineLeavesMenusSheetsAndTheUndoBarClear() {
        checkPlacementInTheRegister(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    }

    // The Architect's review of the spec (PR 495): with the restart notice's
    // strip showing and the keyboard up, the line's space starts below the
    // strip, so it never draws over the strip or its button
    func testWithANoticeInTheStripAndTheKeyboardUpTheLineStaysBelowTheStrip() {
        // `-UITestStorageNotice failure` holds a notice in the strip from the first
        // page load (one that stays, unlike the 15 s restart notice), so it is
        // still up when step 1 opens with its amount being edited. The line
        // starts 25 s after launch, after the strip (story 5362).
        checkTheRealFlow(
            ["-UITestStorageNotice", "failure", "-UITestStorageLineAfter", "25"], shot: "strip-keyboard", stopAtStepOne: true
        ) {
            let strip = self.app.staticTexts["pageNotice.text"]
            XCTAssertTrue(strip.waitForExistence(timeout: 30), "no notice in the strip")
            // A hidden keyboard can still be listed, so its "1" key must be hittable
            let one = self.app.keyboards.keys["1"]
            XCTAssertTrue(one.waitForExistence(timeout: 10) && one.isHittable, "the keyboard is not up on step 1")
            // At this text size the line fits above the keyboard, so it must show
            let line = self.app.staticTexts["storage.line"]
            XCTAssertTrue(line.waitForExistence(timeout: 60), "the line is not showing")
            // The line follows every 0.1 s
            sleep(1)
            self.save("strip-keyboard-up")
            let stripBottom = max(strip.frame.maxY, self.app.buttons["pageNotice.dismiss"].frame.maxY)
            XCTAssertGreaterThanOrEqual(line.frame.minY - 6, stripBottom, "the line draws over the strip")
            XCTAssertTrue(self.app.buttons["pageNotice.dismiss"].isHittable, "the strip's button is covered")
        }
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

    // At the largest text size on a short iPhone (CI's iPhone 16e) step 1 opens
    // with the keyboard up, where the line must leave the field clear; then
    // step 2's search field must stay readable too
    func testThroughTheRealFlowAtTheLargestTextSizeTooTheLineLeavesTheFieldsReadable() {
        checkTheRealFlow(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"], shot: "real-flow-ax5")
    }

    func testAtTheLargestTextSizeTooTheLineLeavesTheSearchFieldReadable() {
        checkReconcileSearchField(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
    }
}
