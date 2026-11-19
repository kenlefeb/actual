import Foundation

#if canImport(WebKit)
import WebKit
#endif

// Fork-only (sc-5399). A page's alert, confirm and prompt hold all of the
// page's JavaScript until WebKit gets an answer, and with it every bridge call.
// So the shell always answers: the person's answer, or the safe one (Cancel)
// when the dialog can't show, the page keeps asking, or the page goes away.
// Once on screen a dialog waits for the person for as long as it takes. The
// Mac and iPhone apps share it.
public enum PageDialogKind: Equatable {
    case alert
    case confirm
    case prompt(defaultText: String?)

    // What the page gets when the person can't answer: Cancel
    public var safeAnswer: PageDialogAnswer {
        switch self {
        case .alert: .dismissed
        case .confirm: .confirmed(false)
        case .prompt: .text(nil)
        }
    }
}

public enum PageDialogAnswer: Equatable {
    case dismissed
    case confirmed(Bool)
    case text(String?)
}

public struct PageDialogRequest: Equatable {
    public let kind: PageDialogKind
    public let message: String
    // nil for the app's own page; otherwise the page's host, as a browser
    // names the site, so another page's dialog can't pass for the app's
    public let title: String?

    public init(kind: PageDialogKind, message: String, title: String?) {
        self.kind = kind
        self.message = message
        self.title = title
    }

    // The heading for a page that has no host (a sandboxed frame, about:blank).
    // The one place these words live; the Product Owner confirms them.
    public static let otherPageLabel = NSLocalizedString(
        "Another page", comment: "Heading of a dialog from a page that isn't the app's and has no address to name")

    public static func title(isAppPage: Bool, host: String) -> String? {
        if isAppPage { return nil }
        return host.isEmpty ? otherPageLabel : shown(host)
    }

    // What of a page's text a dialog shows: plain text, cut with an ellipsis so
    // a huge message can't push the buttons off screen
    public static let maxShownLength = 1000

    public static func shown(_ text: String) -> String {
        guard text.count > maxShownLength else { return text }
        return String(text.prefix(maxShownLength - 1)) + "…"
    }

    // Capacitor's page script reads its cookie and HTTP settings with a prompt
    // carrying JSON, which its own handler answers without showing anything
    // (WebViewDelegationHandler). The test against the pinned Capacitor keeps
    // this list in step with it.
    public static let capacitorPromptTypes: Set<String> = [
        "CapacitorCookies.get", "CapacitorCookies.set", "CapacitorCookies.isEnabled", "CapacitorHttp",
    ]

    public static func isCapacitorCall(_ prompt: String) -> Bool {
        guard let data = prompt.data(using: .utf8),
            let payload = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as? [String: Any],
            let type = payload["type"] as? String
        else { return false }
        return capacitorPromptTypes.contains(type)
    }

    public enum PromptRoute: Equatable {
        // Capacitor's own call from the app's page: its handler answers
        case handler
        // One of Capacitor's calls from anywhere else: null, and nothing shown
        case refuse
        // A dialog for the person
        case dialog
    }

    // Security (PR #500): only the app's own page, as the main frame, reaches
    // Capacitor's cookie and HTTP handlers. Another page or a frame could
    // otherwise read or set the app server's cookies, or crash the app with a
    // malformed "set" (Capacitor force-unwraps its fields).
    public static func route(prompt: String, isAppPage: Bool) -> PromptRoute {
        guard isCapacitorCall(prompt) else { return .dialog }
        return isAppPage ? .handler : .refuse
    }
}

@MainActor
public final class PageDialogs {
    // Named exceptions to "the person answers" (design D13). They are fixed,
    // not configurable limits: limits live in the budget, and a dialog such as
    // "We had an unknown problem opening" comes when no budget could be read.
    // Can't show (no active window): tried every second, five times, then Cancel.
    public static let presentAttempts = 5
    public static let retryDelay: TimeInterval = 1
    // A page that keeps asking: past three dialogs in ten seconds it gets
    // Cancel unseen, so a page looping alert() can't pin the person or keep the
    // notice strip's Reload covered.
    public static let floodLimit = 3
    public static let floodWindow: TimeInterval = 10

    // Shows the dialog and returns how to take it off screen, or nil if it can't show now
    public typealias Present = (PageDialogRequest, @escaping @MainActor (PageDialogAnswer) -> Void) -> (() -> Void)?

    private let now: () -> Date
    private let schedule: (TimeInterval, @escaping @MainActor () -> Void) -> Void
    private let present: Present
    private var pending: [Pending] = []
    private var recent: [Date] = []

