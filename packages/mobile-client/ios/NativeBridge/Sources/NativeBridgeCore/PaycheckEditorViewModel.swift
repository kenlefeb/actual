import Combine
import Foundation

// Fork-only (sc-4343, native-paychecks-screen spec). The paycheck editor
// sheet's state. Swift edits the draft's fields; loot-core answers for it
// (native/paycheck-preview: net pay, deposits, dates and the web form's error
// codes) and saves or deletes it (native/paycheck-save, paycheck-delete). No
// paycheck rule lives here (ADR 11). Free of UIKit, so the Mac app reuses it.
@MainActor
public final class PaycheckEditorViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case loading
        case ready
        case failed(BudgetLoadError)
        // The paycheck was deleted elsewhere while the sheet opened
        case gone
    }

    // The editor's sections, in the web's order
    public enum Field: String, CaseIterable {
        case name, clearingAccount, grossPay, deductions, deposits
    }

    @Published public private(set) var state: LoadState = .loading
    @Published public private(set) var draft: PaycheckDraft
    @Published public private(set) var options = PaycheckEditorOptions()
    // loot-core's answer for the latest draft it answered for
    @Published public private(set) var preview: PaycheckPreview?
    // False while the latest edit's preview is pending
    @Published public private(set) var isPreviewCurrent = false
    // nil until read, and for a new paycheck
    @Published public private(set) var yearToDate: [PaycheckYearToDate]?
    @Published public private(set) var isSaving = false
    @Published public private(set) var isDeleting = false
    // A refused or failed save or delete; the draft stays
    @Published public private(set) var actionError: String?
    // For VoiceOver: the errors as they change
    @Published public private(set) var announcement: String?

    public let paycheckId: String?
    public var isNew: Bool { paycheckId == nil }

    private let client: NativeBridgeClient
    private let debounce: TimeInterval
    private let onWrite: (PaychecksUndoOffer) -> Void
    private var original: PaycheckDraft
    private var previewGeneration = 0
    private var previewTask: Task<Void, Never>?

    // `onWrite` gets the Undo offer of a save or delete that went through
    public init(
        client: NativeBridgeClient, paycheckId: String?, today: String, debounce: TimeInterval = 0.25,
        onWrite: @escaping (PaychecksUndoOffer) -> Void = { _ in }
    ) {
        self.client = client
        self.paycheckId = paycheckId
        self.debounce = debounce
        self.onWrite = onWrite
        // A new paycheck creates its clearing account unless the user picks one
        let draft = PaycheckDraft(name: "", definition: .new(today: today), isNewAccount: paycheckId == nil)
        self.draft = draft
        original = draft
    }

    // Reads the pickers, the stored paycheck and its year-to-date, then the
    // first preview
    public func start() async {
        state = .loading
        do {
            options = try await client.paycheckEditorOptions()
            if let id = paycheckId {
                guard let stored = try await client.storedPaycheck(id) else {
                    state = .gone
                    return
                }
                draft = PaycheckDraft(id: id, name: stored.name, definition: stored.definition, isNewAccount: false)
                original = draft
                yearToDate = try? await client.paycheckYearToDate(id)
            }
            state = .ready
        } catch {
            state = .failed(BudgetLoadError.from(error))
            return
        }
        await refreshPreview()
    }

    // Every edit goes through here, so the preview follows it
    public func update(_ change: (inout PaycheckDraft) -> Void) {
        change(&draft)
        actionError = nil
        schedulePreview()
    }

    public var hasChanges: Bool { draft != original }

    // ✓ is enabled only for a draft loot-core answered for with no errors
    public var canSave: Bool {
        state == .ready && isPreviewCurrent && (preview?.errors.isEmpty ?? false) && !isSaving && !isDeleting
    }

    // The web form shows errors once the user has changed something
    public func errors(for field: Field) -> [String] {
        guard hasChanges, let preview else { return [] }
        return preview.errors.filter { $0.field == field.rawValue }.map { PaycheckErrorText.message($0.code) }
    }

    public var allErrors: [String] {
        guard hasChanges, let preview else { return [] }
        return preview.errors.map { PaycheckErrorText.message($0.code) }
    }

    // "{employer} Paycheck", the web's default name for a new clearing account
    public var defaultClearingName: String {
        guard let employer = preview?.employerName, !employer.isEmpty else { return "" }
        return String(format: NSLocalizedString("%@ Paycheck", comment: "Paycheck editor: default clearing account name"), employer)
    }

    public var clearingName: String {
        let typed = draft.newClearingAccountName.trimmingCharacters(in: .whitespaces)
        return typed.isEmpty ? defaultClearingName : typed
    }

    // Both years without posted pay: loot-core's hasHistory, never zeros
    public var isYearToDateEmpty: Bool { yearToDate?.allSatisfy { !$0.hasHistory } ?? false }

    // The days early shown for a deposit account: the edited value, else saved
    public func daysEarly(for account: String) -> Int {
        draft.daysEarly[account] ?? preview?.deposits.first { d in
            draft.definition.deposits.contains { $0.id == d.id && $0.account == account }
        }?.savedDaysEarly ?? 0
    }

    public func setDaysEarly(_ days: Int, for account: String) {
        update { $0.daysEarly[account] = days }
    }

    // Saves through loot-core in one all-or-nothing write. True when the
    // sheet may close; on a refusal the draft and the sheet stay.
    public func save() async -> Bool {
        guard canSave else { return false }
        actionError = nil
        // Only accounts still deposited to, as the web saves them
        var draft = self.draft
        let deposited = Set(draft.definition.deposits.map(\.account))
        draft.daysEarly = draft.daysEarly.filter { deposited.contains($0.key) }
        draft.name = draft.name.trimmingCharacters(in: .whitespaces)
        let write: PaycheckSave
        do {
            write = try PaycheckSave(
                id: paycheckId, draft: draft, newClearingAccountName: draft.isNewAccount && isNew ? clearingName : nil)
        } catch {
            actionError = Self.failed
            return false
        }
        isSaving = true
        defer { isSaving = false }
        do {
            _ = try await client.savePaycheck(write)
        } catch {
            actionError = Self.message(for: error)
            announcement = actionError
            return false
        }
        onWrite(PaychecksUndoOffer(token: write.undoToken, paycheckName: draft.name, date: "", action: isNew ? .create : .save))
        return true
    }

    // Deletes the paycheck and its schedules through loot-core, after the
    // view asked. True when the sheet may close.
    public func delete() async -> Bool {
        guard let id = paycheckId, !isSaving, !isDeleting else { return false }
        actionError = nil
        guard let write = try? PaycheckDelete(id: id) else {
            actionError = Self.failed
            return false
        }
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await client.deletePaycheck(write)
        } catch {
            actionError = Self.message(for: error)
            announcement = actionError
            return false
        }
        onWrite(PaychecksUndoOffer(token: write.undoToken, paycheckName: original.name, date: "", action: .delete))
        return true
    }

    public func clearActionError() { actionError = nil }

    private func schedulePreview() {
        isPreviewCurrent = false
        previewTask?.cancel()
        let nanoseconds = UInt64(debounce * 1_000_000_000)
        previewTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            await self?.refreshPreview()
        }
    }

    // Only the latest request's answer is kept
    private func refreshPreview() async {
        previewGeneration += 1
        let generation = previewGeneration
        let sent = draft
        do {
            let answer = try await client.paycheckPreview(sent)
            guard generation == previewGeneration else { return }
            let before = allErrors
            preview = answer
            isPreviewCurrent = sent == draft
            let after = allErrors
            if after != before, !after.isEmpty { announcement = after.joined(separator: " ") }
        } catch {
            guard generation == previewGeneration else { return }
            // The last answer stays; save waits for a current one
            isPreviewCurrent = false
        }
    }

    static let failed = NSLocalizedString("The paycheck could not be saved. Nothing changed.", comment: "Paycheck editor: write failed")
    static let timedOut = NSLocalizedString(
        "The budget did not answer in time. Nothing changed.", comment: "Paycheck editor: write timed out")

    // loot-core's own message for a refused write, its draft codes as the
    // web's text, or a fixed message
    static func message(for error: Error) -> String {
        if case NativeBridgeError.timedOut = error { return timedOut }
        guard case NativeBridgeError.page(let message) = error else { return failed }
        // `[native:invalid-draft:<codes>]`: the draft codes in the web's words
        if let refusal = NativeRefusal(message), refusal.code == .invalidDraft {
            return refusal.detail.map { PaycheckErrorText.message($0) }.joined(separator: " ")
        }
        // Bridge refusals ("native bridge: …", "native/…", or any coded one) are not for people
        if message.hasPrefix("native") || message.hasPrefix("[native:") { return failed }
        return message
    }
}
