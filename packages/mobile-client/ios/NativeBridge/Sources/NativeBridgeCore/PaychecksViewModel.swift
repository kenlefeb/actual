import Combine
import Foundation

// Fork-only (sc-4341, native-paychecks-screen spec). The Schedules & Paychecks
// list's state. It holds `native/schedules-paychecks` exactly as loot-core
// returned it, sends a skip or an undo, and reads again; it never works out a
// date or an amount (ADR 11). Free of UIKit, so the Mac app reuses it (sc-4352).
public enum PaychecksLoadState: Equatable {
    case loading
    case loaded(SchedulesPaychecks)
    case failed(BudgetLoadError)
    // A re-read failed: the last good values stay, with the refresh message
    case stale(SchedulesPaychecks, BudgetLoadError)

    public var read: SchedulesPaychecks? {
        switch self {
        case .loaded(let read), .stale(let read, _): return read
        case .loading, .failed: return nil
        }
    }
}

public enum PaychecksActionError: Equatable {
    case skipFailed, skipTimedOut, undoFailed, undoTimedOut

    public var message: String {
        switch self {
        case .skipFailed:
            return NSLocalizedString("The paycheck could not be skipped. Nothing changed.", comment: "Native Paychecks: skip failed")
        case .skipTimedOut:
            return NSLocalizedString(
                "The budget did not answer in time. The paycheck was not skipped.", comment: "Native Paychecks: skip timed out")
        case .undoFailed:
            return NSLocalizedString(
                "Couldn't undo: something else changed since. Nothing was undone.", comment: "Native Paychecks: undo refused")
        case .undoTimedOut:
            return NSLocalizedString("The budget did not answer in time. Nothing was undone.", comment: "Native Paychecks: undo timed out")
        }
    }
}

// What the brief Undo after a skip, save or delete would reverse: loot-core
// undoes it only if its latest undo step still carries `token` (native/undo)
public struct PaychecksUndoOffer: Equatable {
    public enum Action: Equatable { case skip, create, save, delete }

    public let token: String
    public let paycheckName: String
    // The pay date that was skipped, as the list showed it; empty otherwise
    public let date: String
    public let action: Action

    public init(token: String, paycheckName: String, date: String, action: Action = .skip) {
        (self.token, self.paycheckName, self.date, self.action) = (token, paycheckName, date, action)
    }
}

@MainActor
public final class PaychecksViewModel: ObservableObject {
    // The tables whose changes can change what the list shows
    public static let watchedTables: Set<String> = [
        "paychecks", "paycheck_schedules", "schedules", "schedules_next_date", "rules", "transactions", "accounts",
        "preferences", "business_calendars", "payees",
    ]

    @Published public private(set) var state: PaychecksLoadState = .loading
    @Published public private(set) var actionError: PaychecksActionError?
    @Published public private(set) var undoOffer: PaychecksUndoOffer?
    @Published public private(set) var isWorking = false
    // For VoiceOver: what just happened
    @Published public private(set) var announcement: String?
    // As the web's "Show completed schedules"
    @Published public var showCompleted = false

    private let client: NativeBridgeClient
    private let undoInterval: TimeInterval
    private var coalescer: ChangeCoalescer?
    private var isSceneActive = true
    private var loadGeneration = 0
    private var offerGeneration = 0

    public init(client: NativeBridgeClient, undoInterval: TimeInterval = 10, changeInterval: TimeInterval = 1.0 / 60) {
        self.client = client
        self.undoInterval = undoInterval
        coalescer = ChangeCoalescer(interval: changeInterval) { [weak self] in
            guard let self, self.isSceneActive else { return }
            Task { @MainActor in await self.load() }
        }
    }

    public var visibleSchedules: [SchedulesPaychecks.Schedule] {
        let all = state.read?.schedules ?? []
        return showCompleted ? all : all.filter { !$0.completed }
    }

    public var hasCompletedSchedules: Bool { state.read?.schedules.contains { $0.completed } ?? false }

