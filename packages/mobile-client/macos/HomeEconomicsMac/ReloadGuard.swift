import Foundation

// Fork-only (story 5186). Limits automatic page reloads: at most `limit`
// within `window` seconds, so a page whose process keeps dying doesn't reload
// forever. Past that, the app asks the user instead.
struct ReloadGuard {
    let limit: Int
    let window: TimeInterval
    private var recent: [Date] = []

    init(limit: Int = 3, window: TimeInterval = 60) {
        self.limit = limit
        self.window = window
    }

    mutating func allowsReload(at now: Date) -> Bool {
        recent.removeAll { now.timeIntervalSince($0) >= window }
        guard recent.count < limit else { return false }
        recent.append(now)
        return true
    }

    mutating func reset() {
        recent = []
    }
}
