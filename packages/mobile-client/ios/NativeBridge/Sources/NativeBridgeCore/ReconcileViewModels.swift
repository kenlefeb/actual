import Combine
import Foundation

// Fork-only (sc-4801, native-reconcile-flow D7). The Reconcile flow's state:
// the checklist, step 1 (the statement balance) and step 2 (tick off). Each
// holds loot-core's reads as they came, sends typed writes and reads again; no
// balance or difference is worked out here (ADR 11). Free of UIKit, so the Mac
// app reuses them.
public enum ReconcileLoad<Read: Equatable>: Equatable {
    case loading
    case loaded(Read)
    case failed(BudgetLoadError)
    // A re-read failed: the last good values stay
    case stale(Read, BudgetLoadError)

    public var read: Read? {
        switch self {
        case .loaded(let read), .stale(let read, _): return read
        case .loading, .failed: return nil
        }
    }

    // A failed read keeps the last good values
    func failing(_ error: Error) -> ReconcileLoad {
        let failure = BudgetLoadError.from(error)
        if let read { return .stale(read, failure) }
        return .failed(failure)
    }
}

public enum ReconcileError: Equatable {
    case saveFailed, tickFailed, listFailed, timedOut

    static func from(_ error: Error, _ otherwise: ReconcileError) -> ReconcileError {
        if case NativeBridgeError.timedOut = error { return .timedOut }
        return otherwise
    }

    public var message: String {
        switch self {
        case .saveFailed:
            NSLocalizedString("The balance could not be saved. Nothing was recorded.", comment: "Native Reconcile: save failed")
        case .tickFailed:
            NSLocalizedString("The row could not be changed. Nothing changed.", comment: "Native Reconcile: tick failed")
        case .listFailed:
            NSLocalizedString("The list could not be changed.", comment: "Native Reconcile: Edit List failed")
        case .timedOut:
            NSLocalizedString("The budget did not answer in time. Nothing changed.", comment: "Native Reconcile: timed out")
        }
    }
}

// Tables whose changes can change the flow: rows, accounts and the
// recorded balance and exclusions (preferences)
let reconcileWatchedTables: Set<String> = ["transactions", "accounts", "preferences", "payees", "categories"]

@MainActor
public final class ReconcileMonthViewModel: ObservableObject {
    // "Ready to confirm" has no source until the assistant nudge (D6, sc-4836)
    public static let showsReady = false

    @Published public private(set) var state: ReconcileLoad<ReconcileMonth> = .loading
    @Published public private(set) var error: ReconcileError?

    private let client: NativeBridgeClient
    private var coalescer: ChangeCoalescer?
    private var generation = 0

    public init(client: NativeBridgeClient, changeInterval: TimeInterval = 1.0 / 60) {
        self.client = client
        coalescer = ChangeCoalescer(interval: changeInterval) { [weak self] in
            Task { @MainActor in await self?.load() }
        }
    }

    private var accounts: [ReconcileMonth.Account] { state.read?.accounts ?? [] }
    public var ready: [ReconcileMonth.Account] { accounts.filter { $0.status == .ready } }
    // In progress is still due: the person has more to do
    public var due: [ReconcileMonth.Account] {
        accounts.filter { [.due, .inProgress].contains($0.status) || (!Self.showsReady && $0.status == .ready) }
    }
    public var done: [ReconcileMonth.Account] { accounts.filter { $0.status == .done } }
    public var doneCount: Int { done.count }
    public var openAccounts: Set<String> { Set(accounts.map(\.id) + (state.read?.hidden.map(\.id) ?? [])) }

    // A `presentReconcile` body, kept only for an account this read lists as open
    public func request(from body: Any) -> PresentReconcile? {
        PresentReconcile(body: body, openAccounts: openAccounts)
    }

    public func load() async {
        generation += 1
        let current = generation
        do {
            let read = try await client.reconcileMonth()
            guard current == generation else { return }
            state = .loaded(read)
        } catch {
            guard current == generation else { return }
            state = state.failing(error)
        }
    }

    public func eventReceived(_ event: String, tables: [String]) {
        guard event == "sync-event", tables.contains(where: reconcileWatchedTables.contains) else { return }
        coalescer?.notify()
    }

    public func remove(_ id: String) async {
        guard let read = state.read, !read.excluded.contains(id) else { return }
        await setList(read.excluded + [id])
    }

    public func restore(_ id: String) async {
        guard let read = state.read else { return }
        await setList(read.excluded.filter { $0 != id })
    }

    private func setList(_ excluded: [String]) async {
        error = nil
        do {
            try await client.setReconcileList(try ReconcileListSet(excluded: excluded))
        } catch {
            self.error = ReconcileError.from(error, .listFailed)
            return
        }
        await load()
    }
}

@MainActor
public final class ReconcileStepOneViewModel: ObservableObject {
    public enum Source: Equatable {
        case none, entered, cleared
        case bankSync(asOf: String?)
    }

    @Published public private(set) var state: ReconcileLoad<StatementBalancePrefill> = .loading
    // The field, in the budget's own format; empty means nothing typed
    @Published public var text = "" {
        didSet { if chosen != nil, text != chosenText { chosen = nil } }
    }
    @Published public private(set) var error: ReconcileError?
    @Published public private(set) var isSaving = false
    // A confirmed cleared balance: the fixed note why an assistant cannot use it (D3)
    @Published public private(set) var showsClearedNote = false

