import Combine
import Foundation

// Fork-only (sc-4931, native-accounts-screen D6). The Accounts list's and one
// account register's state. Each holds what loot-core returned and reads again;
// neither adds a balance or orders a row (ADR 11). Free of UIKit, so the Mac
// app reuses them. The first load is `.loading` (the view shows redacted
// placeholders on the real layout, no spinner); a re-read, an error or a
// timeout keeps the last values.
public enum AccountsLoadError: Equatable {
    case timedOut, other

    public var message: String {
        switch self {
        case .timedOut: return NSLocalizedString("Accounts did not answer in time.", comment: "Native Accounts: read timed out")
        case .other: return NSLocalizedString("Accounts could not be loaded.", comment: "Native Accounts: read failed")
        }
    }

    static func from(_ error: Error) -> AccountsLoadError {
        if case NativeBridgeError.timedOut = error { return .timedOut }
        return .other
    }
}

public enum AccountsLoad<Value: Equatable>: Equatable {
    case loading
    case loaded(Value)
    case failed(AccountsLoadError)
    // A re-read failed: the last good values stay, with what failed
    case stale(Value, AccountsLoadError)

    public var value: Value? {
        switch self {
        case .loaded(let value), .stale(let value, _): return value
        case .loading, .failed: return nil
        }
    }

    fileprivate func failing(_ error: AccountsLoadError) -> AccountsLoad {
        if let good = value { return .stale(good, error) }
        return .failed(error)
    }
}

// How long the register waits for typing to pause: `Task.sleep` in the app,
// the test's own pause in tests
public typealias AccountsSleep = (TimeInterval) async throws -> Void

private let realSleep: AccountsSleep = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }

// The tables whose changes can change what either screen shows
private let accountsWatchedTables: Set<String> = ["transactions", "accounts", "preferences", "payees", "categories"]

// One server sync through the page: no bank sync (that is sc-3899). nil when it
// worked; otherwise the fixed reason the Budget tab's pull shows.
private func pullSync(_ client: NativeBridgeClient, settled: @escaping () -> Void) async -> BudgetRefreshError? {
    do {
        switch try await client.sync(settled: settled) {
        case .ok: return nil
        case .failed(.network): return .offline
        case .failed(.unauthorized): return .signedOut
        case .failed: return .failed
        }
    } catch {
        if case NativeBridgeError.timedOut = error { return .timedOut }
        return .failed
    }
}

// sc-3611: what a list write failed with. Fixed local words only.
public enum AccountsActionError: Equatable {
    case reopenFailed, moveFailed, clearFailed, categorizeFailed, deleteFailed, timedOut
    // Undo: a touched row changed since (D3a), the step is no longer the latest, or anything else
    case changedSince, nothingToUndo, undoFailed, undoTimedOut

    public var message: String {
        switch self {
        case .reopenFailed:
            return NSLocalizedString("The account could not be reopened. Nothing changed.", comment: "Native Accounts: reopen failed")
        case .moveFailed:
            return NSLocalizedString("The account could not be moved. Nothing changed.", comment: "Native Accounts: move failed")
        case .clearFailed:
            return NSLocalizedString("The transaction could not be changed. Nothing changed.", comment: "Native Accounts: clear failed")
        case .categorizeFailed:
            return NSLocalizedString(
                "The category could not be changed. Nothing changed.", comment: "Native Accounts: categorize failed")
        case .deleteFailed:
            return NSLocalizedString("The transaction could not be deleted. Nothing changed.", comment: "Native Accounts: delete failed")
        case .timedOut:
            return NSLocalizedString("The budget did not answer in time. Nothing changed.", comment: "Native Accounts: write timed out")
        case .changedSince:
            return NSLocalizedString("Changed since — can't undo.", comment: "Native Accounts: undo refused, a touched row changed")
        case .nothingToUndo:
            return NSLocalizedString("There is nothing to undo.", comment: "Native Accounts: undo refused, no matching step")
        case .undoFailed:
            return NSLocalizedString("Couldn't undo. Nothing was undone.", comment: "Native Accounts: undo failed")
        case .undoTimedOut:
            return NSLocalizedString("The budget did not answer in time. Nothing was undone.", comment: "Native Accounts: undo timed out")
        }
    }
}

