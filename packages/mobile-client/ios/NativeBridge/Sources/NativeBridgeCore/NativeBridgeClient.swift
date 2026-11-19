import Combine
import Foundation

// Fork-only (sc-3584, ADR 11). Native code reads loot-core only through these
// handlers. This list is the security boundary: the page's copy
// (packages/desktop-client/src/data/native-bridge-allowlist.json, compared by
// a test) only stops accidents. Each native screen story adds the writes it needs.
public enum NativeBridgeAllowlist {
    // Sent only as their typed value (BudgetAmountWrite, Transfer), never as loose arguments
    public static let writes: Set<String> = ["budget/budget-amount", "budget/transfer-category", "budget/transfer-available"]
    public static let reads: Set<String> = [
        "native/budget-month", "native/schedules-paychecks", "query",
        // sc-4343: the paycheck editor's draft preview and year-to-date
        "native/paycheck-preview", "paycheck-year-to-date",
    ]
    // sc-4341 and sc-4343: sent only as PaycheckSkip, NativeUndo, PaycheckSave
    // and PaycheckDelete. The bare undo and redo stay off: they would reverse
    // whatever is on top, maybe a web edit.
    public static let paycheckWrites: Set<String> = ["paycheck-skip-next", "native/undo", "native/paycheck-save", "paycheck-delete"]
    // loot-core's server sync (sc-3884), the one handler that is neither a read
    // nor a budget write. Only NativeBridgeClient.sync() reaches it: the generic
    // call refuses it, so its result is always decoded and its deadline applies.
    public static let sync: Set<String> = ["sync"]
    // sc-4801 (native-reconcile-flow D5). The consume stays off: only a lock consumes a record.
    public static let reconcileReads: Set<String> = [
        "native/reconcile-month", "native/reconcile-rows", "account-statement-balance-prefill", "account-statement-balance-get",
        // sc-4825
        "native/reconcile-matches", "native/reconcile-lock-preview",
    ]
    // Sent only as ReconcileTick, ReconcileListSet, StatementBalanceSave,
    // ReconcileAdjust and ReconcileLock (sc-4825)
    public static let reconcileWrites: Set<String> = [
        "native/reconcile-tick", "native/reconcile-list-set", "account-statement-balance-save", "native/reconcile-adjust",
        "native/reconcile-lock",
    ]
    // sc-4386 (native-accounts-screen D1): the Accounts screen's batched reads
    // sc-4973 (native-register-upcoming-rows D7): the upcoming section, read after the first page
    public static let accountsReads: Set<String> = [
        "native/accounts-list", "native/account-register", "native/account-upcoming",
    ]
    // sc-4931 (D3): sent only as TransactionsCategorize, TransactionsDelete, AccountReopen and
    // AccountMove. The raw account-reopen, account-move and transactions-batch-update stay off.
    public static let accountsWrites: Set<String> = [
        "native/transactions-categorize", "native/transactions-delete", "native/account-reopen", "native/account-move",
    ]
    // sc-3602 (native-add-transaction D4): the Add transaction sheet's reads and its preview, which
    // writes nothing. The raw transactions-batch-update, transaction-add, rules-run and payee-create stay off.
    public static let transactionReads: Set<String> = [
        "native/transaction-form", "native/payees", "native/transaction-preview",
    ]
    // Sent only as TransactionSave (D3)
    public static let transactionWrites: Set<String> = ["native/transaction-save"]
    // sc-4643 (native-settings-screen D2). The save is sent only as SettingsSave;
    // preferences/save, save-global-prefs, subscribe-sign-out, set-server-url,
    // key-make and reset-budget-cache stay off.
    public static let settingsReads: Set<String> = ["native/settings", "native/server-info"]
    public static let settingsWrites: Set<String> = ["native/settings-save"]
    // sc-5219 (native-durable-writes D4, D5): the storage barrier and the failure latch.
    // The guard's switch stays off: the page sets it as its bridge installs.
    public static let storage: Set<String> = ["native/persisted", "native/storage-state"]
    public static let handlers: Set<String> = reads.union(writes).union(paycheckWrites).union(sync).union(reconcileReads)
        .union(reconcileWrites).union(accountsReads).union(accountsWrites).union(settingsReads).union(settingsWrites)
        .union(transactionReads).union(transactionWrites).union(storage)

