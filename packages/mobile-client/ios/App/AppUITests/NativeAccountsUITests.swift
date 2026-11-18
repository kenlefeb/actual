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
        app.launchArguments = ["-UITestAccounts", "YES", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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
        for amount in ["928.20", "500.00", "-250.00", "3,000.00", "1,178.20", "4,178.20"] {
            XCTAssertTrue(app.staticTexts[amount].exists, "\(amount) is missing from the list")
        }
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
        // The system draws the field's cancel control as "Cancel" or, on the newest iOS, "close"
        let cancel = app.buttons["Cancel"].exists ? app.buttons["Cancel"] : app.buttons["close"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "the search field has no cancel control")
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
        let banner = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'to reconcile'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 10), "no reconcile banner")
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
