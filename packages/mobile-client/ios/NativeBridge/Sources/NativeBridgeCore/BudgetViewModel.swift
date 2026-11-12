import Combine
import Foundation

// Fork-only (sc-3751, native-budget-screen spec). The read-only Budget tab's
// state. It holds the month exactly as loot-core returned it; the SwiftUI view
// renders those numbers and never adds them up.
public enum BudgetLoadError: Equatable {
    case timedOut
    // The budget has no row for the month: a retry cannot succeed
    case noBudgetForMonth
    case other

    public var canRetry: Bool { self != .noBudgetForMonth }

    public var message: String {
        switch self {
        case .timedOut:
            return NSLocalizedString("The budget did not answer in time.", comment: "Native Budget tab error")
        case .noBudgetForMonth:
            return NSLocalizedString("This budget has no data for this month yet.", comment: "Native Budget tab empty state")
        case .other:
            return NSLocalizedString("The budget could not be loaded.", comment: "Native Budget tab error")
        }
    }

    // loot-core throws "native/budget-month: no budget for month <m>"; WebKit
    // carries the text in the NSError's user info
    static func from(_ error: Error) -> BudgetLoadError {
        if case NativeBridgeError.timedOut = error { return .timedOut }
        let text = "\(error) \((error as NSError).userInfo)"
        return text.contains("no budget for month") ? .noBudgetForMonth : .other
    }
}

public enum BudgetLoadState: Equatable {
    case loading
    case loaded(BudgetMonth)
    case failed(BudgetLoadError)
    // Tracking budgets show the web Budget screen until sc-3778 builds them
    case useWebScreen
}

@MainActor
public final class BudgetViewModel: ObservableObject {
    @Published public private(set) var state: BudgetLoadState = .loading
    // The current month as of the last load
    @Published public private(set) var month: String
    private let client: NativeBridgeClient
    private let now: () -> Date
    private let calendar: Calendar
    // A suspended page does not answer, so nothing reads while inactive
    private var isSceneActive = true
    private var coalescer: ChangeCoalescer?

    public init(
        client: NativeBridgeClient, now: @escaping () -> Date = Date.init, calendar: Calendar = .current,
        changeInterval: TimeInterval = 1.0 / 60
    ) {
        self.client = client
        self.now = now
        self.calendar = calendar
        month = Self.currentMonth(now(), calendar: calendar)
        coalescer = ChangeCoalescer(interval: changeInterval) { [weak self] in
            guard let self, self.isSceneActive else { return }
            Task { @MainActor in await self.load() }
        }
    }

    // A `cells-changed` or `sync-event` from the page: one re-read per frame
    public func changeEventReceived() {
        guard isSceneActive else { return }
        coalescer?.notify()
    }

    // Events during the background are dropped; the one read on returning covers them
    public func setSceneActive(_ active: Bool) async {
        guard active != isSceneActive else { return }
        isSceneActive = active
        if active { await load() }
    }

    // Also the retry action of the error state, and the reload each time the
    // tab shows. The month is taken again each time, so the tab never keeps
    // showing last month after midnight.
    public func load() async {
        month = Self.currentMonth(now(), calendar: calendar)
        if case .loaded = state {} else { state = .loading }
        do {
            let result = try await client.budgetMonth(month)
            state = result.budgetType == .tracking ? .useWebScreen : .loaded(result)
        } catch {
            state = .failed(BudgetLoadError.from(error))
        }
    }

    public static func currentMonth(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month], from: now)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
