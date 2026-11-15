import Foundation

// Fork-only (sc-4309, native-paychecks-screen spec). What the Budget tab's
// paycheck row shows. Every value is the read's `summary` block, worked out in
// loot-core; this only names the state (ADR 11). nil: no row.
public enum PaycheckSummaryRow: Equatable {
    // No paychecks: a prompt to add one, never zeros
    case addPrompt
    case upcoming(date: String, net: Int, scheduleCount: Int, warning: Bool, style: BudgetAmountStyle)
    // Paychecks exist but none has a pay date ahead
    case noneUpcoming(scheduleCount: Int, warning: Bool)

    // `read` is the last good read (nil before the first). The row shows only
    // while the per-device switch and the paychecks feature are both on.
    public init?(read: SchedulesPaychecks?, switchOn: Bool) {
        guard switchOn, let read, read.enabled else { return nil }
        let summary = read.summary
        if !summary.hasPaychecks {
            self = .addPrompt
        } else if let date = summary.nextDate, let net = summary.netAmount {
            self = .upcoming(date: date, net: net, scheduleCount: summary.scheduleCount, warning: summary.anyWarning, style: read.amountStyle)
        } else {
            self = .noneUpcoming(scheduleCount: summary.scheduleCount, warning: summary.anyWarning)
        }
    }
}

extension NativeScreenSwitch {
    // Whether the native Budget overlay stays alive. It also stays while the
    // native list lies over it (opened from the row), so going back finds the
    // same month and scroll position (sc-4309).
    public static func keepsBudgetOverlay(
        budgetNative: Bool, tabBarShown: Bool, path: String, selected: NativeTab, paychecksNative: Bool
    ) -> Bool {
        guard budgetNative, tabBarShown else { return false }
        return path == NativeTab.budget.rootPath || (path == "/schedules" && selected == .budget && paychecksNative)
    }
}
