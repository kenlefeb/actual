import Foundation

// Fork-only (sc-3584). Turns a burst of `cells-changed` / `sync-event`
// messages into one re-read: the first event schedules `onFire` after
// `interval` (a frame by default), and events before then join it.
// Runs `work` after `delay` seconds. A test supplies its own so the timer is
// driven by the test, not the wall clock (sc-4931).
public typealias ChangeSchedule = (TimeInterval, @escaping () -> Void) -> Void

public final class ChangeCoalescer {
    public var onFire: () -> Void
    private let interval: TimeInterval
    private let schedule: ChangeSchedule
    private var pending = false

    public init(
        interval: TimeInterval = 1.0 / 60, queue: DispatchQueue = .main, schedule: ChangeSchedule? = nil, onFire: @escaping () -> Void
    ) {
        self.interval = interval
        self.schedule = schedule ?? { delay, work in queue.asyncAfter(deadline: .now() + delay, execute: work) }
        self.onFire = onFire
    }

    // Call on `queue`
    public func notify() {
        guard !pending else { return }
        pending = true
        schedule(interval) { [weak self] in
            guard let self else { return }
            self.pending = false
            self.onFire()
        }
    }
}