    // sc-5219 (D3): what a call is. A write is followed by native/persisted; a
    // storage call changes nothing, so it is never a write.
    public enum Kind: Equatable { case read, write, sync, storage }

    public static let allReads: Set<String> = reads.union(reconcileReads).union(accountsReads).union(transactionReads)
        .union(settingsReads)

    // Anything not listed as a read is a write, as on the page, so a new
    // handler cannot skip the barrier by being left off a list
    public static func kind(of name: String) -> Kind? {
        guard handlers.contains(name) else { return nil }
        if sync.contains(name) { return .sync }
        if storage.contains(name) { return .storage }
        return allReads.contains(name) ? .read : .write
    }
}

// The page's reduced sync result (nativeBridge.ts): whether it worked, and a
// reason from a closed set. Nothing else of loot-core's error crosses.
public enum SyncFailureReason: String, Equatable {
    case network, unauthorized, outOfSync = "out-of-sync", clockDrift = "clock-drift", encryption, other
    // sc-5219 (native-durable-writes)
    case storageSlow = "storage-slow", storageFailed = "storage-failed"
}

public enum SyncResult: Decodable, Equatable {
    case ok
    case failed(SyncFailureReason)

    private enum Keys: String, CodingKey { case ok, reason }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        if try container.decode(Bool.self, forKey: .ok) {
            self = .ok
        } else {
            // A page older or newer than the app may send a reason this one does not know
            let reason = try? container.decodeIfPresent(String.self, forKey: .reason)
            self = .failed(reason.flatMap(SyncFailureReason.init(rawValue:)) ?? .other)
        }
    }
}

// What Swift reads of a message the page posts: the event name only. A
// sync-event's payload carries loot-core's error meta, which can hold a server
// address, a stack or SQL, so it is never read (sc-3884).
public enum NativeBridgeEvent {
    public static func name(of body: Any) -> String? {
        (body as? [String: Any])?["event"] as? String
    }

    // sc-4341: a sync-event's changed table names, and nothing else of its
    // payload, so a screen re-reads only for tables it shows
    public static func tables(of body: Any) -> [String] {
        guard name(of: body) == "sync-event",
            let payload = (body as? [String: Any])?["payload"] as? [String: Any],
            let tables = payload["tables"] as? [Any]
        else { return [] }
        return tables.compactMap { $0 as? String }
    }

    // sc-5219: the page load announcing itself
    public static func readyEpoch(of body: Any) -> String? {
        guard name(of: body) == "ready" else { return nil }
        return ((body as? [String: Any])?["payload"] as? [String: Any])?["epoch"] as? String
    }

    // sc-5219: which native/persisted call, of which page load, is now stored
    public static func stored(of body: Any) -> (seq: Int, epoch: String)? {
        guard name(of: body) == "stored",
            let payload = (body as? [String: Any])?["payload"] as? [String: Any],
            let seq = payload["seq"] as? [String: Any],
            let number = seq["n"] as? Int, let epoch = seq["epoch"] as? String
        else { return nil }
        return (number, epoch)
    }
}

// sc-5219 (native-durable-writes D3, D4): whether this device has stored the
// writes made through the client. One per page.
//
// With the storage guard off a failed write still answers stored, so app code
// must not be able to read that yet. `message`, `write` and `StoredWrite` are
// internal, which stops the Mac app (it imports this package), and exist only
// in package builds, which stops the iPhone app (it compiles these sources
// itself, so internal would not). The guard's PR opens them up.
@MainActor
public final class WriteStorageStatus: ObservableObject {
    public static let savingMessage = NSLocalizedString("Saving…", comment: "Native screens: a change is being stored on this device")
    public static let notYetStoredMessage = NSLocalizedString(
        "Still saving to this device. Keep the app open.", comment: "Native screens: a change was made but this device has not stored it yet")