    // A page event. Only a sync-event names its changed tables; one that
    // touches what the list shows re-reads (coalesced) and withdraws the Undo
    // offer, which the change could make wrong. A sync with no changed
    // tables (a full sync's start and success) leaves both alone.
    public func eventReceived(_ event: String, tables: [String]) {
        guard event == "sync-event", !tables.isEmpty else { return }
        withdrawOffer()
        guard isSceneActive, tables.contains(where: Self.watchedTables.contains) else { return }
        coalescer?.notify()
    }

    // The page bridge is back after a refused call (sc-3859)
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

    // The screen went away: no Undo survives it
    public func leave() { withdrawOffer() }

    public func clearActionError() { actionError = nil }

    // Generation-counted, so an older read never wins over a newer one
    public func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        do {
            let read = try await client.schedulesPaychecks()
            guard generation == loadGeneration else { return }
            state = .loaded(read)
        } catch {
            guard generation == loadGeneration else { return }
            let failure = BudgetLoadError.from(error)
            if let good = state.read { state = .stale(good, failure) } else { state = .failed(failure) }
        }
    }

    // Skips the paycheck's next pay date and every deposit's, through
    // loot-core, with a fresh undo token; then reads again and offers Undo
    public func skipNext(_ paycheckId: String) async -> Bool {
        guard !isWorking else { return false }
        withdrawOffer()
        actionError = nil
        let paycheck = state.read?.paychecks.first { $0.id == paycheckId }
        guard let skip = try? PaycheckSkip(id: paycheckId) else {
            actionError = .skipFailed
            return false
        }
        isWorking = true
        defer { isWorking = false }
        do {
            try await client.skipNextPaycheck(skip)
        } catch {
            actionError = Self.isTimeout(error) ? .skipTimedOut : .skipFailed
            return false
        }
        await load()
        offer(PaychecksUndoOffer(token: skip.undoToken, paycheckName: paycheck?.name ?? "", date: paycheck?.next?.date ?? ""))
        return true
    }

    // Only from a tap on the offered Undo
    public func undo() async {
        guard let offer = undoOffer, !isWorking else { return }
        withdrawOffer()
        actionError = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await client.undo(try NativeUndo(token: offer.token))
        } catch {
            actionError = Self.isTimeout(error) ? .undoTimedOut : .undoFailed
            announcement = actionError?.message
            return
        }
        await load()
        announcement =
            switch offer.action {
            case .skip: NSLocalizedString("Skip undone.", comment: "Native Paychecks: VoiceOver after Undo")
            case .create, .save, .delete: NSLocalizedString("Undone.", comment: "Native Paychecks: VoiceOver after Undo of a save or delete")
            }
    }

    // sc-4343: the editor saved or deleted a paycheck; read again and offer
    // Undo, as after a skip
    public func wrote(_ offer: PaychecksUndoOffer) async {
        withdrawOffer()
        await load()
        self.offer(offer)
    }

    private func offer(_ offer: PaychecksUndoOffer) {
        offerGeneration += 1
        let generation = offerGeneration
        undoOffer = offer
        announcement =
            switch offer.action {
            case .skip:
                String(
                    format: NSLocalizedString(
                        "Skipped the paycheck on %@. Undo is available.", comment: "Native Paychecks: VoiceOver after a skip"),
                    offer.date)
            case .create, .save:
                String(
                    format: NSLocalizedString("Saved %@. Undo is available.", comment: "Native Paychecks: VoiceOver after a save"),
                    offer.paycheckName)
            case .delete:
                String(
                    format: NSLocalizedString("Deleted %@. Undo is available.", comment: "Native Paychecks: VoiceOver after a delete"),
                    offer.paycheckName)
            }
        let nanoseconds = UInt64(undoInterval * 1_000_000_000)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard let self, self.offerGeneration == generation else { return }
            self.undoOffer = nil
        }
    }

    private func withdrawOffer() {
        offerGeneration += 1
        undoOffer = nil
    }

    private static func isTimeout(_ error: Error) -> Bool {
        if case NativeBridgeError.timedOut = error { return true }
        return false
    }
}
