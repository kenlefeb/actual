import XCTest

// Fork-only (sc-5399). A page's alert, confirm and prompt hold all of the page's
// JavaScript until they are answered. The app shows them above any native
// screen and always answers the page. `-UITestPageDialog` (UITestPageDialogs.swift,
// Debug builds only) opens one from the app's own page.
final class PageDialogsUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ kind: String, cover: Bool = true, timeout: Int? = nil) {
        app.launchArguments = ["-UITestPageDialog", kind, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if cover { app.launchArguments += ["-UITestPageDialogCover", "YES"] }
        if let timeout { app.launchArguments += ["-UITestPageDialogTimeout", String(timeout)] }
        app.launch()
    }

    private var report: XCUIElement { app.staticTexts["uiTestPageDialog"] }

    private func alert(_ message: String) -> XCUIElement {
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 60), "the page's dialog never showed")
        // By label, once its text is in the tree
        let text = alert.staticTexts.matching(NSPredicate(format: "label == %@", message)).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5), "the dialog doesn't say \(message): \(alert.debugDescription)")
        return alert
    }

    func testAnAlertOverANativeScreenShowsAndThePageGoesOn() {
        launch("alert")
        XCTAssertTrue(app.staticTexts["uiTestDialogCover"].waitForExistence(timeout: 60))
        alert("We had an unknown problem opening the budget.").buttons["OK"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 10), "the page never went on")
        XCTAssertEqual(report.label, "answer=closed page=answers")
    }

    func testConfirmAnswersOKAndCancel() {
        launch("confirm")
        alert("Delete the Groceries category?").buttons["OK"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 10))
        XCTAssertEqual(report.label, "answer=true page=answers")

        app.terminate()
        launch("confirm")
        alert("Delete the Groceries category?").buttons["Cancel"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 10))
        XCTAssertEqual(report.label, "answer=false page=answers")
    }

    func testPromptReturnsWhatWasTyped() {
        launch("prompt")
        let dialog = alert("Name the new category")
        let field = dialog.textFields.firstMatch
        XCTAssertEqual(field.value as? String, "Groceries", "the page's default text")
        field.tap()
        field.typeText(" and food")
        dialog.buttons["OK"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 10))
        XCTAssertEqual(report.label, "answer=Groceries and food page=answers")
    }

    func testAConfirmNobodyAnswersIsCancelledAndThePageGoesOn() {
        launch("confirm", timeout: 3)
        _ = alert("Delete the Groceries category?")
        XCTAssertTrue(report.waitForExistence(timeout: 15), "the page was held")
        XCTAssertEqual(report.label, "answer=false page=answers")
        XCTAssertFalse(app.alerts.firstMatch.exists, "the unanswered dialog stayed up")
    }
}
