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

    // Architect (PR #500): once on screen there is no time limit. A prompt
    // being typed in, or an alert the person hasn't read yet, stays.
    func testADialogOnScreenWaitsForThePersonHoweverLong() {
        let dialogs = dialogs()
        ask(dialogs, .prompt(defaultText: "Groceries"))
        XCTAssertTrue(scheduled.isEmpty, "nothing is timing the dialog")
        runScheduled()
        XCTAssertEqual(answers, [])
        XCTAssertEqual(dismissed, 0)
        answerShown?(.text("Groceries and food"))
        XCTAssertEqual(answers, [.text("Groceries and food")])
    }

    // The page or its process goes away: the dialog leaves the screen and the
    // page that asked gets Cancel, once, so no dialog is left over a dead page
    func testThePageGoingAwayDismissesAndAnswersCancelOnce() {
        for (kind, safe) in [(PageDialogKind.alert, PageDialogAnswer.dismissed), (.confirm, .confirmed(false)), (.prompt(defaultText: "x"), .text(nil))] {
            answers = []
            dismissed = 0
            let dialogs = dialogs()
            ask(dialogs, kind)
            dialogs.pageWentAway()
            XCTAssertEqual(answers, [safe], "\(kind)")
            XCTAssertEqual(dismissed, 1, "the dialog leaves the screen")
            answerShown?(.confirmed(true))
            dialogs.pageWentAway()
            XCTAssertEqual(answers, [safe], "a late tap or a second report changes nothing")
            XCTAssertEqual(dismissed, 1)
        }
    }

    func testThePageGoingAwayStopsTheTries() {
        canShow = false
        let dialogs = dialogs()
        ask(dialogs, .confirm)
        dialogs.pageWentAway()
        XCTAssertEqual(answers, [.confirmed(false)])
        canShow = true
        for _ in 0..<PageDialogs.presentAttempts { runScheduled(after: PageDialogs.retryDelay) }
        XCTAssertTrue(shown.isEmpty, "no dialog shows for a page that's gone")
        XCTAssertEqual(answers, [.confirmed(false)])
    }

    func testANewPageCanAskAgain() {
        let dialogs = dialogs()
        ask(dialogs, .alert, "old page")
        dialogs.pageWentAway()
        ask(dialogs, .alert, "new page")
        XCTAssertEqual(shown.map(\.message), ["old page", "new page"])
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
    }

    // Security (PR #500): a sandboxed frame has no host; its dialog must not
    // look like the app's own
    func testAPageWithNoHostIsHeadedAnotherPage() {
        XCTAssertEqual(PageDialogRequest.title(isAppPage: false, host: ""), PageDialogRequest.otherPageLabel)
        XCTAssertEqual(PageDialogRequest.otherPageLabel, "Another page")
    }

    // Capacitor's page script asks the shell for cookie and HTTP settings with a
    // prompt carrying JSON; those are its own calls, not dialogs for the person
    func testCapacitorsOwnPromptsAreNotDialogs() {
        for type in ["CapacitorCookies.get", "CapacitorCookies.set", "CapacitorCookies.isEnabled", "CapacitorHttp"] {
            XCTAssertTrue(PageDialogRequest.isCapacitorCall(#"{"type":"\#(type)"}"#), type)
        }
        XCTAssertFalse(PageDialogRequest.isCapacitorCall("Name the new category"))
        XCTAssertFalse(PageDialogRequest.isCapacitorCall(#"{"type":"something else"}"#))
        XCTAssertFalse(PageDialogRequest.isCapacitorCall(#"["CapacitorHttp"]"#))
        XCTAssertFalse(PageDialogRequest.isCapacitorCall("{"))
    }

    // Security (PR #500): only the app's own page, as the main frame, reaches
    // Capacitor's cookie and HTTP handlers; anything else that sends one of its
    // calls gets null and no dialog
    func testCapacitorsCallsGoToCapacitorOnlyFromTheAppsOwnPage() {
        let call = #"{"type":"CapacitorCookies.get"}"#
        XCTAssertEqual(PageDialogRequest.route(prompt: call, isAppPage: true), .handler)
        XCTAssertEqual(PageDialogRequest.route(prompt: call, isAppPage: false), .refuse)
        XCTAssertEqual(PageDialogRequest.route(prompt: "Name the new category", isAppPage: false), .dialog)
        XCTAssertEqual(PageDialogRequest.route(prompt: "Name the new category", isAppPage: true), .dialog)
    }

    // If a Capacitor upgrade adds a call of this kind, show it here rather than
    // as JSON to a person. Reads the pinned Capacitor source when it's installed.
    func testThePassThroughTypesMatchThePinnedCapacitor() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../../../node_modules/@capacitor/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift")
            .standardizedFileURL
        guard let source = try? String(contentsOf: root, encoding: .utf8) else {
            throw XCTSkip("Capacitor isn't installed at \(root.path)")
        }
        let prompt = source.components(separatedBy: "runJavaScriptTextInputPanelWithPrompt").dropFirst().first ?? ""
        let checked = prompt.components(separatedBy: "guard let viewController").first ?? ""
        let pattern = try NSRegularExpression(pattern: #"type == "([^"]+)""#)
        let types = Set(pattern.matches(in: checked, range: NSRange(checked.startIndex..., in: checked)).compactMap {
            Range($0.range(at: 1), in: checked).map { String(checked[$0]) }
        })
        XCTAssertEqual(types, PageDialogRequest.capacitorPromptTypes)
    }

    // Security (PR #500): a huge message can't push the buttons off screen
    func testALongMessageIsCutWithAnEllipsis() {
        let long = String(repeating: "a", count: PageDialogRequest.maxShownLength + 50)
        let shown = PageDialogRequest.shown(long)
        XCTAssertEqual(shown.count, PageDialogRequest.maxShownLength)
        XCTAssertTrue(shown.hasSuffix("…"))
        XCTAssertEqual(PageDialogRequest.shown("Delete this?"), "Delete this?")
    }

    // Security (PR #500): a page looping alert() can't pin the person. Past
    // `floodLimit` dialogs in `floodWindow` seconds, the page gets Cancel unseen.
    func testAPageThatKeepsAskingIsAnsweredCancelWithoutShowing() {
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let dialogs = PageDialogs(
            now: { clock },
            schedule: { [unowned self] in self.scheduled.append(($0, $1)) },
            present: { [unowned self] request, answer in
                self.shown.append(request)
                self.answerShown = answer
                return {}
            })
        for _ in 0..<PageDialogs.floodLimit {
            ask(dialogs, .alert)
            answerShown?(.dismissed)
            clock += 1
        }
        ask(dialogs, .confirm, "one too many")
        XCTAssertEqual(shown.count, PageDialogs.floodLimit)
        XCTAssertEqual(answers.last, .confirmed(false))
        // Later, the page may ask again
        clock += PageDialogs.floodWindow
        ask(dialogs, .alert, "later")
        XCTAssertEqual(shown.last?.message, "later")
    }

    // Designer (PR #500): each Cancel given unseen is logged, without the page's
    // text, so a real page that hits a limit can be found
    func testEachCancelGivenUnseenIsReportedWithoutThePagesText() {
        var reported: [PageDialogs.Unseen] = []
        var clock = Date(timeIntervalSince1970: 1_000_000)
        canShow = false
        let dialogs = PageDialogs(
            now: { clock },
            schedule: { [unowned self] in self.scheduled.append(($0, $1)) },
            present: { [unowned self] request, answer in
                guard self.canShow else { return nil }
                self.answerShown = answer
                return {}
            },
            reportUnseen: { reported.append($0) })
        dialogs.show(PageDialogRequest(kind: .confirm, message: "secret", title: nil)) { _ in }
        for _ in 1..<PageDialogs.presentAttempts { runScheduled(after: PageDialogs.retryDelay) }
        XCTAssertEqual(reported, [PageDialogs.Unseen(reason: .couldNotShow, kind: "confirm", isAppPage: true)])

        canShow = true
        for _ in 1..<PageDialogs.floodLimit {
            dialogs.show(PageDialogRequest(kind: .alert, message: "secret", title: nil)) { _ in }
            answerShown?(.dismissed)
            clock += 1
        }
        dialogs.show(PageDialogRequest(kind: .prompt(defaultText: "secret"), message: "secret", title: "login.example.com")) { _ in }
        XCTAssertEqual(reported.last, PageDialogs.Unseen(reason: .tooMany, kind: "prompt", isAppPage: false))
        XCTAssertFalse(reported.map(\.description).joined().contains("secret"), "the page's text is never logged")
        XCTAssertFalse(reported.map(\.description).joined().contains("example"), "nor the other page's address")
    }

    // Architect (PR #500): a sliding window over the dialogs the page asked for,
    // shown or not; one the rule itself answers unseen doesn't count
    func testTheFloodRuleIsASlidingWindowOverDialogsAsked() {
        var clock = Date(timeIntervalSince1970: 1_000_000)
        canShow = false
        let dialogs = PageDialogs(
            now: { clock },
            schedule: { [unowned self] in self.scheduled.append(($0, $1)) },
            present: { [unowned self] request, _ in
                guard self.canShow else { return nil }
                self.shown.append(request)
                return {}
            })
        // Three that never showed still count
        for second in 0..<PageDialogs.floodLimit {
            clock = Date(timeIntervalSince1970: 1_000_000 + Double(second * 3))
            ask(dialogs, .alert, "asked \(second)")
        }
        canShow = true
        clock = Date(timeIntervalSince1970: 1_000_009)
        ask(dialogs, .alert, "fourth within ten seconds")
        XCTAssertTrue(shown.isEmpty)
        // At 10 s the first has slid out of the window; the other two still count
        clock = Date(timeIntervalSince1970: 1_000_010)
        ask(dialogs, .alert, "slid")
        XCTAssertEqual(shown.map(\.message), ["slid"])
        ask(dialogs, .alert, "full again")
        XCTAssertEqual(shown.map(\.message), ["slid"])
    }

    func testANewPageStartsTheCountAgain() {
        let dialogs = dialogs()
        for _ in 0..<PageDialogs.floodLimit {
            ask(dialogs, .alert)
            answerShown?(.dismissed)
        }
        dialogs.pageWentAway()
        ask(dialogs, .alert, "the new page")
        XCTAssertEqual(shown.last?.message, "the new page")
    }

    func testTheSafeAnswerIsCancel() {
        XCTAssertEqual(PageDialogKind.alert.safeAnswer, .dismissed)
        XCTAssertEqual(PageDialogKind.confirm.safeAnswer, .confirmed(false))
        XCTAssertEqual(PageDialogKind.prompt(defaultText: "x").safeAnswer, .text(nil))
    }
}