    // The line a screen may show: saving in progress, never that a change is stored
    @Published private var line: String?
    private var writesInProgress = 0 { didSet { updateLine() } }
    // The current page's writes not known to be stored: when their
    // native/persisted call was asked, and its number once answered
    private var unstored: [(ticket: Int, seq: Int?)] = [] { didSet { updateLine() } }
    // Keeps counting across page loads, so a late ticket can't pass for a new one
    private var lastTicket = 0
    private var newestStoredTicket = 0
    private var storedThroughSeq = 0
    // A restart came while writes were unstored. No later success can vouch
    // for them, so only OK on the restart notice clears this. The notice says
    // so; the status line shows only saving in progress.
    @Published public private(set) var mayNotBeSaved = false
    private var currentEpoch: String?
    private var retiredEpochs: Set<String> = []

    public nonisolated init() {}

    private func updateLine() {
        let next = writesInProgress > 0 ? Self.savingMessage : unstored.isEmpty ? nil : Self.notYetStoredMessage
        if next != line { line = next }
    }

    // What a screen shows. A normal write takes milliseconds, so "Saving…"
    // appears only if it is still saving after `savingDelay`, and once it has
    // appeared it stays for `savingMinimum` rather than flash.
    public func shownMessage(savingDelay: TimeInterval = 0.3, savingMinimum: TimeInterval = 0.6) -> AnyPublisher<String?, Never> {
        var savingShownAt: Date?
        func later(_ message: String?, by delay: TimeInterval) -> AnyPublisher<String?, Never> {
            guard delay > 0 else { return Just(message).eraseToAnyPublisher() }
            return Just(message).delay(for: .seconds(delay), scheduler: RunLoop.main).eraseToAnyPublisher()
        }
        return $line
            .map { message -> AnyPublisher<String?, Never> in
                if message == Self.savingMessage {
                    guard savingShownAt == nil else { return Just(message).eraseToAnyPublisher() }
                    return later(message, by: savingDelay)
                        .handleEvents(receiveOutput: { _ in savingShownAt = Date() })
                        .eraseToAnyPublisher()
                }
                let shownFor = savingShownAt.map { Date().timeIntervalSince($0) } ?? savingMinimum
                let wait = message == nil ? max(0, savingMinimum - shownFor) : 0
                return later(message, by: wait)
                    .handleEvents(receiveOutput: { _ in savingShownAt = nil })
                    .eraseToAnyPublisher()
            }
            .switchToLatest()
            .removeDuplicates()
            .eraseToAnyPublisher()
    }

    // What VoiceOver says when the shown line changes: "Saving…" would talk over
    // the person's own action. Nothing is said when the line clears, because
    // until the storage guard is on that would claim more than is known.
    public static func announcement(from old: String?, to new: String?) -> String? {
        new == notYetStoredMessage && old != notYetStoredMessage ? notYetStoredMessage : nil
    }

    // The page load this write was made in, kept for a write that never gets an answer
    @discardableResult
    func writeBegan() -> WriteOrigin {
        writesInProgress += 1
        return WriteOrigin(epoch: currentEpoch)
    }

    #if SWIFT_PACKAGE
    var message: String? {
        line
    }
    #endif

    func writeEnded() { writesInProgress -= 1 }

    // Taken just before asking, because answers can arrive out of order
    func nextTicket() -> Int {
        lastTicket += 1
        return lastTicket
    }

