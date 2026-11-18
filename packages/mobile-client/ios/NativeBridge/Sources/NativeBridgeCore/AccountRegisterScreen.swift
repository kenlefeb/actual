import Foundation

// Fork-only (sc-3611, native-accounts-screen D7). What the native register
// shows besides loot-core's numbers: date sections, each row's status word and
// the actions a row offers. Rows stay in loot-core's order. Free of UIKit, so
// the Mac app reuses it.

// One date section, newest first as loot-core sent the rows
public struct RegisterDay: Equatable, Identifiable {
    // yyyy-MM-dd
    public let date: String
    public let rows: [AccountRegister.Row]
    public var id: String { date }

    // Consecutive rows of one day form its section
    public static func days(of rows: [AccountRegister.Row]) -> [RegisterDay] {
        var days: [RegisterDay] = []
        for row in rows {
            if let last = days.last, last.date == row.date {
                days[days.count - 1] = RegisterDay(date: last.date, rows: last.rows + [row])
            } else {
                days.append(RegisterDay(date: row.date, rows: [row]))
            }
        }
        return days
    }

    // "Today", "Yesterday", else the weekday and date, with the year when it is not this year's
    public static func title(
        _ day: String, today: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.calendar = calendar
        parser.timeZone = calendar.timeZone
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: day) else { return day }
        if calendar.isDate(date, inSameDayAs: today) {
            return NSLocalizedString("Today", comment: "Native Accounts register: date section")
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: today), calendar.isDate(date, inSameDayAs: yesterday) {
            return NSLocalizedString("Yesterday", comment: "Native Accounts register: date section")
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: today)
        formatter.setLocalizedDateFormatFromTemplate(sameYear ? "EEEEMMMd" : "EEEEMMMdyyyy")
        return formatter.string(from: date)
    }
}

// The search footer: "N results" and their total, both loot-core's (D1)
public struct RegisterResults: Equatable {
    public let count: Int
    public let total: Int
}

extension AccountRegisterContent {
    // While any filter is active (a search or a scope other than All), from the first page
    public func results(search: String, scope: AccountRegisterScope) -> RegisterResults? {
        guard !search.isEmpty || scope != .all, let count = first.resultCount, let total = first.resultTotal else { return nil }
        return RegisterResults(count: count, total: total)
    }
}

extension AccountsLoadError {
    // The register's own words: it reads transactions, not the account list
    public var registerMessage: String {
        switch self {
        case .timedOut: NSLocalizedString("Transactions did not load in time.", comment: "Native Accounts register: read timed out")
        case .other: NSLocalizedString("Transactions could not be loaded.", comment: "Native Accounts register: read failed")
        }
    }
}

// A change to resend with confirmedReconciled once the person confirms
public enum RegisterRetry: Equatable {
    case delete(AccountRegister.Row)
    case categorize(AccountRegister.Row, category: String?)

    public var row: AccountRegister.Row {
        switch self {
        case .delete(let row), .categorize(let row, _): row
        }
    }
}

// The status word a row shows (D7), never colour alone
public enum RegisterRowStatus: Equatable {
    case pending, cleared, reconciled

    public init(_ row: AccountRegister.Row) {
        self = row.reconciled ? .reconciled : row.cleared ? .cleared : .pending
    }
}

// What a row offers. loot-core refuses the rest anyway (D3); the screen does
// not offer it.
public struct RegisterRowActions: Equatable {
    // Clear or Unclear: native/reconcile-tick refuses a reconciled row
    public let canClear: Bool
    // Not a split, an off-budget account's row or an on-budget transfer
    public let canCategorize: Bool
    public let canDelete: Bool
    // The row or its transfer partner is reconciled: confirm before a change
    public let asksFirst: Bool

    public init(canClear: Bool, canCategorize: Bool, canDelete: Bool, asksFirst: Bool) {
        (self.canClear, self.canCategorize, self.canDelete, self.asksFirst) = (canClear, canCategorize, canDelete, asksFirst)
    }

    // `transferOffBudget`: whether a transfer's other account is off budget; nil for no transfer
    public init(_ row: AccountRegister.Row, accountOffBudget: Bool, transferOffBudget: Bool?, readOnly: Bool) {
        guard !readOnly else {
            self.init(canClear: false, canCategorize: false, canDelete: false, asksFirst: false)
            return
        }
        let categorizable = !accountOffBudget && row.splitCount == 0 && (row.transferAccount == nil || transferOffBudget == true)
        self.init(
            canClear: !row.reconciled, canCategorize: categorizable, canDelete: true,
            asksFirst: row.reconciled || row.transferReconciled == true)
    }
}

// An Undo offer's lifetime: a newer offer or a withdrawal ends the older one's timer
@MainActor
final class UndoWindow {
    private let interval: TimeInterval
    private let sleep: AccountsSleep
    private var generation = 0

    init(interval: TimeInterval, sleep: @escaping AccountsSleep) {
        (self.interval, self.sleep) = (interval, sleep)
    }

    func open(onExpiry: @escaping @MainActor () -> Void) {
        generation += 1
        let mine = generation
        let (pause, wait) = (interval, sleep)
        Task { [weak self] in
            try? await wait(pause)
            guard let self, self.generation == mine else { return }
            onExpiry()
        }
    }

    func close() { generation += 1 }
}