// What the brief Undo after a write reverses: loot-core undoes it only if
// its latest step still carries `token` and nothing it touched changed since (D3a)
public struct AccountsUndoOffer: Equatable {
    public enum Action: Equatable { case reopen, move, clear, unclear, categorize, delete }

    public let token: String
    public let action: Action
    // The account or the transaction's payee, for the Undo bar
    public let name: String

    public init(token: String, action: Action, name: String) {
        (self.token, self.action, self.name) = (token, action, name)
    }
}

// A screen's writes and their brief Undo, shared by the list and the register
@MainActor
public final class AccountsWrites: ObservableObject {
    @Published public private(set) var undoOffer: AccountsUndoOffer?
    @Published public private(set) var actionError: AccountsActionError?
    @Published public private(set) var isWorking = false

    private let client: NativeBridgeClient
    private let window: UndoWindow

    init(client: NativeBridgeClient, undoInterval: TimeInterval, undoSleep: AccountsSleep?) {
        self.client = client
        window = UndoWindow(interval: undoInterval, sleep: undoSleep ?? realSleep)
    }

    public func clearActionError() { actionError = nil }

    public func withdraw() {
        window.close()
        undoOffer = nil
    }

    // The write, then `reread`, then the offer; a refusal changes nothing and says so
    func perform(failed: AccountsActionError, offer: AccountsUndoOffer, reread: () async -> Void, _ write: () async throws -> Void) async {
        guard !isWorking else { return }
        withdraw()
        actionError = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await write()
        } catch {
            actionError = Self.isTimeout(error) ? .timedOut : failed
            return
        }
        await reread()
        undoOffer = offer
        window.open { [weak self] in self?.undoOffer = nil }
    }

    // Only from a tap on the offered Undo
    func undo(reread: () async -> Void) async {
        guard let offer = undoOffer, !isWorking else { return }
        withdraw()
        actionError = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await client.undo(try NativeUndo(token: offer.token))
        } catch {
            actionError = Self.undoError(error)
            return
        }
        await reread()
    }

    // loot-core's native/undo says which refusal it is (server/native/app.ts)
    private static func undoError(_ error: Error) -> AccountsActionError {
        switch error {
        case NativeBridgeError.timedOut: return .undoTimedOut
        case NativeBridgeError.page(let message) where message.contains("changed since"): return .changedSince
        case NativeBridgeError.page(let message) where message.contains("nothing to undo"): return .nothingToUndo
        default: return .undoFailed
        }
    }

    private static func isTimeout(_ error: Error) -> Bool {
        if case NativeBridgeError.timedOut = error { return true }
        return false
    }
}

@MainActor
public final class AccountsListViewModel: ObservableObject {
    public static let watchedTables = accountsWatchedTables

    @Published public private(set) var state: AccountsLoad<AccountsList> = .loading
    @Published public private(set) var refreshError: BudgetRefreshError?
    // From a pull until its page call settles, which can be after the deadline
    @Published public private(set) var isSyncing = false
    // The subtitle: the app passes on loot-core's sync events; a pull sets it too
    @Published public var syncStatus: NativeSyncStatus = .unknown
    public let writes: AccountsWrites
    public var undoOffer: AccountsUndoOffer? { writes.undoOffer }
    public var actionError: AccountsActionError? { writes.actionError }

    private let client: NativeBridgeClient
    private var coalescer: ChangeCoalescer?
    private var isSceneActive = true
    private var generation = 0
    private var writesChange: AnyCancellable?

