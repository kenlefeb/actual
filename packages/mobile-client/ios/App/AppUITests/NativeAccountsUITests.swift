import XCTest

// Fork-only (sc-5177; native-accounts-screen, sc-3611 task 3.5). The first UI
// tests: the native Accounts list and register on the simulator, over the
// fixture transport that `-UITestAccounts YES` turns on (UITestAccounts.swift,
// Debug builds only). No budget, sign-in or network. Each test names the
// defect from the sc-3611 hands-on pass (PR 458) it would have caught.
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
        XCTAssertTrue(app.staticTexts["Grocer"].waitForExistence(timeout: 10), "the register never showed its rows")
    }

    func testTheListShowsTheFixtureAccountsInTheirSections() {
        XCTAssertTrue(app.staticTexts["Checking"].waitForExistence(timeout: 20))
        for name in ["Savings", "Card", "House"] {
            XCTAssertTrue(app.staticTexts[name].exists, "\(name) is missing from the list")
        }
        XCTAssertTrue(app.staticTexts["On Budget"].exists || app.staticTexts["On budget"].exists)
    }

    // The drag handle is an element the row labels "Reorder <name>, <balance>, ..."; its
    // type differs between iOS versions, so match any type
    private func handle(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Reorder \(name),")).firstMatch
    }

    // What the screen offers, for a failure message: a CI failure has no screenshot to look at
    private func labels(containing word: String) -> [String] {
        app.descendants(matching: .any).allElementsBoundByIndex.map { "\($0.elementType.rawValue):\($0.label)" }.filter { $0.contains(word) }
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
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: handle("Checking"))
        waitForExpectations(timeout: 5)
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

    // PR 458: Cancel in the search field left the filter on
    func testCancelInTheSearchClearsTheFilter() {
        openChecking()
        XCTAssertTrue(app.staticTexts["Working balance"].exists, "the unfiltered register shows its header")
        search("gr")
        XCTAssertTrue(text(where: "label BEGINSWITH 'Total of results'").waitForExistence(timeout: 10), "the search never filtered")
        // The system draws the field's cancel control as "Cancel" or, on the newest iOS, "close"
        let cancel = app.buttons["Cancel"].exists ? app.buttons["Cancel"] : app.buttons["close"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "the search field has no cancel control")
        cancel.tap()
        XCTAssertTrue(app.staticTexts["Working balance"].waitForExistence(timeout: 10), "Cancel left the filter on")
        XCTAssertFalse(text(where: "label BEGINSWITH 'Total of results'").exists, "the results footer stays after Cancel")
    }

    // PR 458: the account settings menu stayed open after a choice
    func testChoosingAccountSettingsHandsOffAndClosesTheMenu() {
        openChecking()
        app.buttons["More"].tap()
        let settings = app.buttons["Account settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.staticTexts["account-settings"].waitForExistence(timeout: 5), "the hand-off never reached the host")
        let closed = NSPredicate(format: "exists == false")
        expectation(for: closed, evaluatedWith: settings)
        waitForExpectations(timeout: 5)
    }

    func testAScopeChipShowsWhileSearchingAndCanBeSelected() {
        openChecking()
        XCTAssertFalse(app.buttons["Uncleared"].exists, "the chips show before a search")
        search("gr")
        let uncleared = app.buttons["Uncleared"]
        XCTAssertTrue(uncleared.waitForExistence(timeout: 10), "no Uncleared scope chip while searching")
        XCTAssertFalse(uncleared.isSelected)
        uncleared.tap()
        XCTAssertTrue(uncleared.isSelected, "tapping the chip did not select it")
    }
}
