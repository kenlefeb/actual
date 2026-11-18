import Foundation

// Fork-only (story 5220). What the strip under the title bar says. A timed
// notice hides itself; a persistent one stays until its condition ends.
struct WindowNotice: Equatable {
    enum Lifetime: Equatable {
        case timed(TimeInterval)
        case persistent
    }

    let text: String
    let lifetime: Lifetime

    // The page's process ended and the app reloaded it on its own
    static let pageRestarted = WindowNotice(
        text: String(
            localized: "The app restarted just now, so your last change may not have been saved. Check it, and make it again if it’s missing."),
        lifetime: .timed(15))
}

// The window's one notice slot. A persistent notice (story 5219's "not
// stored") shows at once, replaces a timed notice and drops one still
// waiting; a timed notice never appears over it. A timed notice waits until
// the page has loaded and the window is key and visible, is announced to
// VoiceOver then, and counts down only while that holds. Hiding moves the
// page, so it waits until two seconds after the last input.
@MainActor
final class WindowNotices {
    static let inputGrace: TimeInterval = 2

    private(set) var current: WindowNotice? {
        didSet {
            if current != oldValue { onChange?(current) }
        }
    }
    var onChange: ((WindowNotice?) -> Void)?

    private let schedule: (TimeInterval, @escaping () -> Void) -> Void
    private let announce: (String) -> Void
    private let now: () -> Date
    private var waiting: WindowNotice?
    private var pageLoaded = false
    private var windowActive = false
    private var lastInput = Date.distantPast
    // The running countdown; an older timer finds a different value and does nothing
    private var hideToken: Int?
    private var nextToken = 0

    init(
        schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void, announce: @escaping (String) -> Void,
        now: @escaping () -> Date = Date.init
    ) {
        self.schedule = schedule
        self.announce = announce
        self.now = now
    }

    func show(_ notice: WindowNotice) {
        if notice.lifetime == .persistent {
            waiting = nil
            hideToken = nil
            current = notice
            announce(notice.text)
            return
        }
        guard current?.lifetime != .persistent else { return }
        hideToken = nil
        waiting = notice
        pageLoaded = false
    }

    // Removes a timed notice, shown or waiting. A persistent notice stays: it
    // ends only with its own condition.
    func clear() {
        waiting = nil
        guard current?.lifetime != .persistent else { return }
        hideToken = nil
        current = nil
    }

    func pageDidLoad() {
        pageLoaded = true
        startIfReady()
    }

    func windowChanged(isKeyAndVisible: Bool) {
        windowActive = isKeyAndVisible
        if isKeyAndVisible {
            startIfReady()
        } else {
            hideToken = nil
        }
    }

    func noteInput() {
        lastInput = now()
    }

    private func startIfReady() {
        guard pageLoaded, windowActive else { return }
        if let notice = waiting {
            waiting = nil
            current = notice
            announce(notice.text)
        }
        guard hideToken == nil, case .timed(let duration) = current?.lifetime else { return }
        nextToken += 1
        hideToken = nextToken
        scheduleHide(after: duration, token: nextToken)
    }

    private func scheduleHide(after delay: TimeInterval, token: Int) {
        schedule(delay) { [weak self] in self?.hide(token: token) }
    }

    private func hide(token: Int) {
        guard hideToken == token else { return }
        let sinceInput = now().timeIntervalSince(lastInput)
        if sinceInput < Self.inputGrace {
            scheduleHide(after: Self.inputGrace - sinceInput, token: token)
        } else {
            hideToken = nil
            current = nil
        }
    }
}
