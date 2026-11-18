import XCTest

// Fork-only (sc-5177; native-accounts-screen, sc-3611 task 3.5). UI tests of
// the native Accounts list and register on the simulator, over the fixture
// transport that `-UITestAccounts YES` turns on (UITestAccounts.swift, Debug
// builds only). No budget, sign-in or network. Tests that guard a defect from
// the sc-3611 hands-on pass (PR 458) name it.
//
// Not covered here: the web side of a hand-off (the page's account menu, which
// AccountPage.test.tsx covers) and the swipes and the categorize picker.
final class NativeAccountsUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments = ["-UITestAccounts", "YES", "-UITestNoAnimations", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
    }

    // Opens Checking's register from the list
    private func openChecking() {
        let row = app.buttons.containing(.staticText, identifier: "Checking").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the list never showed Checking")
        row.tap()
        XCTAssertTrue(grocer.waitForExistence(timeout: 10), "the register never showed its rows")
    }

    // The register's row for the cleared Groceries transaction
    private var grocer: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Grocer'")).firstMatch
    }

    // What the screen offers, for a failure message: a CI failure has no screenshot to look at
    private func labels(containing word: String) -> [String] {
        app.descendants(matching: .any).allElementsBoundByIndex.map { "\($0.elementType.rawValue):\($0.label)" }.filter { $0.contains(word) }
    }

    private func waitUntilGone(_ element: XCUIElement, _ message: String, timeout: TimeInterval = 10) {
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    // The host writes the last hand-off or Reconcile entry it was asked for, "<action>:<account>"
    private func assertHandOff(_ expected: String, file: StaticString = #filePath, line: UInt = #line) {
        let element = app.staticTexts[expected]
        XCTAssertTrue(element.waitForExistence(timeout: 5), "expected the hand-off \(expected); the screen has \(labels(containing: ":"))", file: file, line: line)
    }

    func testTheListShowsTheFixtureAccountsWithTheirBalances() {
        XCTAssertTrue(app.staticTexts["Checking"].waitForExistence(timeout: 20))
        for name in ["Savings", "Card", "House"] {
            XCTAssertTrue(app.staticTexts[name].exists, "\(name) is missing from the list")
        }
        // loot-core's numbers, formatted: each account, the on-budget total and the net worth
        func shows(_ amount: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", amount, amount)).firstMatch
        }
        for amount in ["928.20", "500.00", "-250.00", "3,000.00", "1,178.20"] {
            XCTAssertTrue(shows(amount).exists, "\(amount) is missing from the list; the screen has \(labels(containing: ".").prefix(12))")
        }
        // The net worth is the last row, below the fold
        app.swipeUp()
        XCTAssertTrue(shows("4,178.20").waitForExistence(timeout: 5), "the net worth is missing; the screen has \(labels(containing: ".").prefix(12))")
        XCTAssertTrue(app.staticTexts["On Budget"].exists || app.staticTexts["On budget"].exists)
    }

    // The drag handle is an element labelled "Reorder <name>" (the iOS 27 simulator adds
    // ", <balance>, ..."), so match either, on any element type
    private func handle(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "Reorder \(name)", "Reorder \(name),")
        ).firstMatch
    }

    // PR 458: Edit showed no drag handles
    func testEditShowsADragHandleOnEveryAccountRow() {
        XCTAssertTrue(app.staticTexts["Checking"].waitForExistence(timeout: 20))
        XCTAssertFalse(handle("Checking").exists, "a handle shows before Edit")
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5), "Edit did not become Done")
        for name in ["Checking", "Savings", "Card", "House"] {
            XCTAssertTrue(handle(name).waitForExistence(timeout: 5), "no drag handle for \(name); the screen has \(labels(containing: "Reorder") + labels(containing: name))")
        }
        app.buttons["Done"].tap()
        waitUntilGone(handle("Checking"), "the handles stay after Done", timeout: 5)
    }

    // Taps the register's search field and types into it
    private func search(_ text: String) {
        let field = app.searchFields["Search payee, category, notes"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the register has no search field")
        field.tap()
        field.typeText(text)
    }

    private func text(where predicate: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: predicate)).firstMatch
    }

    // PR 458: Cancel in the search field left the filter (the scope) on, so the cleared row stayed hidden
    func testCancelInTheSearchBringsBackTheWholeRegisterWhateverTheScope() {
        openChecking()
        search("gr")
        XCTAssertTrue(text(where: "label BEGINSWITH 'Total of results'").waitForExistence(timeout: 10), "the search never filtered")
        let uncleared = app.buttons["Uncleared"]
        XCTAssertTrue(uncleared.waitForExistence(timeout: 10), "no Uncleared scope chip while searching")
        uncleared.tap()
        XCTAssertTrue(uncleared.isSelected, "tapping the chip did not select it")
        waitUntilGone(grocer, "the cleared row stays under the Uncleared scope")
        // The system draws the field's cancel control; its label differs between iOS versions and
        // placements ("Cancel", "close", "Close"), so wait for any of them
        let cancel = app.buttons.matching(NSPredicate(format: "label ==[c] 'Cancel' OR label ==[c] 'Close'")).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), "the search field has no cancel control; the buttons are \(app.buttons.allElementsBoundByIndex.map(\.label))")
        cancel.tap()
        XCTAssertTrue(grocer.waitForExistence(timeout: 10), "Cancel left the scope on: the cleared row did not return")
        XCTAssertTrue(app.staticTexts["Working balance"].waitForExistence(timeout: 10), "Cancel left the filter on")
        XCTAssertFalse(text(where: "label BEGINSWITH 'Total of results'").exists, "the results footer stays after Cancel")
    }

    func testAScopeChipFiltersTheRegisterAndAllShowsItAgain() {
        openChecking()
        search("gr")
        let uncleared = app.buttons["Uncleared"]
        XCTAssertTrue(uncleared.waitForExistence(timeout: 10), "no Uncleared scope chip while searching")
        XCTAssertFalse(uncleared.isSelected)
        uncleared.tap()
        XCTAssertTrue(uncleared.isSelected, "tapping the chip did not select it")
        waitUntilGone(grocer, "the cleared row stays under the Uncleared scope")
        app.buttons["All"].tap()
        XCTAssertTrue(grocer.waitForExistence(timeout: 10), "All did not bring the cleared row back")
    }

    // The ••• menu hands off to the web for this account; the page side of the menu is covered by AccountPage.test.tsx
    func testChoosingAccountSettingsHandsOffToTheWebForThisAccount() {
        openChecking()
        app.buttons["More"].tap()
        let settings = app.buttons["Account settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        assertHandOff("account-settings:checking")
    }

    // sc-3611 task 3.5: the three Reconcile entries each open the flow for the right account
    func testTheRegisterMenuStartsReconcileForThisAccount() {
        openChecking()
        app.buttons["More"].tap()
        let reconcile = app.buttons["Reconcile"]
        XCTAssertTrue(reconcile.waitForExistence(timeout: 5), "the ••• menu has no Reconcile")
        reconcile.tap()
        assertHandOff("reconcile:checking")
    }

    func testTheBannerStartsTheReconcileChecklist() {
        XCTAssertTrue(app.staticTexts["Checking"].waitForExistence(timeout: 20))
        let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'to reconcile'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 10), "no reconcile banner; the screen has \(labels(containing: "econcile"))")
        banner.tap()
        assertHandOff("reconcile:checklist")
    }

    func testLongPressOnAnAccountStartsReconcileForThatAccount() {
        XCTAssertTrue(app.staticTexts["Savings"].waitForExistence(timeout: 20))
        app.buttons.containing(.staticText, identifier: "Savings").firstMatch.press(forDuration: 1.5)
        let reconcile = app.buttons["Reconcile"]
        XCTAssertTrue(reconcile.waitForExistence(timeout: 5), "the long-press menu has no Reconcile")
        reconcile.tap()
        assertHandOff("reconcile:savings")
    }
}

