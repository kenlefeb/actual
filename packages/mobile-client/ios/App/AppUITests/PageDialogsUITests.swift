import XCTest
import notify

// Fork-only (sc-5399). A page's alert, confirm and prompt hold all of the page's
// JavaScript until they are answered. The app shows them above any native
// screen and always answers the page. `-UITestPageDialog` (UITestPageDialogs.swift,
// Debug builds only) opens one from the app's own page.
final class PageDialogsUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ kind: String, cover: Bool = true, reloadOnSignal: Bool = false) {
        app.launchArguments = ["-UITestPageDialog", kind, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if cover { app.launchArguments += ["-UITestPageDialogCover", "YES"] }
        if reloadOnSignal { app.launchArguments += ["-UITestPageDialogReloadOnSignal", "YES"] }
        app.launch()
    }

    private var report: XCUIElement { app.staticTexts["uiTestPageDialog"] }

    private func alert(_ message: String) -> XCUIElement {
        let alert = app.alerts.firstMatch
        // A fresh simulator's first launch can take over a minute to load the page
        XCTAssertTrue(alert.waitForExistence(timeout: 120), "the page's dialog never showed")
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

    // Architect (PR #500): once on screen a dialog has no time limit, so what
    // the person typed is still there after a long wait
    func testATypedPromptSurvivesALongWait() {
        launch("prompt")
        let dialog = alert("Name the new category")
        let field = dialog.textFields.firstMatch
        field.tap()
        field.typeText(" and food")
        sleep(70)
        XCTAssertTrue(dialog.exists, "the dialog left the screen by itself")
        XCTAssertEqual(field.value as? String, "Groceries and food", "the typed text was lost")
        dialog.buttons["OK"].tap()
        XCTAssertTrue(report.waitForExistence(timeout: 10))
        XCTAssertEqual(report.label, "answer=Groceries and food page=answers")
    }

    // The page going away takes its dialog with it: none is left over a dead page
    func testThePageReloadingTakesItsDialogAway() {
        // The reload waits for this test's signal, sent once it has seen the dialog: any
        // delay the app picked was missed now and then by a slow runner's UI queries (CI,
        // 2026-11-20: 5 s, then 15 s, each time the dialog was up and gone unseen, the app
        // having answered correctly)
        launch("alert", reloadOnSignal: true)
        let dialog = alert("We had an unknown problem opening the budget.")
        XCTAssertEqual(notify_post("app.homeeconomics.uitest.reload-page"), UInt32(NOTIFY_STATUS_OK))
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: dialog)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 20), .completed, "the dialog stayed over the reloaded page")
    }
}
