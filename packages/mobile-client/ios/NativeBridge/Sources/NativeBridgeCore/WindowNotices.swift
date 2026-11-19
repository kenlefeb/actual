import Foundation

// Fork-only (sc-5220). What the notice strip says. A timed notice hides itself;
// a persistent one stays until its condition ends.
public struct WindowNotice: Equatable {
    public enum Lifetime: Equatable {
        case timed(TimeInterval)
        case persistent
    }

    // Dismiss clears the notice; OK and Reload go to the notice's owner (sc-5219)
    public enum Button: Equatable {
        case dismiss, ok, reload
    }

    public let text: String
    public let lifetime: Lifetime
    public let button: Button

    public init(text: String, lifetime: Lifetime, button: Button = .dismiss) {
        self.text = text
        self.lifetime = lifetime
        self.button = button
    }

    // The page's process ended and the app reloaded it on its own
    public static let pageRestarted = WindowNotice(
        text: NSLocalizedString(
            "The app restarted just now, so your last change may not have been saved. Check it, and make it again if it’s missing.",
            comment: "Notice after the app reloaded its page on its own"),
        lifetime: .timed(15))
}

// The one notice slot. A persistent notice (the storage notices of
// native-durable-writes) shows at once, replaces a timed notice and drops one
// still waiting; a timed notice never appears over it. A timed notice waits
// until the page has loaded and the app is active, is announced to VoiceOver
// then, and counts down only while the app stays active. Hiding moves the page,
// so it waits until two seconds after the last touch.
@MainActor
public final class WindowNotices {
    public static let inputGrace: TimeInterval = 2

    public private(set) var current: WindowNotice? {
        didSet {
            if current != oldValue { onChange?(current) }
        }
    }
    public var onChange: ((WindowNotice?) -> Void)?
    // OK or Reload on the showing notice; its owner decides what ends it
    public var onButton: ((WindowNotice) -> Void)?

    private let schedule: (TimeInterval, @escaping () -> Void) -> Void
    private let announce: (String) -> Void
    private let now: () -> Date
    private var waiting: WindowNotice?
    // Persistent notices waiting for the showing one to end, in order
    private var behind: [WindowNotice] = []
    private var pageLoaded = false
    private var windowActive = false
    private var lastInput = Date.distantPast
    // The running countdown; an older timer finds a different value and does nothing
    private var hideToken: Int?
    private var nextToken = 0

    public init(
        schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void, announce: @escaping (String) -> Void,
        now: @escaping () -> Date = Date.init
    ) {
        self.schedule = schedule
        self.announce = announce
        self.now = now
    }

    public func show(_ notice: WindowNotice) {
        if notice.lifetime == .persistent {
            waiting = nil
            hideToken = nil
            // Already showing: announced once is enough
            guard current != notice else { return }
            behind.removeAll { $0 == notice }
            // A notice still waiting for its button comes back when this one ends
            if let shown = current, shown.lifetime == .persistent { behind.insert(shown, at: 0) }
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
    public func clear() {
        waiting = nil
        guard current?.lifetime != .persistent else { return }
        hideToken = nil
        current = nil
    }

    // The strip's button
    public func tap() {
        guard let current else { return }
        if current.button == .dismiss {
            clear()
        } else {
            onButton?(current)
        }
    }

    // A persistent notice that waits behind a showing persistent one
    public func queue(_ notice: WindowNotice) {
        guard current?.lifetime == .persistent, current != notice else { return show(notice) }
        if !behind.contains(notice) { behind.append(notice) }
    }

    // Ends one notice, shown or waiting; the next waiting one then shows
    public func end(_ notice: WindowNotice) {
        behind.removeAll { $0 == notice }
        guard current == notice else { return }
        current = nil
        if !behind.isEmpty { show(behind.removeFirst()) }
    }

    public func pageDidLoad() {
        pageLoaded = true
        startIfReady()
    }

    public func windowChanged(isActive: Bool) {
        windowActive = isActive
        if isActive {
            startIfReady()
        } else {
            hideToken = nil
        }
    }

    public func noteInput() {
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