// Fork-only (sc-3611 task 3.6, comment 5258). The simulator does not run
// VoiceOver, so nothing here is "heard". XCUITest reads the same accessibility
// tree VoiceOver walks: what an element's label, value and traits say is what
// VoiceOver speaks, and an element that is missing from the tree is one it skips.
// What a listener hears and feels (the order, the pauses, the rotor, dragging
// with VoiceOver on) is a person's check: see docs/agents/ios-ui-tests.md.
final class NativeAccountsAccessibilityUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ extra: [String] = []) {
        app.launchArguments = ["-UITestAccounts", "YES", "-UITestNoAnimations", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
    }

    private func openChecking() {
        let row = app.buttons.containing(.staticText, identifier: "Checking").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the list never showed Checking")
        row.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Grocer'")).firstMatch.waitForExistence(timeout: 10), "the register never showed its rows")
    }

    private func register(_ payee: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", payee)).firstMatch
    }

    private func labels() -> [String] {
        (try? app.snapshot().children.flatMap { [$0] + $0.children }.map { "\($0.elementType.rawValue):\($0.label)" }) ?? []
    }

    // What the screen has announced, as the host recorded it: "<how many>|<the last one>"
    private var announcements: String {
        app.staticTexts["uitest.announcements"].label
    }

    // The row is one element whose label has everything, with the amount's sign
    // spoken: "-41.80" and "+25.00" (VoiceOver reads the minus and plus)
    func testARegisterRowReadsAsOneElementWithTheAmountsSignInItsLabel() {
        launch()
        openChecking()
        XCTAssertEqual(register("Grocer").label, "Grocer, Groceries, -41.80, Cleared")
        XCTAssertEqual(register("50%_off").label, "50%_off, Uncategorized, +25.00, Reconciled")
        app.swipeUp()
        XCTAssertEqual(register("No payee, Split (2)").label, "No payee, Split (2), -30.00, Pending")
        // A row is a button, not a pile of separate stops
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Grocer'")).count, 1)
    }

