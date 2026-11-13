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

// Why a pull-to-refresh did not show new numbers (sc-3884). Fixed local
// strings only: nothing from the page, the server or loot-core is shown.
public enum BudgetRefreshError: Equatable {
    case offline
    case signedOut
    case timedOut
    case failed
    // The sync worked but the month could not be read again
    case refreshFailed

    public var message: String {
        switch self {
        case .offline:
            return NSLocalizedString("You're offline. Showing the last numbers.", comment: "Native Budget tab: pull to refresh, no network")
        case .signedOut:
            return NSLocalizedString("Sign in again to sync.", comment: "Native Budget tab: pull to refresh, session expired")
        case .timedOut:
            return NSLocalizedString(
                "Still syncing. The screen updates when it finishes.", comment: "Native Budget tab: pull to refresh, sync still running")
        case .failed, .refreshFailed:
            return NSLocalizedString("Couldn't sync. Try again.", comment: "Native Budget tab: pull to refresh failed")
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
    @Published public private(set) var refreshError: BudgetRefreshError?
    // From a pull until its page call settles, which can be after the deadline (sc-3884)
    public private(set) var isSyncing = false
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
            Task { @MainActor in await self.load(isEvent: true) }
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
    public func load() async { await load(isEvent: false) }

    private func load(isEvent: Bool) async {
        if !navigated { month = Self.currentMonth(now(), calendar: calendar) }
        await read(wanted ?? month, isStep: false, isEvent: isEvent)
    }

    // The one read path: every load and every month step takes a number from
    // loadGeneration, and only the newest read may change the screen.
    private func read(_ target: String, isStep: Bool, isEvent: Bool = false) async {
        loadGeneration += 1
        let generation = loadGeneration
        if isStep { wanted = target }
        if !isStep, lastGood == nil { state = .loading }
        do {
            let result = try await client.budgetMonth(target)
            guard generation == loadGeneration else { return }
            settle(on: target)
            lastGood = result
            // The newest good read decides the range; a failed read keeps the last one (sc-3850)
            range = result.firstMonth.flatMap { first in result.lastMonth.map { (first, $0) } }.flatMap { $0 <= $1 ? $0...$1 : nil }
            // A failed sync sends its own sync-event before its result, so an
            // event's read keeps that failure, dimmed; only a timed-out pull is
            // answered by an event, the late one when the sync finishes (sc-4081)
            if isEvent, let failure = refreshError, failure != .timedOut {
                state = .stale(result, .other)
            } else {
                state = .loaded(result)
                refreshError = nil
            }
        } catch {
            let failure = BudgetLoadError.from(error)
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

    // Pull to refresh (sc-3884): one server sync through the page, then the
    // usual generation-counted read. The numbers always come from that read,
    // never from the sync result. A failure keeps the last good numbers, marked
    // stale, with a fixed message; nothing is retried, and after a timeout the
    // late sync-event re-reads through the change-event path.
    public func refresh() async {
        guard isSceneActive, !isSyncing else { return }
        isSyncing = true
        refreshError = nil
        let result: SyncResult
        do {
            result = try await client.sync(settled: { Task { @MainActor [weak self] in self?.isSyncing = false } })
        } catch {
            // Only the timeout has its own message; no error's text is kept
            if case NativeBridgeError.timedOut = error { failRefresh(.timedOut) } else { failRefresh(.failed) }
            return
        }
        switch result {
        case .failed(.network): failRefresh(.offline)
        case .failed(.unauthorized): failRefresh(.signedOut)
        case .failed: failRefresh(.failed)
        case .ok:
            // A suspended page would not answer; the read on becoming active covers it
            guard isSceneActive else { return }
            await load()
            switch state {
            case .stale, .failed: refreshError = .refreshFailed
            default: break
            }
        }
    }

    private func failRefresh(_ error: BudgetRefreshError) {
        refreshError = error
        if case .loaded(let month) = state { state = .stale(month, error == .timedOut ? .timedOut : .other) }
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

    // Month navigation (sc-3760, sc-3850). Every successful read carries the
    // budget's first and last month, so the edges are known from the first load
    // and no month is remembered as missing.
    // shortcut: a server whose loot-core predates the range fields sends none;
    // the controls then stay enabled, the picker is a window of 24 months back
    // and 12 forward, and a refused step just keeps the month on screen.
    // Delete this fallback once the minimum supported server sends the range.
    private var navigated = false
    // Taps do not wait for the read before them: a step starts from the month
    // the latest tap asked for (read(_:isStep:) keeps only the newest read)
    private var wanted: String?
    private var range: ClosedRange<String>?

    public var canGoPrevious: Bool { isReachable(Self.shift(month, by: -1)) }
    public var canGoNext: Bool { isReachable(Self.shift(month, by: 1)) }

    // Every month of the range, oldest first (the tab shows it newest first)
    public var pickerMonths: [String] {
        guard let range, let from = Self.index(range.lowerBound), let to = Self.index(range.upperBound) else {
            return (-24...12).map { Self.shift(month, by: $0) }
        }
        return (0...(to - from)).map { Self.shift(range.lowerBound, by: $0) }
    }

    // The picker row to mark: the shown month, or none when it is not in the list (sc-4092)
    public var markedPickerMonth: String? { pickerMonths.contains(month) ? month : nil }

    public func previous() async { await select(Self.shift(wanted ?? month, by: -1)) }
    public func next() async { await select(Self.shift(wanted ?? month, by: 1)) }

    public func select(_ target: String) async {
        guard target != (wanted ?? month), isReachable(target) else { return }
        await read(target, isStep: true)
    }

    private func isReachable(_ candidate: String) -> Bool {
        range?.contains(candidate) ?? true
    }

    private static func index(_ month: String) -> Int? {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 12 + (parts[1] - 1) : nil
    }

    static func shift(_ month: String, by offset: Int) -> String {
        guard let index = index(month) else { return month }
        return String(format: "%04d-%02d", (index + offset) / 12, (index + offset) % 12 + 1)
    }

    public static func currentMonth(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month], from: now)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