    public init(
        client: NativeBridgeClient, changeInterval: TimeInterval = 1.0 / 60, schedule: ChangeSchedule? = nil,
        undoInterval: TimeInterval = 10, undoSleep: AccountsSleep? = nil
    ) {
        self.client = client
        writes = AccountsWrites(client: client, undoInterval: undoInterval, undoSleep: undoSleep)
        coalescer = ChangeCoalescer(interval: changeInterval, schedule: schedule) { [weak self] in
            guard let self, self.isSceneActive else { return }
            Task { @MainActor in await self.load() }
        }
        writesChange = writes.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    // A page event: only a sync-event names its changed tables
    public func eventReceived(_ event: String, tables: [String]) {
        guard event == "sync-event", isSceneActive, tables.contains(where: Self.watchedTables.contains) else { return }
        coalescer?.notify()
    }

    public func pageReady() async {
        guard isSceneActive else { return }
        if case .loaded = state { return }
        await load()
    }

    public func setSceneActive(_ active: Bool) async {
        guard active != isSceneActive else { return }
        isSceneActive = active
        if active { await load() }
    }

    // Generation-counted, so an older read never wins over a newer one
    public func load() async {
        generation += 1
        let mine = generation
        do {
            let read = try await client.accountsList()
            guard mine == generation else { return }
            state = .loaded(read)
        } catch {
            guard mine == generation else { return }
            state = state.failing(.from(error))
        }
    }

    // Pull to refresh: one sync, then the usual read. A failure keeps the last
    // values with a fixed message.
    public func refresh() async {
        guard isSceneActive, !isSyncing else { return }
        isSyncing = true
        refreshError = nil
        let failure = await pullSync(client, settled: { Task { @MainActor [weak self] in self?.isSyncing = false } })
        syncStatus = syncStatus.after(pull: failure, now: Date())
        if let failure {
            refreshError = failure
            if let good = state.value { state = .stale(good, failure == .timedOut ? .timedOut : .other) }
            return
        }
        guard isSceneActive else { return }
        await load()
        if case .stale = state { refreshError = .refreshFailed }
    }

    public func clearActionError() { writes.clearActionError() }

    // The screen went away: no Undo survives it
    public func leave() { writes.withdraw() }

    // A closed account back to its section (D7), undoable
    public func reopen(_ id: String) async {
        let name = state.value?.closed.accounts.first { $0.id == id }?.name ?? ""
        guard let write = try? AccountReopen(id: id) else { return }
        await writes.perform(
            failed: .reopenFailed, offer: AccountsUndoOffer(token: write.undoToken, action: .reopen, name: name), reread: load
        ) { try await self.client.reopenAccount(write) }
    }

    // An Edit-mode drop within one section. The new order shows at once and
    // the re-read replaces it; a refusal puts the last order back.
    public func move(in section: AccountsListSection, from: Int, to: Int) async {
        guard let list = state.value else { return }
        let accounts = list.accounts(in: section)
        guard let target = AccountMove.target(in: accounts.map(\.id), from: from, to: to) else { return }
        let account = accounts[from]
        let targetId: String? = if case .before(let id) = target { id } else { nil }
        guard let write = try? AccountMove(id: account.id, targetId: targetId) else { return }
        let shown = list.moving(account.id, before: targetId)
        state = .loaded(shown)
        await writes.perform(
            failed: .moveFailed, offer: AccountsUndoOffer(token: write.undoToken, action: .move, name: account.name), reread: load
        ) { try await self.client.moveAccount(write) }
        if actionError != nil, state.value == shown { state = .loaded(list) }
    }

    // Only from a tap on the offered Undo
    public func undo() async { await writes.undo(reread: load) }
}

// The register as the pages loaded so far have built it
public struct AccountRegisterContent: Equatable {
    // The first page: currency, header and upcoming
    public let first: AccountRegister
    public let rows: [AccountRegister.Row]
    // nil after the last page
    public let nextCursor: String?
    public let pages: Int

    public var header: AccountRegister.Header? { first.header }
    public var upcoming: [AccountRegister.Upcoming]? { first.upcoming }
}

@MainActor
public final class AccountRegisterViewModel: ObservableObject {
    public static let watchedTables = accountsWatchedTables
    // The engine's cap, counted in UTF-16 units as it does
    static let maxSearch = 100

