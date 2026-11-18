import Foundation

// Fork-only (story 5220). Brief notices shown in a strip at the top of the
// main window, over the page, without taking focus or blocking input. Each
// is announced to VoiceOver. A transient notice hides itself after
// `transientDuration`.
// One slot for every window notice, so later notices (story 5219's
// app-wide "not stored" notice) join this model instead of drawing a second
// banner: give them their own case here and decide precedence in `show`.
enum WindowNotice: Equatable {
    // The page's process ended and the app reloaded it on its own
    case pageRestarted

    var text: String {
        switch self {
        case .pageRestarted:
            String(localized: "The budget page restarted. If you changed something just now, check that it's still there.")
        }
    }
}

@MainActor
final class WindowNotices {
    static let transientDuration: TimeInterval = 8

    private(set) var current: WindowNotice? {
        didSet { onChange?(current) }
    }
    var onChange: ((WindowNotice?) -> Void)?

    private let schedule: (TimeInterval, @escaping () -> Void) -> Void
    private let announce: (String) -> Void
    // Which `show` the pending hide belongs to, so an older timer can't hide a newer notice
    private var generation = 0

    init(schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void, announce: @escaping (String) -> Void) {
        self.schedule = schedule
        self.announce = announce
    }

    func show(_ notice: WindowNotice) {
        generation += 1
        let shown = generation
        current = notice
        announce(notice.text)
        schedule(Self.transientDuration) { [weak self] in
            guard let self, self.generation == shown else { return }
            self.current = nil
        }
    }
}
