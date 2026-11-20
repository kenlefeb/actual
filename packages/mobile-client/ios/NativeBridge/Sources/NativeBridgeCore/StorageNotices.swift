import Combine
import Foundation

// Fork-only (sc-5219, native-durable-writes D5, D5a, D7a). The storage notices
// in the app's one notice slot: the failure notice with Reload, its restart
// forms and the "may not have been saved" restart notice with OK, and the
// closed-budget notice with OK. None hides on its own. A shell creates this
// only once it has opted in to the storage guard; until then nothing here runs.
@MainActor
public final class StorageNotices {
    // Changes made after this weren't saved, or may not have been
    enum CutOff: Equatable {
        case at(Date)
        case sinceOpened

        func isEarlier(than other: CutOff) -> Bool {
            switch (self, other) {
            case (.sinceOpened, _): return true
            case (.at, .sinceOpened): return false
            case (.at(let a), .at(let b)): return a < b
            }
        }
    }

    private let slot: WindowNotices
    private let storage: WriteStorageStatus
    private let reload: () -> Void
    private let now: () -> Date
    private let time: (Date) -> String
    private var observer: AnyCancellable?
    private var hasLoaded = false
    private var loads = 0
    // A load after the app's first: its time stands in when nothing has stored since
    private var reloadedAt: Date?
    private var failure: (cutOff: CutOff, quota: Bool, load: Int)?
    private var shownFailure: WindowNotice?
    // The restart notice on screen or waiting: a newer form replaces it, never joins it
    private var shownRestart: WindowNotice?
    // The restart notice waiting for OK, with the earliest cut-off and the
    // latest failure's reason, which the engine forgets at a restart
    private var held: CutOff?
    private var heldQuota = false
    // The page load the unguarded notice was last shown for, and how far it has gone
    private var unguardedEpoch: String?
    private enum UnguardedStage { case none, offered, reloaded, told, acknowledged }
    private var unguardedStage = UnguardedStage.none

    public init(
        slot: WindowNotices, storage: WriteStorageStatus, reload: @escaping () -> Void,
        now: @escaping () -> Date = Date.init, time: @escaping (Date) -> String = StorageNotices.localTime
    ) {
        (self.slot, self.storage, self.reload, self.now, self.time) = (slot, storage, reload, now, time)
        slot.onButton = { [weak self] in self?.tapped($0) }
        observer = storage.$mayNotBeSaved.sink { [weak self] in if $0 { self?.possibleLoss() } }
    }

    // To the second, in the person's locale
    public nonisolated static func localTime(_ date: Date) -> String {
        DateFormatter.localizedString(from: date, dateStyle: .none, timeStyle: .medium)
    }

    // The page finished loading
    public func pageLoaded() {
        if hasLoaded { reloadedAt = now() }
        hasLoaded = true
        loads += 1
        // After a reload or restart: a failure notice still showing keeps its place
        if held != nil, failure == nil { showHeld() }
    }

    // The page's process ended and the app reloaded it on its own
    public func restarted() {
        guard failure != nil || held != nil else { return }
        if let cutOff = failure?.cutOff, held.map({ cutOff.isEarlier(than: $0) }) ?? true { held = cutOff }
        if let failure { heldQuota = failure.quota }
        endFailure()
        // The restart notice says the same, and its OK clears it
        slot.end(Self.someMayNotBeSaved)
        if held != nil { showHeld() }
    }

    // The page's storage-failed event; `lastStoredFlushAt` in milliseconds
    public func failed(lastStoredFlushAt: Double?, quota: Bool) {
        var cutOff: CutOff =
            lastStoredFlushAt.map { .at(Date(timeIntervalSince1970: $0 / 1000)) } ?? reloadedAt.map { .at($0) } ?? .sinceOpened
        // Another report of the same failure keeps the earlier cut-off; a failure
        // after a reload or restart has its own
        if let failure, failure.load == loads, failure.cutOff.isEarlier(than: cutOff) { cutOff = failure.cutOff }
        let notice = failureNotice(cutOff, quota: quota)
        if let shownFailure, shownFailure != notice { slot.end(shownFailure) }
        failure = (cutOff, quota, loads)
        shownFailure = notice
        slot.show(notice)
    }

    // Security's ruling, as the Designer revised it: this page loaded without the
    // guard this shell relies on. Reload is offered once per page load until the
    // person reloads; a mismatch that survives their Reload is told once more with
    // OK, and after OK not again this session unless a matching page clears it.
    // Never a reload of its own.
    public func pageUnguarded(epoch: String) {
        guard epoch != unguardedEpoch else { return }
        unguardedEpoch = epoch
        switch unguardedStage {
        case .none, .offered:
            unguardedStage = .offered
            slot.show(Self.unguarded)
        case .reloaded, .told:
            unguardedStage = .told
            slot.show(Self.unguardedAfterReload)
        case .acknowledged:
            break
        }
    }

    // A page that has the guard: a later mismatch is told again from the start
    public func pageGuarded() {
        unguardedStage = .none
        unguardedEpoch = nil
        slot.end(Self.unguarded)
        slot.end(Self.unguardedAfterReload)
    }

    // A closed budget's last write failed; it follows any notice showing
    public func closeFailed() {
        slot.queue(Self.closedBudget)
    }

    private func showHeld() {
        guard let held else { return }
        let notice = restartNotice(held, quota: heldQuota)
        if let shownRestart, shownRestart != notice { slot.end(shownRestart) }
        shownRestart = notice
        slot.show(notice)
    }