    public let accountId: String
    public let style: BudgetAmountStyle
    private let client: NativeBridgeClient
    // An alternative the person chose, while the field still shows it
    private var chosen: StatementBalancePrefill.Source?
    private var chosenText: String?

    public init(client: NativeBridgeClient, accountId: String, style: BudgetAmountStyle) {
        self.client = client
        self.accountId = accountId
        self.style = style
    }

    public var prefill: StatementBalancePrefill.Source? { state.read?.prefill }
    public var cleared: StatementBalancePrefill.Source? { state.read?.alternatives.first { $0.source == "cleared" } }
    public var staleBank: StatementBalancePrefill.Source? { state.read?.alternatives.first { $0.source == "bank-sync" } }

    public func string(_ amount: Int) -> String { BudgetAmountFormat.string(amount, style: style) }
    // As the app shows amounts elsewhere ($4,654.13); minorUnits reads it back
    private func edit(_ amount: Int) -> String { BudgetAmountFormat.string(amount, style: style) }

    public var amount: Int? { BudgetAmountFormat.minorUnits(from: text, style: style) }

    public var source: Source {
        if let chosen, chosen.source == "cleared" { return .cleared }
        if let chosen { return .bankSync(asOf: chosen.asOf) }
        if let prefill, text == edit(prefill.amount) { return .bankSync(asOf: prefill.asOf) }
        return text.isEmpty ? .none : .entered
    }

    public var canConfirm: Bool { amount != nil && !isSaving }

    public func load() async {
        do {
            let read = try await client.statementBalancePrefill(accountId: accountId)
            let first = state.read == nil
            state = .loaded(read)
            if first, let prefill = read.prefill { text = edit(prefill.amount) }
        } catch {
            state = state.failing(error)
        }
    }

    public func restoreBankBalance() {
        if let prefill { choose(nil, text: edit(prefill.amount)) }
    }

    public func useCleared() {
        if let cleared { choose(cleared, text: edit(cleared.amount)) }
    }

    public func useStaleBank() {
        if let staleBank { choose(staleBank, text: edit(staleBank.amount)) }
    }

    private func choose(_ source: StatementBalancePrefill.Source?, text: String) {
        self.text = text
        (chosen, chosenText) = (source, text)
    }

    // Saves the record (loot-core derives who); true moves on to step 2
    public func confirm() async -> Bool {
        guard let amount, !isSaving else { return false }
        let (kind, asOf): (StatementBalanceSave.Source, String?) =
            switch source {
            case .bankSync(let asOf): (.bankSync, asOf)
            case .cleared: (.cleared, nil)
            case .entered, .none: (.entered, nil)
            }
        guard let save = try? StatementBalanceSave(accountId: accountId, amount: amount, source: kind, asOf: asOf) else {
            error = .saveFailed
            return false
        }
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try await client.saveStatementBalance(save)
        } catch {
            self.error = ReconcileError.from(error, .saveFailed)
            return false
        }
        showsClearedNote = kind == .cleared
        return true
    }
}

@MainActor
public final class ReconcileTickViewModel: ObservableObject {
    public enum Exit: Equatable {
        // Difference 0.00: finish (and lock) in the web register (B1 locks nothing)
        case readyToLock
        // Above zero, or no statement: close and keep the ticks
        case doneForNow
    }

    @Published public private(set) var state: ReconcileLoad<ReconcileRows> = .loading
    @Published public private(set) var summary: ReconcileSummary?
    @Published public var scope: ReconcileScope = .toTick
    @Published public private(set) var error: ReconcileError?
    // For VoiceOver: the difference after a tick
    @Published public private(set) var announcement: String?

    public let accountId: String
    private let client: NativeBridgeClient
    private var coalescer: ChangeCoalescer?
    private var generation = 0
    private var style: BudgetAmountStyle?

    public init(client: NativeBridgeClient, accountId: String, style: BudgetAmountStyle? = nil, changeInterval: TimeInterval = 1.0 / 60) {
        self.client = client
        self.accountId = accountId
        self.style = style
        coalescer = ChangeCoalescer(interval: changeInterval) { [weak self] in
            Task { @MainActor in await self?.load() }
        }
    }

    public var rows: [ReconcileRows.Row] { state.read?.rows ?? [] }
    public var exit: Exit { summary?.difference == 0 ? .readyToLock : .doneForNow }

    public func load() async {
        generation += 1
        let current = generation
        do {
            let read = try await client.reconcileRows(accountId: accountId, scope: scope)
            guard current == generation else { return }
            state = .loaded(read)
            summary = read.summary
        } catch {
            guard current == generation else { return }
            state = state.failing(error)
        }
    }

    public func eventReceived(_ event: String, tables: [String]) {
        guard event == "sync-event", tables.contains(where: reconcileWatchedTables.contains) else { return }
        coalescer?.notify()
    }

    // A reconciled row is locked: never sent (loot-core refuses it too)
    public func toggle(_ row: ReconcileRows.Row) async {
        guard !row.reconciled, let tick = try? ReconcileTick(accountId: accountId, ids: [row.id], cleared: !row.cleared) else { return }
        error = nil
        do {
            summary = try await client.reconcileTick(tick)
        } catch {
            self.error = ReconcileError.from(error, .tickFailed)
            return
        }
        if let difference = summary?.difference {
            let text = style.map { BudgetAmountFormat.string(difference, style: $0) } ?? String(difference)
            announcement = String(format: NSLocalizedString("Difference %@", comment: "Native Reconcile: VoiceOver after a tick"), text)
        }
        await load()
    }
}
