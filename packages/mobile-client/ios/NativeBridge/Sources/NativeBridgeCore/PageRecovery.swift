import Foundation

#if canImport(WebKit)
import WebKit
#endif

// Fork-only (sc-5186, sc-5247). Limits automatic page reloads: at most `limit`
// within `window` seconds, so a page whose process keeps dying doesn't reload
// forever. Past that, the app asks the user instead. The Mac and iPhone apps
// share it.
public struct ReloadGuard {
    public let limit: Int
    public let window: TimeInterval
    private var recent: [Date] = []

    public init(limit: Int = 3, window: TimeInterval = 60) {
        self.limit = limit
        self.window = window
    }

    public mutating func allowsReload(at now: Date) -> Bool {
        recent.removeAll { now.timeIntervalSince($0) >= window }
        guard recent.count < limit else { return false }
        recent.append(now)
        return true
    }

    public mutating func reset() {
        recent = []
    }
}

// Fork-only (sc-5247). What the iPhone app does when WebKit ends the page's
// process: reload, until the guard says to ask the user.
@MainActor
public final class PageRecovery {
    private var reloads = ReloadGuard()
    private let now: () -> Date
    private let reload: () -> Void
    private let giveUp: () -> Void

    public init(now: @escaping () -> Date = Date.init, reload: @escaping () -> Void, giveUp: @escaping () -> Void) {
        self.now = now
        self.reload = reload
        self.giveUp = giveUp
    }

    public func processEnded() {
        if reloads.allowsReload(at: now()) {
            reload()
        } else {
            giveUp()
        }
    }

    // The user's Reload, after the app stopped reloading on its own
    public func userReload() {
        reloads.reset()
        reload()
    }
}

#if canImport(WebKit)
// Fork-only (sc-5247). Sits in front of Capacitor's navigation handler, whose
// reaction to an ended page process is to reload the current URL: that can be
// a one-time sign-in callback that now answers with an error. Capacitor creates
// its handler inside a final method, so it can't be subclassed in; this takes
// that one call and passes every other one to the handler unchanged.
public final class PageProcessDelegate: NSObject, WKNavigationDelegate {
    private let handler: NSObject & WKNavigationDelegate
    private let onProcessEnded: () -> Void

    public init(forwardingTo handler: NSObject & WKNavigationDelegate, onProcessEnded: @escaping () -> Void) {
        self.handler = handler
        self.onProcessEnded = onProcessEnded
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onProcessEnded()
    }

    override public func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || handler.responds(to: selector)
    }

    override public func forwardingTarget(for selector: Selector!) -> Any? {
        super.responds(to: selector) ? nil : handler
    }
}
#endif