    public init(
        now: @escaping () -> Date = Date.init,
        schedule: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> Void = { delay, work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                work()
            }
        },
        present: @escaping Present
    ) {
        self.now = now
        self.schedule = schedule
        self.present = present
    }

    public func show(_ request: PageDialogRequest, completion: @escaping (PageDialogAnswer) -> Void) {
        let time = now()
        recent.removeAll { time.timeIntervalSince($0) >= Self.floodWindow }
        guard recent.count < Self.floodLimit else { return completion(request.kind.safeAnswer) }
        recent.append(time)
        let dialog = Pending(request: request, owner: self, completion: completion)
        pending.append(dialog)
        dialog.tryToShow(attempt: 1)
    }

    // The page reloaded or navigated away, its process ended, or its web view is
    // going: every dialog it asked for leaves the screen and gets Cancel, once
    public func pageWentAway() {
        let gone = pending
        pending = []
        recent = []
        gone.forEach { $0.cancel() }
    }

    private func finished(_ dialog: Pending) {
        pending.removeAll { $0 === dialog }
    }

    // One dialog: answered exactly once, whatever happens
    @MainActor
    private final class Pending {
        let request: PageDialogRequest
        weak var owner: PageDialogs?
        var completion: ((PageDialogAnswer) -> Void)?
        var dismiss: (() -> Void)?

        init(request: PageDialogRequest, owner: PageDialogs, completion: @escaping (PageDialogAnswer) -> Void) {
            self.request = request
            self.owner = owner
            self.completion = completion
        }

        func tryToShow(attempt: Int) {
            guard completion != nil, let owner else { return }
            dismiss = owner.present(request) { [self] answer in finish(answer) }
            guard dismiss == nil else { return }
            guard attempt < PageDialogs.presentAttempts else { return finish(request.kind.safeAnswer) }
            owner.schedule(PageDialogs.retryDelay) { [self] in tryToShow(attempt: attempt + 1) }
        }

        func cancel() {
            let shown = dismiss
            finish(request.kind.safeAnswer)
            shown?()
        }

        private func finish(_ answer: PageDialogAnswer) {
            guard let completion else { return }
            self.completion = nil
            dismiss = nil
            owner?.finished(self)
            completion(answer)
        }
    }
}

#if canImport(WebKit)
// Fork-only (sc-5399). Sits in front of a web view's UI delegate, as
// PageProcessDelegate does for navigation: it takes the page's alert, confirm
// and prompt to `onDialog`, which must always answer, and passes every other
// call to `handler` unchanged (Capacitor's handler on iPhone, the host's own
// on the Mac).
public final class PageDialogDelegate: NSObject, WKUIDelegate {
    private let handler: NSObject & WKUIDelegate
    private let isAppPage: (WKFrameInfo) -> Bool
    private let onDialog: (PageDialogRequest, @escaping (PageDialogAnswer) -> Void) -> Void

    // `isAppPage`: the app's own page, as the main frame, from the frame's security origin
    public init(
        forwardingTo handler: NSObject & WKUIDelegate, isAppPage: @escaping (WKFrameInfo) -> Bool,
        onDialog: @escaping (PageDialogRequest, @escaping (PageDialogAnswer) -> Void) -> Void
    ) {
        self.handler = handler
        self.isAppPage = isAppPage
        self.onDialog = onDialog
    }

    private func request(_ kind: PageDialogKind, _ message: String, _ frame: WKFrameInfo) -> PageDialogRequest {
        PageDialogRequest(
            kind: kind, message: PageDialogRequest.shown(message),
            title: PageDialogRequest.title(isAppPage: isAppPage(frame), host: frame.securityOrigin.host))
    }

    public func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        onDialog(request(.alert, message, frame)) { _ in completionHandler() }
    }

    public func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        onDialog(request(.confirm, message, frame)) { answer in
            if case .confirmed(let yes) = answer { completionHandler(yes) } else { completionHandler(false) }
        }
    }

    public func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
    ) {
        switch PageDialogRequest.route(prompt: prompt, isAppPage: isAppPage(frame)) {
        case .handler:
            // On iPhone, Capacitor's own call; a handler with none (the Mac) answers nothing
            guard let answer = handler.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)
            else { return completionHandler(nil) }
            return answer(webView, prompt, defaultText, frame, completionHandler)
        case .refuse:
            return completionHandler(nil)
        case .dialog:
            break
        }
        onDialog(request(.prompt(defaultText: defaultText.map(PageDialogRequest.shown)), prompt, frame)) { answer in
            if case .text(let text) = answer { completionHandler(text) } else { completionHandler(nil) }
        }
    }

    override public func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || handler.responds(to: selector)
    }

    override public func forwardingTarget(for selector: Selector!) -> Any? {
        super.responds(to: selector) ? nil : handler
    }
}
#endif
