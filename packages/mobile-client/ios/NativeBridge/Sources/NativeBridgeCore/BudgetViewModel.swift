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

public enum BudgetSaveError: Equatable {
    case invalidAmount
    case failed
    case timedOut
    // The write landed but the month could not be read again
    case refreshFailed

    public var message: String {
        switch self {
        case .invalidAmount:
            return NSLocalizedString("That is not an amount this budget can hold.", comment: "Native Budget tab: bad amount typed")
        case .failed:
            return NSLocalizedString("The amount could not be saved. The budget is unchanged.", comment: "Native Budget tab: save failed")
        case .timedOut:
            return NSLocalizedString("The budget did not answer in time. The amount was not saved.", comment: "Native Budget tab: save timed out")
        case .refreshFailed:
            return NSLocalizedString("Saved, but the budget could not be refreshed.", comment: "Native Budget tab: re-read failed after a save")
        }
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
    @Published public private(set) var saveError: BudgetSaveError?
    @Published public private(set) var isSaving = false
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

    public func clearSaveError() { saveError = nil }

    // Saves a typed budgeted amount for a category of the loaded month, then
    // reads the month again; the numbers shown are never patched locally. A
    // failed save keeps the old numbers and sets `saveError`; the write is
    // never retried. Returns whether the write was made (sc-3769).
    public func saveBudgeted(category id: String, text: String) async -> Bool {
        guard !isSaving, case .loaded(let snapshot) = state else { return false }
        saveError = nil
        // Only a category of the snapshot, never a group, income or to-budget
        guard snapshot.expenseGroups.contains(where: { $0.categories.contains { $0.id == id } }) else {
            saveError = .failed
            return false
        }
        guard let amount = BudgetAmountFormat.minorUnits(from: text, style: snapshot.amountStyle),
            let write = try? BudgetAmountWrite(category: id, month: snapshot.month, amount: amount)
        else {
            saveError = .invalidAmount
            return false
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await client.setBudgetAmount(write)
        } catch {
            if case NativeBridgeError.timedOut = error { saveError = .timedOut } else { saveError = .failed }
            return false
        }
        do {
            let result = try await client.budgetMonth(snapshot.month)
            state = result.budgetType == .tracking ? .useWebScreen : .loaded(result)
        } catch {
            saveError = .refreshFailed
        }
        return true
    }

    public static func currentMonth(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month], from: now)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
