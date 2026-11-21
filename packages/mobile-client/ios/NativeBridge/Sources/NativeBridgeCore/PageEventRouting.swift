import Foundation

// Fork-only (sc-5496, native-budget-opened-signal D2). Neither shell filters
// event names, and a loaded Budget screen re-reads on any change event. So
// `budget-opened` (loot-core finished opening a budget) goes only to its own
// handler, and returns before everything else a shell does with an event: the
// change path, the paychecks events and the sync status. Both shells call this.
public enum PageEventRouting {
    public static let budgetOpened = "budget-opened"

    public static func route(_ event: String, onBudgetOpened: (() -> Void)?, rest: () -> Void) {
        if event == budgetOpened { onBudgetOpened?() } else { rest() }
    }
}
