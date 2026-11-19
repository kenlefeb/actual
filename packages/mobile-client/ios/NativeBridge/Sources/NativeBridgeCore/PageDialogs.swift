import Foundation

#if canImport(WebKit)
import WebKit
#endif

// Fork-only (sc-5399). A page's alert, confirm and prompt hold all of the
// page's JavaScript until WebKit gets an answer, and with it every bridge call.
// So the shell always answers: the person's answer, or the safe one (Cancel)
// when the dialog can't show or nobody answers. The Mac and iPhone apps share it.
public enum PageDialogKind: Equatable {
    case alert
    case confirm
    case prompt(defaultText: String?)

    // What the page gets when nobody answers: Cancel
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

    public static func title(isAppPage: Bool, host: String) -> String? {
        isAppPage ? nil : host
    }

    // Capacitor's page script reads its cookie and HTTP settings with a prompt
    // carrying JSON, which its own handler answers without showing anything
    // (WebViewDelegationHandler). Those stay with Capacitor.
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
}

@MainActor
public final class PageDialogs {
    // Shown: how long the dialog waits for the person before Cancel answers it.
    // Not shown (no active window): tried every second, five times.
    public static let answerTimeout: TimeInterval = 60
    public static let presentAttempts = 5
    public static let retryDelay: TimeInterval = 1

    // Shows the dialog and returns how to take it off screen, or nil if it can't show now
    public typealias Present = (PageDialogRequest, @escaping @MainActor (PageDialogAnswer) -> Void) -> (() -> Void)?

    private let answerTimeout: TimeInterval
    private let schedule: (TimeInterval, @escaping @MainActor () -> Void) -> Void
    private let present: Present

    public init(
        answerTimeout: TimeInterval = PageDialogs.answerTimeout,
        schedule: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> Void = { delay, work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                work()
            }
        },
        present: @escaping Present
    ) {
        self.answerTimeout = answerTimeout
        self.schedule = schedule
        self.present = present
    }

    public func show(_ request: PageDialogRequest, completion: @escaping (PageDialogAnswer) -> Void) {
        Pending(request: request, owner: self, completion: completion).tryToShow(attempt: 1)
    }

    // One dialog: answered exactly once, whatever happens
    private final class Pending {
        let request: PageDialogRequest
        let owner: PageDialogs
        var completion: ((PageDialogAnswer) -> Void)?
        var dismiss: (() -> Void)?

        init(request: PageDialogRequest, owner: PageDialogs, completion: @escaping (PageDialogAnswer) -> Void) {
            self.request = request
            self.owner = owner
            self.completion = completion
        }

        func tryToShow(attempt: Int) {
            dismiss = owner.present(request) { [self] answer in finish(answer) }
            if dismiss != nil {
                owner.schedule(owner.answerTimeout) { [self] in
                    guard completion != nil else { return }
                    dismiss?()
                    finish(request.kind.safeAnswer)
                }
            } else if completion != nil {
                guard attempt < PageDialogs.presentAttempts else { return finish(request.kind.safeAnswer) }
                owner.schedule(PageDialogs.retryDelay) { [self] in tryToShow(attempt: attempt + 1) }
            }
        }

        private func finish(_ answer: PageDialogAnswer) {
            let completion = completion
            self.completion = nil
            dismiss = nil
            completion?(answer)
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
    private let handlerAnswersPrompt: (String) -> Bool
    private let onDialog: (PageDialogRequest, @escaping (PageDialogAnswer) -> Void) -> Void

    // `handlerAnswersPrompt`: a prompt that is the handler's own call, not a dialog
    // (on iPhone, Capacitor's; see PageDialogRequest.isCapacitorCall)
    public init(
        forwardingTo handler: NSObject & WKUIDelegate, isAppPage: @escaping (WKFrameInfo) -> Bool,
        handlerAnswersPrompt: @escaping (String) -> Bool = { _ in false },
        onDialog: @escaping (PageDialogRequest, @escaping (PageDialogAnswer) -> Void) -> Void
    ) {
        self.handler = handler
        self.isAppPage = isAppPage
        self.handlerAnswersPrompt = handlerAnswersPrompt
        self.onDialog = onDialog
    }

    private func request(_ kind: PageDialogKind, _ message: String, _ frame: WKFrameInfo) -> PageDialogRequest {
        PageDialogRequest(kind: kind, message: message, title: PageDialogRequest.title(isAppPage: isAppPage(frame), host: frame.securityOrigin.host))
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
        if handlerAnswersPrompt(prompt),
            let answer = handler.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)
        {
            return answer(webView, prompt, defaultText, frame, completionHandler)
        }
        onDialog(request(.prompt(defaultText: defaultText), prompt, frame)) { answer in
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