    func testAListRowReadsAsOneElementWithANegativeBalanceSigned() {
        launch()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Card'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 20), "the list never showed Card; the screen has \(labels().prefix(40))")
        XCTAssertTrue(card.label.contains("-250.00"), "Card's label does not carry its sign: \(card.label)")
    }

    // The actions rotor: Clear (or Unclear), Categorize and Delete, each once, and only
    // where the row allows it (a reconciled row has no Clear, a split no Categorize).
    // XCUITest cannot list custom actions, so the UI-test host reads them from the live
    // accessibility tree (UITestActionsProbe). Whether the rotor also adds the swipe
    // actions a second time is a person's check on a device (see the PR).
    func testEachRowOffersItsActionsOnce() {
        launch()
        openChecking()
        app.buttons["uitest.dumpActions"].tap()
        let dump = app.staticTexts["uitest.actions"].label
        var actions: [String: [String]] = [:]
        for entry in dump.components(separatedBy: "; ") {
            guard let split = entry.range(of: "=[") else { continue }
            actions[String(entry[..<split.lowerBound])] = entry[split.upperBound...].dropLast().components(separatedBy: "|")
        }
        func offered(_ label: String) -> [String] { (actions[label] ?? []).sorted() }
        XCTAssertEqual(offered("Grocer, Groceries, -41.80, Cleared"), ["Categorize", "Delete", "Unclear"], "the screen has \(dump)")
        XCTAssertEqual(offered("No payee, Uncategorized, -5.00, Pending"), ["Categorize", "Clear", "Delete"], "the screen has \(dump)")
        XCTAssertEqual(offered("50%_off, Uncategorized, +25.00, Reconciled"), ["Categorize", "Delete"], "the screen has \(dump)")
        XCTAssertEqual(offered("No payee, Split (2), -30.00, Pending"), ["Clear", "Delete"], "the screen has \(dump)")
    }

    // The accessibility elements VoiceOver can land on, read from the live accessibility tree by
    // the UI-test host. XCUITest's own tree cannot be used: it lists accessibility-hidden elements
    // too, and the parts inside a combined element, which VoiceOver does not stop on.
    private func voiceOverStops() -> [String] {
        let dump = app.buttons["uitest.dumpElements"]
        XCTAssertTrue(dump.waitForExistence(timeout: 10))
        dump.tap()
        return app.staticTexts["uitest.elements"].label.components(separatedBy: "; ")
    }

    // The read is held for two minutes by the host. The client's own deadline is 5 s, so the
    // screen must still be loading after that: a flaky error screen here would pass for loading
    private func assertStillLoadingPastTheClientDeadline() {
        let retry = app.buttons["Retry"]
        let appears = expectation(for: NSPredicate(format: "exists == true"), evaluatedWith: retry)
        appears.isInverted = true
        wait(for: [appears], timeout: 7)
    }

    // Redacted placeholders show made-up names and numbers, a "Syncing…" and "All accounts"; while the
    // first read runs VoiceOver may stop only on the screen's own chrome and one "Loading" element.
    // The expectation is the whole list, so any other stop fails it.
    private func assertStops(_ expected: [String], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(voiceOverStops(), expected, file: file, line: line)
    }

    func testOnlyLoadingIsExposedWhileTheListLoads() {
        launch(["-UITestSlowList", "YES"])
        assertStillLoadingPastTheClientDeadline()
        // The host's own labels, the "Loading accounts" element, and the bar's Add button and title
        assertStops(["0||", "dump|", "elements|", "Loading accounts|", "Add|", "Accounts|"])
    }