    // A stored answer covers every write of its own page load asked about
    // before it, and no later one. Returns whether this write is known stored:
    // a page can't vouch for a write made on the page before it.
    @discardableResult
    func record(_ answer: PersistedAnswer, ticket: Int? = nil, madeIn origin: WriteOrigin? = nil) -> Bool {
        let ticket = ticket ?? nextTicket()
        let answeredBy = answer.seq?.epoch
        let isLive = answeredBy.map(adopt) ?? true
        if let origin, origin.epoch != (answeredBy ?? currentEpoch) {
            mayNotBeSaved = true
            return false
        }
        guard isLive else {
            // The page before this one, about its own write
            if !answer.stored { mayNotBeSaved = true }
            return answer.stored
        }
        if answer.stored {
            newestStoredTicket = max(newestStoredTicket, ticket)
            unstored.removeAll { $0.ticket <= ticket }
        } else if ticket > newestStoredTicket {
            // This call waits for every write before it, so it speaks for any
            // earlier call that never got an answer
            if answer.seq != nil { unstored.removeAll { $0.seq == nil && $0.ticket < ticket } }
            if (answer.seq?.n ?? .max) > storedThroughSeq { unstored.append((ticket, answer.seq?.n)) }
        }
        return answer.stored
    }

    // The engine's storage-stored, which the page forwards as `stored`. It can
    // arrive before the answer that carries its number. Writes are stored in
    // order, so it covers every earlier number of its page load too.
    public func storedEvent(seq: Int, epoch: String) {
        guard adopt(epoch) else { return }
        storedThroughSeq = max(storedThroughSeq, seq)
        unstored.removeAll { $0.seq.map { $0 <= seq } ?? false }
    }

    // The page bridge's "ready". The same page may already be known from an answer.
    public func pageLoaded(epoch: String) {
        _ = adopt(epoch)
    }

    // What a page that has gone had not stored may be lost with it
    private func retireCurrentPage() {
        if let currentEpoch { retiredEpochs.insert(currentEpoch) }
        currentEpoch = nil
        newestStoredTicket = 0
        // The new page's numbers start again
        storedThroughSeq = 0
        if !unstored.isEmpty {
            unstored = []
            mayNotBeSaved = true
        }
    }

    public func acknowledgeMayNotBeSaved() { mayNotBeSaved = false }

    // False for a page that has already gone
    private func adopt(_ epoch: String) -> Bool {
        if retiredEpochs.contains(epoch) { return false }
        if epoch != currentEpoch {
            if currentEpoch != nil || !unstored.isEmpty { retireCurrentPage() }
            currentEpoch = epoch
        }
        return true
    }
}

// The page load a write was made in; nil before the page has announced itself
struct WriteOrigin: Equatable {
    let epoch: String?
}

// The engine's page load, and this call's place in it
struct PersistedSeq: Decodable, Equatable {
    let epoch: String
    let n: Int
}

// sc-5219: where the storage line may rest while the keyboard is up
public enum WriteStorageLinePlacement {
    // The line rests just above the keyboard, unless that would cover the field being edited
    public static func coversField(_ field: CGRect?, lineHeight: CGFloat, keyboardTop: CGFloat, gap: CGFloat = 8) -> Bool {
        guard let field else { return false }
        let bottom = keyboardTop - gap
        return field.maxY > bottom - lineHeight && field.minY < bottom
    }
}

struct PersistedAnswer: Decodable, Equatable {
    let stored: Bool
    var seq: PersistedSeq?

    static let notStored = PersistedAnswer(stored: false)
}

// sc-5219 (D8): the iPhone's flush on going to the background. The system's
// background task ends at the earliest of the answer (the client's deadline
// bounds it) or expiry, and only once.
@MainActor
public final class BackgroundFlush<Token> {
    private let begin: (_ onExpiry: @escaping () -> Void) -> Token
    private let end: (Token) -> Void
    private let flush: () async -> Void
    private var token: Token?
    // Which run the token belongs to: a late answer or expiry ends only its own task
    private var current = 0

