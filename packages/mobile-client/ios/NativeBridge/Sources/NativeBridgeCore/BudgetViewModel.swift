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
    // A refresh failed: the last good numbers stay, dimmed, with a retry
    case stale(BudgetMonth, BudgetLoadError)
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
    // A suspended page does not answer, so nothing reads while inactive
    private var isSceneActive = true
    private var coalescer: ChangeCoalescer?
    // Reads can overlap (an event while a load is in flight); only the newest counts
    private var loadGeneration = 0
    private var lastGood: BudgetMonth?

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

    // The page bridge posted "ready" (sc-3859): the app's own page is back, so
    // calls refused while a sign-in page showed can succeed again
    public func pageReady() async {
        guard isSceneActive else { return }
        await load()
    }

    // Events during the background are dropped; the one read on returning covers them
    public func setSceneActive(_ active: Bool) async {
        guard active != isSceneActive else { return }
        isSceneActive = active
        if active { await load() }
    }

    // Also the retry action of the error state, and the reload each time the
    // tab shows. Until the user picks another month it is taken again each
    // time, so the tab never keeps showing last month after midnight; once
    // they have, that month stays.
    public func load() async {
        if !navigated { month = Self.currentMonth(now(), calendar: calendar) }
        await read(wanted ?? month, isStep: false)
    }

    // The one read path: every load and every month step takes a number from
    // loadGeneration, and only the newest read may change the screen.
    private func read(_ target: String, isStep: Bool) async {
        loadGeneration += 1
        let generation = loadGeneration
        if isStep { wanted = target }
        if !isStep, lastGood == nil { state = .loading }
        do {
            let result = try await client.budgetMonth(target)
            guard generation == loadGeneration else { return }
            settle(on: target)
            lastGood = result
            state = .loaded(result)
        } catch {
            let failure = BudgetLoadError.from(error)
            // What the edge is does not depend on which read was the newest
            if isStep, failure == .noBudgetForMonth {
                if target < month { missingBefore = target } else { missingAfter = target }
            }
            guard generation == loadGeneration else { return }
            if isStep, failure == .noBudgetForMonth {
                // Keep the month and numbers on screen
                wanted = nil
                return
            }
            settle(on: target)
            // Keep the last good numbers, unless they are for another month
            if let good = lastGood, good.month == target, failure.canRetry {
                state = .stale(good, failure)
            } else {
                lastGood = nil
                state = .failed(failure)
            }
        }
    }

    public func clearSaveError() { saveError = nil }

    // Saves a typed budgeted amount for a category of the loaded month, then
    // reads the month again; the numbers shown are never patched locally. A
    // failed save keeps the old numbers and sets `saveError`; the write is
    // never retried. Returns whether the write was made (sc-3769).
    // `month` is the month the edit was opened on: a save never lands on a
    // month the user has stepped to since, or is stepping to now.
    public func saveBudgeted(month target: String, category id: String, text: String) async -> Bool {
        guard !isSaving, case .loaded(let snapshot) = state else { return false }
        saveError = nil
        // Only a category of the snapshot, never a group or to-budget; income only on a tracking budget
        guard snapshot.month == target, wanted == nil, snapshot.editableGroups.contains(where: { $0.categories.contains { $0.id == id } }) else {
            saveError = .failed
            return false
        }
        guard let amount = BudgetAmountFormat.minorUnits(from: text, style: snapshot.amountStyle),
            let value = try? BudgetAmountWrite(category: id, month: snapshot.month, amount: amount)
        else {
            saveError = .invalidAmount
            return false
        }
        return await write { try await self.client.setBudgetAmount(value) }
    }

    // Move money (sc-3787): only on a loaded envelope month with no month step pending
    public var canMoveMoney: Bool {
        guard case .loaded(let snapshot) = state else { return false }
        return snapshot.budgetType == .envelope && wanted == nil
    }

    // The sheet opens with all the source holds, and accepts no more (stricter than the web)
    public func movePrefill(from source: MoveEnd) -> String {
        guard case .loaded(let snapshot) = state else { return "" }
        return BudgetAmountFormat.editString(max(Transfer.limit(of: source, in: snapshot) ?? 0, 0), style: snapshot.amountStyle)
    }

    public func moveLimitMessage(from source: MoveEnd) -> String {
        guard case .loaded(let snapshot) = state else { return "" }
        let limit = BudgetAmountFormat.string(max(Transfer.limit(of: source, in: snapshot) ?? 0, 0), style: snapshot.amountStyle)
        return String(format: NSLocalizedString("You can move up to %@", comment: "Native Move money sheet: the source's limit"), limit)
    }

    public func canConfirmMove(from source: MoveEnd, to destination: MoveEnd, text: String) -> Bool {
        guard canMoveMoney, case .loaded(let snapshot) = state else { return false }
        return transfer(from: source, to: destination, text: text, in: snapshot) != nil
    }

    // Moves money on the loaded month through an allowlisted transfer handler,
    // then reads the month again, exactly like saveBudgeted. `month` is the
    // month the sheet was opened on. Returns whether the move was made.
    public func moveMoney(month target: String, from source: MoveEnd, to destination: MoveEnd, text: String) async -> Bool {
        guard !isSaving, case .loaded(let snapshot) = state else { return false }
        saveError = nil
        guard snapshot.month == target, canMoveMoney else {
            saveError = .failed
            return false
        }
        guard let transfer = transfer(from: source, to: destination, text: text, in: snapshot) else {
            saveError = .invalidAmount
            return false
        }
        return await write { try await self.client.transfer(transfer) }
    }

    private func transfer(from source: MoveEnd, to destination: MoveEnd, text: String, in snapshot: BudgetMonth) -> Transfer? {
        guard let amount = BudgetAmountFormat.minorUnits(from: text, style: snapshot.amountStyle) else { return nil }
        return try? Transfer(from: source, to: destination, amount: amount, in: snapshot)
    }

    // One write, then the generation-counted re-read; a failed write is never retried
    private func write(_ send: () async throws -> Void) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        do {
            try await send()
        } catch {
            if case NativeBridgeError.timedOut = error { saveError = .timedOut } else { saveError = .failed }
            return false
        }
        // The same generation-counted read as a change event, so an older read cannot win
        await load()
        switch state {
        case .stale, .failed: saveError = .refreshFailed
        default: break
        }
        return true
    }

    private func settle(on target: String) {
        if wanted != nil { navigated = true }
        wanted = nil
        month = target
    }

    // Month navigation (sc-3760). Nothing handler-free lists the budget's
    // months, so the edge is learned by asking: a step into a month with no
    // budget makes one read, fails with loot-core's own "no budget" answer and
    // stays where it was; that month and everything beyond it is then out.
    // shortcut: the picker's window is 24 months back and 12 forward, widening as
    // the user steps; upgrade if the budget gets an additive range field.
    private var navigated = false
    // Taps do not wait for the read before them: a step starts from the month
    // the latest tap asked for (read(_:isStep:) keeps only the newest read)
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
        await read(target, isStep: true)
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