    func testOnlyLoadingIsExposedWhileTheRegisterLoads() {
        launch(["-UITestSlowRegister", "YES"])
        let row = app.buttons.containing(.staticText, identifier: "Checking").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        assertStillLoadingPastTheClientDeadline()
        assertStops([
            "0||", "dump|", "elements|", "Loading|", "Accounts|", "Checking|", "More|",
            "Search payee, category, notes|Search payee, category, notes",
        ])
    }

    // The scope chips say which one is chosen, to VoiceOver as a selected trait
    func testTheScopeChipsReportWhichIsSelected() {
        launch()
        openChecking()
        let field = app.searchFields["Search payee, category, notes"]
        field.tap()
        field.typeText("gr")
        let all = app.buttons["All"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        XCTAssertTrue(all.isSelected)
        XCTAssertFalse(app.buttons["Uncleared"].isSelected)
        XCTAssertFalse(app.buttons["Uncategorized"].isSelected)
        app.buttons["Uncategorized"].tap()
        XCTAssertTrue(app.buttons["Uncategorized"].isSelected)
        XCTAssertFalse(all.isSelected)
    }

    // A failed read is spoken: once for a new failure, not on every redraw. The host records
    // what the screen asked VoiceOver to announce ("<how many>|<the last>"); the simulator
    // cannot speak it.
    func testAFailedListReadIsAnnouncedOncePerFailure() {
        launch(["-UITestFailList", "YES"])
        let shown = app.buttons[RETRY]
        XCTAssertTrue(shown.waitForExistence(timeout: 20), "the list never showed its failure: \(labels().prefix(40))")
        let first = announcements
        XCTAssertTrue(first.hasPrefix("1|") && first.count > 2, "expected one announcement, the host has \(first)")
        // Redraws of the same failure say nothing more
        app.swipeUp()
        app.swipeDown()
        XCTAssertEqual(announcements, first)
    }

    // A Retry that fails the same way again changes no state, but it is a new failed attempt:
    // a VoiceOver user must hear the result of their tap
    func testAFailedRetryIsAnnouncedAgain() {
        launch(["-UITestFailList", "YES"])
        let retry = app.buttons[RETRY]
        XCTAssertTrue(retry.waitForExistence(timeout: 20))
        XCTAssertTrue(announcements.hasPrefix("1|"), "expected one announcement, the host has \(announcements)")
        retry.tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '2|'"), evaluatedWith: app.staticTexts["uitest.announcements"])
        waitForExpectations(timeout: 10)
    }

    func testAFailedRegisterReadIsAnnouncedOnce() {
        launch(["-UITestFailRegister", "YES"])
        let row = app.buttons.containing(.staticText, identifier: "Checking").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        XCTAssertTrue(app.buttons[RETRY].waitForExistence(timeout: 10), "the register never showed its failure: \(labels().prefix(40))")
        let said = announcements
        XCTAssertTrue(said.hasPrefix("1|") && said.count > 2, "expected one announcement, the host has \(said)")
        app.swipeUp()
        XCTAssertEqual(announcements, said)
    }

    func testAFailedRegisterRetryIsAnnouncedAgain() {
        launch(["-UITestFailRegister", "YES"])
        let row = app.buttons.containing(.staticText, identifier: "Checking").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        let retry = app.buttons[RETRY]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(announcements.hasPrefix("1|"), "expected one announcement, the host has \(announcements)")
        retry.tap()
        expectation(for: NSPredicate(format: "label BEGINSWITH '2|'"), evaluatedWith: app.staticTexts["uitest.announcements"])
        waitForExpectations(timeout: 10)
    }

    private let RETRY = "Retry"

    // XCUITest's accessibility audit, for the checks that are about what VoiceOver finds and says
    // (not contrast, Dynamic Type or the system search field, which the audit also reports and
    // which are separate findings)
    func testTheAccessibilityAuditFindsNothingToFixOnTheListOrTheRegister() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs iOS 17") }
        launch()
        let types: XCUIAccessibilityAuditType = [.elementDetection, .sufficientElementDescription, .trait, .hitRegion]
        try app.performAccessibilityAudit(for: types) { issue in issue.element?.identifier.hasPrefix("uitest.") ?? false }
        openChecking()
        try app.performAccessibilityAudit(for: types) { issue in issue.element?.identifier.hasPrefix("uitest.") ?? false }
    }
}
