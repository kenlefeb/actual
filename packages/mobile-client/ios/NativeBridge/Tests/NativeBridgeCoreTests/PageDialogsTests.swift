import XCTest

@testable import NativeBridgeCore

// sc-5399: a page's alert, confirm and prompt hold all of the page's
// JavaScript until they are answered, so the shell always answers: the person's
// answer, or the safe one when nobody can or does.
@MainActor
final class PageDialogsTests: XCTestCase {
    private var scheduled: [(delay: TimeInterval, work: () -> Void)] = []
    private var canShow = true
    private var shown: [PageDialogRequest] = []
    private var dismissed = 0
    private var answerShown: ((PageDialogAnswer) -> Void)?
    private var answers: [PageDialogAnswer] = []

    private func dialogs() -> PageDialogs {
        PageDialogs(
            schedule: { [unowned self] in self.scheduled.append(($0, $1)) },
            present: { [unowned self] request, answer in
                guard self.canShow else { return nil }
                self.shown.append(request)
                self.answerShown = answer
                return { [unowned self] in self.dismissed += 1 }
            })
    }

    private func ask(_ dialogs: PageDialogs, _ kind: PageDialogKind, _ message: String = "Delete this?") {
        dialogs.show(PageDialogRequest(kind: kind, message: message, title: nil)) { [unowned self] in self.answers.append($0) }
    }

    private func runScheduled(after delay: TimeInterval? = nil) {
        let due = scheduled.filter { delay == nil || $0.delay == delay }
        scheduled.removeAll { item in due.contains { $0.delay == item.delay } }
        due.forEach { $0.work() }
    }

    func testThePersonsAnswerReachesThePageOnce() {
        let dialogs = dialogs()
        ask(dialogs, .confirm)
        XCTAssertEqual(shown.map(\.message), ["Delete this?"])
        answerShown?(.confirmed(true))
        answerShown?(.confirmed(false))
        runScheduled()
        XCTAssertEqual(answers, [.confirmed(true)])
        XCTAssertEqual(dismissed, 0, "the person's own answer closes the dialog")
    }

    func testANewDialogIsNotHeldByAnAnsweredOne() {
        let dialogs = dialogs()
        ask(dialogs, .alert, "first")
        answerShown?(.dismissed)
        ask(dialogs, .alert, "second")
        XCTAssertEqual(shown.map(\.message), ["first", "second"])
    }

    func testADialogNobodyAnswersIsClosedWithTheSafeAnswer() {
        for (kind, safe) in [(PageDialogKind.alert, PageDialogAnswer.dismissed), (.confirm, .confirmed(false)), (.prompt(defaultText: "x"), .text(nil))] {
            answers = []
            dismissed = 0
            let dialogs = dialogs()
            ask(dialogs, kind)
            runScheduled(after: PageDialogs.answerTimeout)
            XCTAssertEqual(answers, [safe], "\(kind)")
            XCTAssertEqual(dismissed, 1, "the unanswered dialog leaves the screen")
            answerShown?(.confirmed(true))
            XCTAssertEqual(answers, [safe], "a late tap changes nothing")
        }
    }

    func testADialogThatCannotShowIsTriedAgainThenAnsweredSafely() {
        canShow = false
        let dialogs = dialogs()
        ask(dialogs, .confirm)
        for _ in 1..<PageDialogs.presentAttempts {
            XCTAssertEqual(answers, [])
            runScheduled(after: PageDialogs.retryDelay)
        }
        XCTAssertEqual(answers, [.confirmed(false)])
        XCTAssertTrue(shown.isEmpty)
        XCTAssertTrue(scheduled.isEmpty, "nothing left waiting")
    }

    func testADialogShowsOnALaterTry() {
        canShow = false
        let dialogs = dialogs()
        ask(dialogs, .prompt(defaultText: "Groceries"))
        runScheduled(after: PageDialogs.retryDelay)
        canShow = true
        runScheduled(after: PageDialogs.retryDelay)
        XCTAssertEqual(shown.count, 1)
        answerShown?(.text("Food"))
        XCTAssertEqual(answers, [.text("Food")])
    }

    func testTheAppsOwnPageNeedsNoTitleAndAnyOtherPageNamesItsHost() {
        XCTAssertNil(PageDialogRequest.title(isAppPage: true, host: "localhost"))
        XCTAssertEqual(PageDialogRequest.title(isAppPage: false, host: "login.example.com"), "login.example.com")
        // A page with no host (about:blank, data:) still says it isn't the app
        XCTAssertEqual(PageDialogRequest.title(isAppPage: false, host: ""), "")
    }

    func testTheSafeAnswerIsCancel() {
        XCTAssertEqual(PageDialogKind.alert.safeAnswer, .dismissed)
        XCTAssertEqual(PageDialogKind.confirm.safeAnswer, .confirmed(false))
        XCTAssertEqual(PageDialogKind.prompt(defaultText: "x").safeAnswer, .text(nil))
    }
}
