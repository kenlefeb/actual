import Foundation

// Fork-only (sc-3584). Turns a burst of `cells-changed` / `sync-event`
// messages into one re-read: the first event schedules `onFire` after
// `interval` (a frame by default), and events before then join it.
public final class ChangeCoalescer {
    public var onFire: () -> Void
    private let interval: TimeInterval
    private let queue: DispatchQueue
    private var pending = false

    public init(interval: TimeInterval = 1.0 / 60, queue: DispatchQueue = .main, onFire: @escaping () -> Void) {
        self.interval = interval
        self.queue = queue
        self.onFire = onFire
    }

    // Call on `queue`
    public func notify() {
        guard !pending else { return }
        pending = true
        queue.asyncAfter(deadline: .now() + interval) { [weak self] in
            guard let self else { return }
            self.pending = false
            self.onFire()
        }
    }
}
