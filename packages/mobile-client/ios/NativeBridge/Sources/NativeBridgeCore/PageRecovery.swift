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
// whether the alert is on screen. It can't always be (the app isn't active,
// another presentation is under way), so it is tried every second, and at once
// when the app becomes active. After `alertAttempts` tries the app also reloads
// when the guard has a free slot, so the page doesn't stay dead with nothing on
// screen. Only the person's Reload resets the count: the cap always holds.
@MainActor
public final class PageRecovery {
    public static let alertAttempts = 5
    public static let alertRetryDelay: TimeInterval = 1

    // sc-5220: for the notice. The person's own Reload is not an event: it shows
    // no reload notice, and a notice about unsaved changes doesn't depend on it.
    public enum Event: Equatable {
        case automaticReload
        case asking
    }

    private var reloads = ReloadGuard()
    private let now: () -> Date
    private let schedule: (TimeInterval, @escaping @MainActor () -> Void) -> Void
    private let reload: () -> Void
    private let giveUp: () -> Bool
    private let onEvent: (Event) -> Void
    // The alert is wanted and hasn't shown yet
    private var asking = false
    private var attempts = 0
    private var retryScheduled = false

    public init(
        now: @escaping () -> Date = Date.init,
        schedule: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> Void = { delay, work in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                work()
            }
        },
        reload: @escaping () -> Void, giveUp: @escaping () -> Bool,
        onEvent: @escaping (Event) -> Void = { _ in }
    ) {
        self.now = now
        self.schedule = schedule
        self.reload = reload
        self.giveUp = giveUp
        self.onEvent = onEvent
    }

    public func processEnded() {
        guard !asking else { return }
        if reloads.allowsReload(at: now()) {
            reloadOnItsOwn()
        } else {
            asking = true
            attempts = 0
            onEvent(.asking)
            ask()
        }
    }

    // Reported first, so the notice is waiting before the load starts
    private func reloadOnItsOwn() {
        onEvent(.automaticReload)
        reload()
    }

    // The user's Reload, after the app stopped reloading on its own
    public func userReload() {
        asking = false
        reloads.reset()
        reload()
    }

    // The alert can show now, if one is waiting
    public func appBecameActive() {
        if asking { ask() }
    }

    private func ask() {
        attempts += 1
        if giveUp() {
            asking = false
        } else if attempts >= Self.alertAttempts, reloads.allowsReload(at: now()) {
            asking = false
            reloadOnItsOwn()
        } else if !retryScheduled {
            retryScheduled = true
            schedule(Self.alertRetryDelay) { [weak self] in
                guard let self else { return }
                self.retryScheduled = false
                if self.asking { self.ask() }
            }
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