    @Published public private(set) var state: AccountsLoad<AccountRegisterContent> = .loading
    @Published public private(set) var refreshError: BudgetRefreshError?
    @Published public private(set) var isSyncing = false
    @Published public private(set) var scope: AccountRegisterScope = .all
    @Published public private(set) var search = ""
    // The Categorize picker's groups (D3: from native/budget-month), visible ones only
    @Published public private(set) var categoryGroups: [BudgetMonth.Group]?
    public let writes: AccountsWrites
    public var undoOffer: AccountsUndoOffer? { writes.undoOffer }
    public var actionError: AccountsActionError? { writes.actionError }

    public var hasMore: Bool { state.value?.nextCursor != nil }
    public let accountId: String

    private let client: NativeBridgeClient
    private var writesChange: AnyCancellable?
    private let searchInterval: TimeInterval
    private let sleep: AccountsSleep
    private var coalescer: ChangeCoalescer?
    private var pendingSearch: Task<Void, Never>?
    private var isSceneActive = true
    private var generation = 0
    private var isLoadingMore = false

    public init(
        client: NativeBridgeClient, accountId: String, searchInterval: TimeInterval = 0.3, changeInterval: TimeInterval = 1.0 / 60,
        schedule: ChangeSchedule? = nil, sleep: AccountsSleep? = nil, undoInterval: TimeInterval = 10, undoSleep: AccountsSleep? = nil
    ) {
        self.client = client
        self.accountId = accountId
        self.searchInterval = searchInterval
        self.sleep = sleep ?? realSleep
        writes = AccountsWrites(client: client, undoInterval: undoInterval, undoSleep: undoSleep)
        coalescer = ChangeCoalescer(interval: changeInterval, schedule: schedule) { [weak self] in
            guard let self, self.isSceneActive else { return }
            Task { @MainActor in await self.reload() }
        }
        writesChange = writes.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    public func eventReceived(_ event: String, tables: [String]) {
        guard event == "sync-event", isSceneActive, tables.contains(where: Self.watchedTables.contains) else { return }
        coalescer?.notify()
    }

    public func pageReady() async {
        guard isSceneActive else { return }
        if case .loaded = state { return }
        await load()
    }

    public func setSceneActive(_ active: Bool) async {
        guard active != isSceneActive else { return }
        isSceneActive = active
        if active { await reload() }
    }

    private func request(cursor: String?) throws -> AccountRegisterRequest {
        try AccountRegisterRequest(accountId: accountId, scope: scope, search: search.isEmpty ? nil : search, cursor: cursor)
    }

    // The first page, for the current scope and search: what the screen shows
    // on first load and after either changes
    public func load() async {
        generation += 1
        let mine = generation
        isLoadingMore = false
        do {
            let page = try await client.accountRegister(try request(cursor: nil))
            guard mine == generation else { return }
            state = .loaded(AccountRegisterContent(first: page, rows: page.rows, nextCursor: page.nextCursor, pages: 1))
        } catch {
            guard mine == generation else { return }
            state = state.failing(.from(error))
        }
    }

    // The loaded pages again from the top, one after another, replaced only when
    // every one was read: a failure keeps the rows on screen
    public func reload() async {
        guard isSceneActive else { return }
        guard let current = state.value else {
            await load()
            return
        }
        generation += 1
        let mine = generation
        isLoadingMore = false
        do {
            let first = try await client.accountRegister(try request(cursor: nil))
            var rows = first.rows
            var cursor = first.nextCursor
            var pages = 1
            while pages < current.pages, let next = cursor {
                let page = try await client.accountRegister(try request(cursor: next))
                guard mine == generation else { return }
                rows += Self.fresh(page.rows, after: rows)
                cursor = page.nextCursor
                pages += 1
            }
            guard mine == generation else { return }
            state = .loaded(AccountRegisterContent(first: first, rows: rows, nextCursor: cursor, pages: pages))
        } catch {
            guard mine == generation else { return }
            state = state.failing(.from(error))
        }
    }

    // The next page, with the cursor loot-core handed back
    public func loadMore() async {
        guard isSceneActive, !isLoadingMore, let current = state.value, let cursor = current.nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let mine = generation
        do {
            let page = try await client.accountRegister(try request(cursor: cursor))
            guard mine == generation else { return }
            state = .loaded(
                AccountRegisterContent(
                    first: current.first, rows: current.rows + Self.fresh(page.rows, after: current.rows), nextCursor: page.nextCursor,
                    pages: current.pages + 1))
        } catch {
            guard mine == generation else { return }
            state = state.failing(.from(error))
        }
    }

    // A row a sync moved onto the next page is not shown twice
    private static func fresh(_ rows: [AccountRegister.Row], after shown: [AccountRegister.Row]) -> [AccountRegister.Row] {
        let seen = Set(shown.map(\.id))
        return rows.filter { !seen.contains($0.id) }
    }

    public func setScope(_ new: AccountRegisterScope) async {
        guard new != scope else { return }
        scope = new
        await load()
    }

    // Reads from the first page once the typing pauses; a text over the engine's
    // cap is not sent
    public func setSearch(_ text: String) async {
        guard text.utf16.count <= Self.maxSearch else { return }
        search = text
        pendingSearch?.cancel()
        let pause = searchInterval
        let wait = sleep
        pendingSearch = Task { [weak self] in
            try? await wait(pause)
            guard !Task.isCancelled, let self else { return }
            await self.load()
        }
    }

    public func refresh() async {
        guard isSceneActive, !isSyncing else { return }
        isSyncing = true
        refreshError = nil
        if let failure = await pullSync(client, settled: { Task { @MainActor [weak self] in self?.isSyncing = false } }) {
            refreshError = failure
            if let good = state.value { state = .stale(good, failure == .timedOut ? .timedOut : .other) }
            return
        }
        guard isSceneActive else { return }
        await reload()
        if case .stale = state { refreshError = .refreshFailed }
    }

    public func clearActionError() { writes.clearActionError() }

    // The screen went away: no Undo survives it
    public func leave() { writes.withdraw() }

    // Clear or Unclear through native/reconcile-tick, which refuses a reconciled row
    public func setCleared(_ row: AccountRegister.Row, _ cleared: Bool) async {
        guard let write = try? ReconcileTick(accountId: accountId, ids: [row.id], cleared: cleared) else { return }
        let offer = AccountsUndoOffer(token: write.undoToken, action: cleared ? .clear : .unclear, name: Self.name(of: row))
        await writes.perform(failed: .clearFailed, offer: offer, reread: reload) { _ = try await self.client.reconcileTick(write) }
    }

    // A nil category makes the row uncategorized. `confirmed`: the person agreed to change a reconciled row.
    public func categorize(_ row: AccountRegister.Row, category: String?, confirmed: Bool) async {
        guard let write = try? TransactionsCategorize(accountId: accountId, ids: [row.id], category: category, confirmedReconciled: confirmed)
        else { return }
        let offer = AccountsUndoOffer(token: write.undoToken, action: .categorize, name: Self.name(of: row))
        await writes.perform(failed: .categorizeFailed, offer: offer, reread: reload) { try await self.client.categorizeTransactions(write) }
    }

    // A transfer's partner goes with it (loot-core)
    public func delete(_ row: AccountRegister.Row, confirmed: Bool) async {
        guard let write = try? TransactionsDelete(accountId: accountId, ids: [row.id], confirmedReconciled: confirmed) else { return }
        let offer = AccountsUndoOffer(token: write.undoToken, action: .delete, name: Self.name(of: row))
        await writes.perform(failed: .deleteFailed, offer: offer, reread: reload) { try await self.client.deleteTransactions(write) }
    }

    public func undo() async { await writes.undo(reread: reload) }

    // The month's groups for the picker; a failed read leaves the picker empty
    public func loadCategories(month: String) async {
        guard let read = try? await client.budgetMonth(month) else { return }
        categoryGroups = read.groups.filter { !$0.hidden && !$0.visibleCategories.isEmpty }.map {
            BudgetMonth.Group(
                id: $0.id, name: $0.name, isIncome: $0.isIncome, hidden: false, budgeted: nil, spent: nil, balance: nil,
                categories: $0.visibleCategories)
        }
    }

    private static func name(of row: AccountRegister.Row) -> String {
        [row.payee, row.transferAccount?.name, row.notes].compactMap { $0 }.first { !$0.isEmpty } ?? ""
    }
}