    private func endFailure() {
        if let shownFailure { slot.end(shownFailure) }
        failure = nil
        shownFailure = nil
    }

    private func possibleLoss() {
        guard failure == nil, held == nil else { return }
        slot.show(Self.someMayNotBeSaved)
    }

    private func tapped(_ notice: WindowNotice) {
        switch notice.button {
        case .reload:
            endFailure()
            if notice == Self.unguarded {
                slot.end(Self.unguarded)
                unguardedStage = .reloaded
            }
            storage.acknowledgeUnstoredOfThisPage()
            reload()
        case .ok where notice == Self.unguardedAfterReload:
            unguardedStage = .acknowledged
            slot.end(notice)
        case .ok:
            if notice != Self.closedBudget {
                held = nil
                heldQuota = false
                if let shownRestart { slot.end(shownRestart) }
                shownRestart = nil
                storage.acknowledgeMayNotBeSaved()
                slot.end(Self.someMayNotBeSaved)
            }
            slot.end(notice)
        case .dismiss:
            break
        }
    }

    // MARK: Copy (the Product Owner's wording, native-bridge spec)

    static let someMayNotBeSaved = WindowNotice(
        text: NSLocalizedString(
            "The app restarted. Some recent changes may not have been saved. Check them, and make again any that are missing.",
            comment: "Storage notice: the app restarted while a change was still being saved"),
        lifetime: .persistent, button: .ok)

    // Proposed wording (Security's ruling), awaiting the Designer and Product Owner
    static let unguarded = WindowNotice(
        text: NSLocalizedString(
            "This device can't confirm that changes are saved. Reload the app. Changes made before you reload may not have been saved.",
            comment: "Storage notice: the page loaded without the storage guard, so no change can be confirmed saved"),
        lifetime: .persistent, button: .reload)

    // The Product Owner's words (PR #505 comment 7039547330) for a mismatch Reload didn't fix
    static let unguardedAfterReload = WindowNotice(
        text: NSLocalizedString(
            "Reload didn't fix it. Changes may not be saved on this device. Keep the app open until this is fixed or the app is updated.",
            comment: "Storage notice: the page still loaded without the storage guard after the person reloaded"),
        lifetime: .persistent, button: .ok)

    static let closedBudget = WindowNotice(
        text: NSLocalizedString(
            "Some recent changes to the budget you closed weren't saved. Open it and make them again.",
            comment: "Storage notice: a closed budget's last change failed to save"),
        lifetime: .persistent, button: .ok)

    private func failureNotice(_ cutOff: CutOff, quota: Bool) -> WindowNotice {
        let lost: String
        switch cutOff {
        case .at(let date):
            lost = String(
                format: NSLocalizedString(
                    "Changes made after %@ weren't saved and need to be made again.",
                    comment: "Storage notice: what was lost; %@ is a time to the second"), shown(date))
        case .sinceOpened:
            lost = NSLocalizedString(
                "Changes made since you opened the app weren't saved and need to be made again.",
                comment: "Storage notice: what was lost when nothing stored this session")
        }
        let text =
            quota
            ? String(
                format: NSLocalizedString(
                    "This device is full, so changes can't be saved. Free up some space, then reload the app. %@ Saved changes can't sync until there's space.",
                    comment: "Storage notice: the device is full; %@ is what was lost"), lost)
            : String(
                format: NSLocalizedString(
                    "Changes can't be saved on this device right now. Reload the app. %@",
                    comment: "Storage notice: storage failed; %@ is what was lost"), lost)
        return WindowNotice(text: text, lifetime: .persistent, button: .reload)
    }

    private func restartNotice(_ cutOff: CutOff, quota: Bool) -> WindowNotice {
        let since: String
        switch cutOff {
        case .at(let date):
            since = String(
                format: NSLocalizedString(
                    "Changes made after %@ may not have been saved. Check them, and make again any that are missing.",
                    comment: "Storage notice after a restart; %@ is a time to the second"), shown(date))
        case .sinceOpened:
            since = NSLocalizedString(
                "Changes made since you opened the app may not have been saved. Check them, and make again any that are missing.",
                comment: "Storage notice after a restart when nothing stored this session")
        }
        let text =
            quota
            ? String(
                format: NSLocalizedString(
                    "The app restarted, and this device is out of space. Free up some space. %@",
                    comment: "Storage notice: restart while the device is full; %@ is what may be lost"), since)
            : String(
                format: NSLocalizedString(
                    "The app restarted. %@", comment: "Storage notice: restart; %@ is what may be lost"), since)
        return WindowNotice(text: text, lifetime: .persistent, button: .ok)
    }

    // Truncated to the second, never rounded up, so a stored change isn't made twice
    private func shown(_ date: Date) -> String {
        time(Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)))
    }
}

// A wait a screen started, cancelled when the screen goes away
final class PendingWait {
    var task: Task<Void, Never>?
    deinit { task?.cancel() }
}

extension NativeBridgeEvent {
    // The page's storage-failed: when the last stored write was flushed (ms), and whether storage is full
    public static func storageFailure(of body: Any) -> (lastStoredFlushAt: Double?, quota: Bool)? {
        guard name(of: body) == "storage-failed" else { return nil }
        let payload = (body as? [String: Any])?["payload"] as? [String: Any]
        return ((payload?["lastStoredFlushAt"] as? NSNumber)?.doubleValue, payload?["quota"] as? Bool ?? false)
    }
}
