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
// process: reload, until the guard says to ask the user. `giveUp` returns
// whether the alert is on screen. It can't always be (no active window, another
// presentation under way), so it is tried again, and if it never shows the app
// reloads anyway: the page must not stay dead with nothing on screen.
@MainActor
public final class PageRecovery {
    public static let alertAttempts = 5
    public static let alertRetryDelay: TimeInterval = 1

    private var reloads = ReloadGuard()
    private let now: () -> Date
    private let schedule: (TimeInterval, @escaping @MainActor () -> Void) -> Void
    private let reload: () -> Void
    private let giveUp: () -> Bool
    // The ask under way, if the alert hasn't shown yet
    private var pendingAsk: Int?
    private var nextAsk = 0

    public init(
        now: @escaping () -> Date = Date.init,
        schedule: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> Void = { delay, work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                work()
            }
        },
        reload: @escaping () -> Void, giveUp: @escaping () -> Bool
    ) {
        self.now = now
        self.schedule = schedule
        self.reload = reload
        self.giveUp = giveUp
    }

    public func processEnded() {
        guard pendingAsk == nil else { return }
        if reloads.allowsReload(at: now()) {
            reload()
        } else {
            nextAsk += 1
            pendingAsk = nextAsk
            ask(nextAsk, attempt: 1)
        }
    }

    // The user's Reload, after the app stopped reloading on its own
    public func userReload() {
        pendingAsk = nil
        reloads.reset()
        reload()
    }

    private func ask(_ id: Int, attempt: Int) {
        guard pendingAsk == id else { return }
        if giveUp() {
            pendingAsk = nil
        } else if attempt < Self.alertAttempts {
            schedule(Self.alertRetryDelay) { [weak self] in self?.ask(id, attempt: attempt + 1) }
        } else {
            userReload()
        }
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
