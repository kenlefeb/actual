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
    private var isActive = false
    private var isAsleep = false

    init(reread: @escaping () -> Void) {
        self.reread = reread
    }

    func windowShouldClose(_ window: EngineWindow) -> Bool {
        window.orderOut(nil)
        return false
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

    func willSleep() {
        isAsleep = true
    }

    func didWake() {
        isAsleep = false
        rereadIfAwake()
    }

    private func rereadIfAwake() {
        if isActive && !isAsleep { reread() }
    }
}
