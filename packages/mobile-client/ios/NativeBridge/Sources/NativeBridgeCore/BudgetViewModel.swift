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

    public init(client: NativeBridgeClient, now: @escaping () -> Date = Date.init, calendar: Calendar = .current) {
        self.client = client
        self.now = now
        self.calendar = calendar
        month = Self.currentMonth(now(), calendar: calendar)
    }

    // Also the retry action of the error state, and the reload each time the
    // tab shows. Until the user picks another month it is taken again each
    // time, so the tab never keeps showing last month after midnight; once
    // they have, that month stays.
    public func load() async {
        if !navigated { month = Self.currentMonth(now(), calendar: calendar) }
        let target = wanted ?? month
        requests += 1
        let mine = requests
        if case .loaded = state {} else { state = .loading }
        do {
            let result = try await client.budgetMonth(target)
            guard mine == requests else { return }
            wanted = nil
            state = result.budgetType == .tracking ? .useWebScreen : .loaded(result)
        } catch {
            guard mine == requests else { return }
            wanted = nil
            state = .failed(BudgetLoadError.from(error))
        }
    }

    // Month navigation (sc-3760). Nothing handler-free lists the budget's
    // months, so the edge is learned by asking: a step into a month with no
    // budget makes one read, fails with loot-core's own "no budget" answer and
    // stays where it was; that month and everything beyond it is then out.
    // shortcut: the picker's window is 24 months back and 12 forward, widening as
    // the user steps; upgrade if the budget gets an additive range field.
    private var navigated = false
    // Taps do not wait for the read before them: each read gets a number, only
    // the latest may change the screen, and a step starts from the month the
    // latest tap asked for, not the one still on screen.
    private var requests = 0
    private var wanted: String?
    private var missingBefore: String?
    private var missingAfter: String?

    public var canGoPrevious: Bool { isReachable(Self.shift(month, by: -1)) }
    public var canGoNext: Bool { isReachable(Self.shift(month, by: 1)) }

    public var pickerMonths: [String] {
        (-24...12).map { Self.shift(month, by: $0) }.filter(isReachable)
    }

    public func previous() async { await select(Self.shift(wanted ?? month, by: -1)) }
    public func next() async { await select(Self.shift(wanted ?? month, by: 1)) }

    public func select(_ target: String) async {
        guard target != (wanted ?? month), isReachable(target) else { return }
        requests += 1
        let mine = requests
        wanted = target
        do {
            let result = try await client.budgetMonth(target)
            guard mine == requests else { return }
            wanted = nil
            navigated = true
            month = target
            state = result.budgetType == .tracking ? .useWebScreen : .loaded(result)
        } catch {
            let failure = BudgetLoadError.from(error)
            if failure == .noBudgetForMonth {
                // What the edge is does not depend on which tap was last
                if target < month { missingBefore = target } else { missingAfter = target }
            }
            guard mine == requests else { return }
            wanted = nil
            // Keep the month and numbers on screen
            if failure == .noBudgetForMonth { return }
            navigated = true
            month = target
            state = .failed(failure)
        }
    }

    private func isReachable(_ candidate: String) -> Bool {
        candidate > (missingBefore ?? "") && candidate < (missingAfter ?? "9999-99")
    }

    static func shift(_ month: String, by offset: Int) -> String {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return month }
        let index = parts[0] * 12 + (parts[1] - 1) + offset
        return String(format: "%04d-%02d", index / 12, index % 12 + 1)
    }

    public static func currentMonth(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month], from: now)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
