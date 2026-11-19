import AppKit

protocol EngineWindow: AnyObject {
    func orderOut(_ sender: Any?)
    func makeKeyAndOrderFront(_ sender: Any?)
}

extension NSWindow: EngineWindow {}

// Fork-only (sc-4942). Keeps the engine alive. The web view lives in the main
// window, so closing the window only orders it out, and the app keeps running
// with no window. Views re-read when the app becomes active, when the Mac
// wakes while the app is active, and when the window is reopened; never while
// the app is inactive or the Mac is asleep, when WebKit may have suspended the page.
final class EngineLifecycle {
    static let terminatesAfterLastWindowClosed = false

    private let reread: () -> Void
    // sc-5219 (D8): asks storage to finish, then calls back; the client's deadline bounds it
    private let flush: (@escaping () -> Void) -> Void
    private var isActive = false
    private var isAsleep = false
    private var isTerminating = false

    init(reread: @escaping () -> Void, flush: @escaping (@escaping () -> Void) -> Void = { $0() }) {
        self.reread = reread
        self.flush = flush
    }

    func windowShouldClose(_ window: EngineWindow) -> Bool {
        flush { window.orderOut(nil) }
        return false
    }

    // AppKit allows one reply to a deferred quit
    func shouldTerminate(reply: @escaping () -> Void) {
        guard !isTerminating else { return }
        isTerminating = true
        flush(reply)
    }

    func reopen(_ window: EngineWindow) {
        window.makeKeyAndOrderFront(nil)
        rereadIfAwake()
    }

    func didBecomeActive() {
        isActive = true
        rereadIfAwake()
    }

    func didResignActive() {
        isActive = false
    }

    // Best effort: sleep cannot be delayed
    func willSleep() {
        isAsleep = true
        flush {}
    }

    func didWake() {
        isAsleep = false
        rereadIfAwake()
    }

    private func rereadIfAwake() {
        if isActive && !isAsleep { reread() }
    }
}