    public init(
        begin: @escaping (_ onExpiry: @escaping () -> Void) -> Token, end: @escaping (Token) -> Void,
        flush: @escaping () async -> Void
    ) {
        (self.begin, self.end, self.flush) = (begin, end, flush)
    }

    public func run() {
        guard token == nil else { return }
        current += 1
        let run = current
        token = begin { [weak self] in self?.finish(run) }
        Task { [weak self, flush] in
            await flush()
            self?.finish(run)
        }
    }

    private func finish(_ run: Int) {
        guard run == current, let token else { return }
        self.token = nil
        end(token)
    }
}

#if SWIFT_PACKAGE
// A write's result, and whether this device has stored it
struct StoredWrite {
    let data: Data
    let stored: Bool
}
#endif

// sc-3611 (native-bridge: "Native refusals carry a stable code"). A loot-core
// refusal native code reacts to starts with `[native:<code>]` or
// `[native:<code>:<detail,...>]` (server/native/refusal.ts). Swift reads only
// that token; the words after it are free to change. The codes are the
// contract fixture native-refusal-codes.json. An unknown code is no code, so
// the screen shows its generic message.
public struct NativeRefusal: Equatable {
    public enum Code: String, CaseIterable {
        case needsConfirmedReconciled = "needs-confirmed-reconciled"
        case undoChangedSince = "undo-changed-since"
        case undoNothing = "undo-nothing"
        case noBudgetForMonth = "no-budget-for-month"
        case invalidDraft = "invalid-draft"
        case invalidSetting = "invalid-setting"
        // sc-3602: a form read of a transaction that is gone or in a closed account
        case notFound = "not-found"
        // sc-3602 (D3): the save of an edit that changed elsewhere, or a draft rules changed since it was shown
        case changedSince = "changed-since"
        case previewStale = "preview-stale"
        // sc-5219 (native-durable-writes D5): storage failed; nothing more is stored
        case notStored = "not-stored"
    }

    public let code: Code
    public let detail: [String]

    public init(code: Code, detail: [String] = []) {
        (self.code, self.detail) = (code, detail)
    }

    // nil unless `message` starts with a known code's token
    public init?(_ message: String) {
        guard message.hasPrefix("[native:"), let end = message.firstIndex(of: "]") else { return nil }
        let token = message[message.index(message.startIndex, offsetBy: 8)..<end]
        let parts = token.split(separator: ":", maxSplits: 1).map(String.init)
        guard let first = parts.first, let code = Code(rawValue: first) else { return nil }
        self.init(code: code, detail: parts.count > 1 ? parts[1].split(separator: ",").map(String.init) : [])
    }

    // A page refusal's code, or nil for any other error
    public init?(_ error: Error) {
        guard case NativeBridgeError.page(let message) = error else { return nil }
        self.init(message)
    }
}

public enum NativeBridgeError: Error, Equatable {
    case notAllowlisted(String)
    case timedOut(String)
    case noPage
    case badResult
    // A write built from a value loot-core would mishandle; never sent (sc-3769)
    case invalidWrite(String)
    // The main frame is not the app's own page (sc-3859). One fixed value, so
    // it carries nothing of a foreign page's URL or text.
    case pageOrigin
    // The app's own page bridge refused or failed the call; its message
    case page(String)
}

// The arguments of `budget/budget-amount`. loot-core's handler trusts them, so
// the value is checked here, before it can be built, and again by the page.
// The amount is an integer in minor units, as native/budget-month returns it.
public struct BudgetAmountWrite: Encodable, Equatable {
    public let category: String
    public let month: String
    public let amount: Int

    // loot-core stores amounts as JavaScript numbers
    static let maxAmount = 9_007_199_254_740_991

    public init(category: String, month: String, amount: Int) throws {
        guard !category.isEmpty, category != "to-budget" else { throw NativeBridgeError.invalidWrite("category") }
        guard Self.isMonth(month) else { throw NativeBridgeError.invalidWrite("month") }
        guard amount.magnitude <= Self.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        (self.category, self.month, self.amount) = (category, month, amount)
    }

    static func isMonth(_ month: String) -> Bool {
        month.range(of: #"^[0-9]{4}-(0[1-9]|1[0-2])\z"#, options: .regularExpression) != nil
    }
}

// One end of a move: to-budget, or a category by id
public enum MoveEnd: Hashable {
    case toBudget
    case category(String)
}

// A move of money on an envelope month (sc-3787), checked against the month's
// snapshot before it can be built, and again by the page: a positive amount no
// larger than the source holds, two different ends, and only expense
// categories. Out of to-budget it is `budget/transfer-available`; otherwise
// `budget/transfer-category`, which would write a budget row for a category
// called to-budget if it were the source.
public struct Transfer: Encodable, Equatable {
    public let month: String
    public let from: MoveEnd
    public let to: MoveEnd
    public let amount: Int
    // Only labels loot-core's movement note: the budget's own, from the snapshot
    public let currencyCode: String

    public var handler: String { from == .toBudget ? "budget/transfer-available" : "budget/transfer-category" }

    public init(from: MoveEnd, to: MoveEnd, amount: Int, in snapshot: BudgetMonth) throws {
        guard snapshot.budgetType == .envelope, BudgetAmountWrite.isMonth(snapshot.month) else {
            throw NativeBridgeError.invalidWrite("month")
        }
        guard amount > 0, amount <= BudgetAmountWrite.maxAmount else { throw NativeBridgeError.invalidWrite("amount") }
        guard from != to, Self.isEnd(from, in: snapshot), Self.isEnd(to, in: snapshot) else {
            throw NativeBridgeError.invalidWrite("category")
        }
        guard amount <= Self.limit(of: from, in: snapshot) ?? 0 else { throw NativeBridgeError.invalidWrite("amount") }
        (self.month, self.from, self.to, self.amount, self.currencyCode) = (snapshot.month, from, to, amount, snapshot.currencyCode)
    }

    // What the end holds to move: the month's to-budget, or the category's balance
    public static func limit(of end: MoveEnd, in snapshot: BudgetMonth) -> Int? {
        switch end {
        case .toBudget: return snapshot.totals.toBudget
        case .category(let id): return expenseCategories(snapshot).first { $0.id == id }?.balance
        }
    }

    // Expense categories of any group, hidden ones included, as the page checks
    static func expenseCategories(_ snapshot: BudgetMonth) -> [BudgetMonth.Category] {
        snapshot.groups.filter { !$0.isIncome }.flatMap(\.categories)
    }

    private static func isEnd(_ end: MoveEnd, in snapshot: BudgetMonth) -> Bool {
        guard case .category(let id) = end else { return true }
        return id != "to-budget" && expenseCategories(snapshot).contains { $0.id == id }
    }

    private enum Keys: String, CodingKey { case month, amount, category, from, to, currencyCode }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(month, forKey: .month)
        try container.encode(amount, forKey: .amount)
        func id(_ end: MoveEnd) -> String {
            if case .category(let id) = end { return id }
            return "to-budget"
        }
        if from == .toBudget {
            try container.encode(id(to), forKey: .category)
        } else {
            try container.encode(id(from), forKey: .from)
            try container.encode(id(to), forKey: .to)
            try container.encode(currencyCode, forKey: .currencyCode)
        }
    }
}

// Calls the page bridge. `transport` takes the handler name and its arguments
// as JSON, and returns the handler's result as JSON (the app runs it through
// PageCall, which checks the page origin first; tests pass a fake).
public struct NativeBridgeClient {
    public typealias Transport = (_ name: String, _ argsJSON: String) async throws -> String

    // A call into a suspended WebContent process hangs until the app is in
    // the foreground again (sc-3584 findings), so every call has a deadline.
    public static let defaultTimeout: TimeInterval = 5
    // A sync can take longer than a read (sc-3884)
    public static let defaultSyncTimeout: TimeInterval = 30

    private let transport: Transport
    private let timeout: TimeInterval
    private let syncTimeout: TimeInterval
    // The app's clients have one, so every write waits for storage. Demo and
    // screen-test clients have no page storage to wait for.
    private let storage: WriteStorageStatus?

    public init(
        timeout: TimeInterval = NativeBridgeClient.defaultTimeout, syncTimeout: TimeInterval = NativeBridgeClient.defaultSyncTimeout,
        storage: WriteStorageStatus? = nil, transport: @escaping Transport
    ) {
        self.timeout = timeout
        self.syncTimeout = syncTimeout
        self.storage = storage
        self.transport = transport
    }

    public func call(_ name: String) async throws -> Data {
        try await call(name, args: [String: String]())
    }

    public func call<Args: Encodable>(_ name: String, args: Args) async throws -> Data {
        if storage != nil, NativeBridgeAllowlist.kind(of: name) == .write {
            return try await sendThenPersist(name, args: args).data
        }
        return try await send(name, args: args)
    }

    // sc-5219 (D3): the write with its own deadline, then native/persisted with
    // its own. The write is never retried. A failure of the second call only
    // means not stored: the write has already been applied.
    private func sendThenPersist<Args: Encodable>(_ name: String, args: Args) async throws -> (data: Data, stored: Bool) {
        let origin = await storage?.writeBegan()
        let data: Data
        do {
            data = try await send(name, args: args)
        } catch {
            await storage?.writeEnded()
            throw error
        }
        let stored = await persisted(madeIn: origin)
        await storage?.writeEnded()
        return (data, stored)
    }

    #if SWIFT_PACKAGE
    func write<Args: Encodable>(_ name: String, args: Args) async throws -> StoredWrite {
        let result = try await sendThenPersist(name, args: args)
        return StoredWrite(data: result.data, stored: result.stored)
    }
    #endif

    private func persisted(madeIn origin: WriteOrigin?) async -> Bool {
        let ticket = await storage?.nextTicket() ?? 0
        do {
            let answer = try await askPersisted()
            return await storage?.record(answer, ticket: ticket, madeIn: origin) ?? answer.stored
        } catch NativeBridgeError.timedOut {
            await storage?.record(.notStored, ticket: ticket, madeIn: origin)
            // The one call that may be repeated: it changes nothing
            Task {
                let retry = await storage?.nextTicket() ?? 0
                if let answer = try? await askPersisted() { await storage?.record(answer, ticket: retry, madeIn: origin) }
            }
            return false
        } catch {
            await storage?.record(.notStored, ticket: ticket, madeIn: origin)
            return false
        }
    }

    // D8: before the app may stop running. Covers every file, so a budget just
    // closed is included. Its own route to native/persisted: the answer goes to
    // the storage status only, never to app code, until the guard can vouch for it.
    // Only a stored answer: writes' answers cover the open budget alone, so a later
    // one could clear a flush's "not stored" while another file is unconfirmed.
    public func flushStorage() async {
        guard let answer = try? await askPersisted(argsJSON: #"{"allFiles":true}"#), answer.stored else { return }
        await storage?.record(answer)
    }

    private func askPersisted(argsJSON: String = "{}") async throws -> PersistedAnswer {
        let name = "native/persisted"
        let json = try await withTimeout(name, timeout) { try await transport(name, argsJSON) }
        return try JSONDecoder().decode(PersistedAnswer.self, from: Data(json.utf8))
    }

    // Arguments are any JSON value, so a number crosses as a number
    private func send<Args: Encodable>(_ name: String, args: Args) async throws -> Data {
        // sync and the storage calls have their own paths
        guard let kind = NativeBridgeAllowlist.kind(of: name), kind != .sync, kind != .storage else {
            throw NativeBridgeError.notAllowlisted(name)
        }
        // Each write name takes only its own typed value
        let isTyped =
            (args is BudgetAmountWrite && name == "budget/budget-amount") || (args as? Transfer)?.handler == name
            || (args is PaycheckSkip && name == "paycheck-skip-next") || (args is NativeUndo && name == "native/undo")
            || (args is PaycheckSave && name == "native/paycheck-save") || (args is PaycheckDelete && name == "paycheck-delete")
            || (args is ReconcileTick && name == "native/reconcile-tick") || (args is ReconcileListSet && name == "native/reconcile-list-set")
            || (args is StatementBalanceSave && name == "account-statement-balance-save")
            || (args is ReconcileAdjust && name == "native/reconcile-adjust") || (args is ReconcileLock && name == "native/reconcile-lock")
            || (args is TransactionsCategorize && name == "native/transactions-categorize")
            || (args is TransactionsDelete && name == "native/transactions-delete")
            || (args is AccountReopen && name == "native/account-reopen") || (args is AccountMove && name == "native/account-move")
            || (args is SettingsSave && name == "native/settings-save")
            || (args is TransactionSave && name == "native/transaction-save")
        guard kind != .write || isTyped else {
            throw NativeBridgeError.invalidWrite(name)
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let argsJSON = String(decoding: try encoder.encode(args), as: UTF8.self)
        return Data(try await withTimeout(name, timeout) { try await transport(name, argsJSON) }.utf8)
    }

    // loot-core's server sync, with no arguments and its own deadline. The
    // deadline only ends the wait; `settled` runs when the page call itself
    // returns or fails, which can be later, since a script call into a
    // suspended page ignores cancellation (sc-3884).
    public func sync(settled: @escaping () -> Void = {}) async throws -> SyncResult {
        let json = try await withTimeout("sync", syncTimeout, settled: settled) { try await transport("sync", "{}") }
        guard let result = try? JSONDecoder().decode(SyncResult.self, from: Data(json.utf8)) else {
            throw NativeBridgeError.badResult
        }
        return result
    }

    public func setBudgetAmount(_ write: BudgetAmountWrite) async throws {
        _ = try await call("budget/budget-amount", args: write)
    }

    public func transfer(_ transfer: Transfer) async throws {
        _ = try await call(transfer.handler, args: transfer)
    }

    public func schedulesPaychecks() async throws -> SchedulesPaychecks {
        try JSONDecoder().decode(SchedulesPaychecks.self, from: await call("native/schedules-paychecks"))
    }

    public func skipNextPaycheck(_ skip: PaycheckSkip) async throws {
        _ = try await call("paycheck-skip-next", args: skip)
    }

    public func undo(_ undo: NativeUndo) async throws {
        _ = try await call("native/undo", args: undo)
    }

    public func budgetMonth(_ month: String) async throws -> BudgetMonth {
        try JSONDecoder().decode(BudgetMonth.self, from: await call("native/budget-month", args: ["month": month]))
    }

    // Not a task group: a group waits for every child, and a WebKit script call
    // into a suspended page ignores cancellation, so the deadline would never fire.
    private func withTimeout(
        _ name: String, _ timeout: TimeInterval, settled: (() -> Void)? = nil, _ work: @escaping () async throws -> String
    ) async throws -> String {
        let once = ResumeOnce<String>()
        return try await withCheckedThrowingContinuation { continuation in
            once.continuation = continuation
            let task = Task {
                do { once.resume(.success(try await work())) } catch { once.resume(.failure(error)) }
                settled?()
            }
            let nanoseconds = UInt64(timeout * 1_000_000_000)
            Task {
                try? await Task.sleep(nanoseconds: nanoseconds)
                if once.resume(.failure(NativeBridgeError.timedOut(name))) { task.cancel() }
            }
        }
    }
}

// Resumes a continuation at most once, from whichever side finishes first
private final class ResumeOnce<T> {
    var continuation: CheckedContinuation<T, Error>?
    private let lock = NSLock()

    @discardableResult
    func resume(_ result: Result<T, Error>) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
        return pending != nil
    }
}
