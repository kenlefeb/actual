import SwiftUI
import UIKit

// Fork-only (sc-4825, native-reconcile-resolve-and-lock; Figma 54:269 step 3,
// 54:342 adjustment, 54:406 step 4, 54:465 done, 59:653 balance moved). Every
// amount, match and what locks is loot-core's; these screens only show them.

struct ReconcilePrimaryButton: View {
    let title: String
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.headline).foregroundColor(isEnabled ? NativeReconcileTokens.onAccent : nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 44).multilineTextAlignment(.center)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .disabled(!isEnabled)
    }
}

// Statement, Cleared and Difference; one column at accessibility sizes
struct ReconcileSummaryCard: View {
    let summary: ReconcileSummary?
    let style: BudgetAmountStyle
    @Environment(\.dynamicTypeSize) private var typeSize

    private func amount(_ value: Int?) -> String { value.map { BudgetAmountFormat.string($0, style: style) } ?? "—" }

    var body: some View {
        let difference = summary?.difference
        let balanced = difference == 0
        let tint = balanced ? NativeReconcileTokens.accent : NativeReconcileTokens.attention
        let columns = typeSize.isAccessibilitySize ? [GridItem(.flexible())] : Array(repeating: GridItem(.flexible(), alignment: .top), count: 3)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            figure(ReconcileWords.statement, amount(summary?.statement), tint: .primary)
            figure(ReconcileWords.cleared, amount(summary?.cleared), tint: .primary)
            figure(balanced ? ReconcileWords.balanced : ReconcileWords.difference, amount(difference) + (balanced ? " ✓" : ""), tint: tint)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.12)))
                .accessibilityAddTraits(.updatesFrequently)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 16).fill(NativeReconcileTokens.card))
    }

    private func figure(_ label: String, _ value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundColor(tint == .primary ? .secondary : tint)
            Text(value).font(.headline.monospacedDigit()).foregroundColor(tint).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// Steps 3 and 4: the step line and the summary, pinned above the list
struct ReconcilePinnedHeader: View {
    let step: Int
    let name: String
    let summary: ReconcileSummary?
    let style: BudgetAmountStyle

    var body: some View {
        VStack(spacing: 12) {
            ReconcileStepHeader(step: step, name: name)
            ReconcileSummaryCard(summary: summary, style: style)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(NativeReconcileTokens.background)
    }
}

// A tappable option: a title in the accent and a line under it
struct ReconcileOption: View {
    let title: String
    let detail: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundColor(NativeReconcileTokens.accent)
                if let detail { Text(detail).font(.subheadline).foregroundColor(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Step 3

struct ReconcileResolveView: View {
    @ObservedObject var model: ReconcileResolveViewModel
    @ObservedObject var tick: ReconcileTickViewModel
    let style: BudgetAmountStyle
    let loadCategories: () async -> [BudgetMonth.Category]
    let back: () -> Void
    let close: () -> Void
    // Closes the flow to the checklist and opens a page path (the add form)
    let closeToChecklist: (String) -> Void
    let toLock: () -> Void
    @State private var searchText: String?
    @State private var isAdjusting = false
    @Environment(\.dynamicTypeSize) private var typeSize

    private func amount(_ value: Int) -> String { BudgetAmountFormat.string(value, style: style) }
    private var difference: String { amount(model.difference ?? 0) }

    var body: some View {
        List {
            if typeSize.isAccessibilitySize {
                ReconcilePinnedHeader(step: 3, name: ReconcileWords.resolve, summary: tick.summary, style: style)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
            }
            if !model.matches.isEmpty {
                Section(header: Text(ReconcileWords.likely)) {
                    ForEach(Array(model.matches.enumerated()), id: \.offset) { _, match in matchRow(match) }
                }
            }
            Section(header: Text(ReconcileWords.otherWays)) {
                if let searchText {
                    TextField(ReconcileWords.findAmount, text: Binding(get: { searchText }, set: { self.searchText = $0 }))
                        .onSubmit { Task { await model.search(searchText) } }
                        .submitLabel(.search)
                    ForEach(model.searchResults.read?.rows ?? []) { row in
                        NativeTransactionRow(
                            payee: row.payee ?? row.notes ?? "", category: row.category, date: row.date,
                            amount: (row.amount > 0 ? "+" : "") + amount(row.amount), isIncome: row.amount > 0,
                            status: row.reconciled ? .locked : row.cleared ? .cleared : .notCleared
                        )
                        .onTapGesture { Task { await model.toggle(row) } }
                        .accessibilityAction { Task { await model.toggle(row) } }
                    }
                } else {
                    ReconcileOption(title: String(format: ReconcileWords.searchFor, difference), detail: ReconcileWords.swappedDigits) {
                        let text = BudgetAmountFormat.editString(abs(model.difference ?? 0), style: style)
                        searchText = text
                        Task { await model.search(text) }
                    }
                }
                if let path = model.addPath {
                    ReconcileOption(title: ReconcileWords.addMissing, detail: String(format: ReconcileWords.addMissingDetail, difference)) {
                        closeToChecklist(path)
                    }
                }
                ReconcileOption(title: ReconcileWords.backToTick, detail: ReconcileWords.checkAgain, action: back)
            }
            Section(header: Text(ReconcileWords.cantFind)) {
                ReconcileOption(title: String(format: ReconcileWords.addAdjustmentOf, difference), detail: ReconcileWords.adjustmentDetail) {
                    isAdjusting = true
                }
            }
            if let error = model.error { Text(error.message).foregroundColor(.secondary) }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .top) {
            if !typeSize.isAccessibilitySize { ReconcilePinnedHeader(step: 3, name: ReconcileWords.resolve, summary: tick.summary, style: style) }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: back) { Image(systemName: "chevron.left") }.accessibilityLabel(Text(ReconcileWords.backToTick))
            }
            ToolbarItem(placement: .principal) {
                Text(String(format: ReconcileWords.reconcileAccount, model.accountName)).font(.headline).accessibilityAddTraits(.isHeader)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel(Text(ReconcileWords.closeKeepTicks))
            }
        }
        .task {
            await model.load()
            await tick.load()
            #if DEBUG
            if ReconcileDemo.opensAdjustSheet { isAdjusting = true }
            #endif
        }
        .onChange(of: model.state) { _ in Task { await tick.load() } }
        // At zero the flow moves to step 4 by itself, with a success haptic
        .onChange(of: model.reachedZero) { reached in
            guard reached else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            UIAccessibility.post(notification: .announcement, argument: ReconcileWords.differenceZero)
            toLock()
        }
        .sheet(isPresented: $isAdjusting) {
            ReconcileAdjustSheet(model: model, style: style, loadCategories: loadCategories)
        }
    }

    private func matchRow(_ match: ReconcileMatches.Match) -> some View {
        let isUntick = match.kind == .untickOne
        let detail =
            switch match.kind {
            case .tickOne: ReconcileWords.sameAmount
            case .tickTwo: ReconcileWords.twoRows
            case .untickOne, .other: ReconcileWords.untickDetail
            }
        let action = isUntick ? ReconcileWords.untickIt : ReconcileWords.tickIt
        return Button {
            Task { await model.apply(match) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(match.rows) { row in
                    NativeTransactionRow(
                        payee: row.payee ?? row.notes ?? "", category: row.category, date: row.date,
                        amount: (row.amount > 0 ? "+" : "") + amount(row.amount), isIncome: row.amount > 0,
                        status: row.cleared ? .cleared : .notCleared)
                }
                Text(detail).font(.footnote).foregroundColor(.secondary)
                Text(action).font(.subheadline.weight(.semibold)).foregroundColor(NativeReconcileTokens.accent)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(action))
    }
}

// The confirm sheet: medium detent, the amount spelled out in its button
struct ReconcileAdjustSheet: View {
    @ObservedObject var model: ReconcileResolveViewModel
    let style: BudgetAmountStyle
    let loadCategories: () async -> [BudgetMonth.Category]
    @Environment(\.dismiss) private var dismiss
    @State private var categories: [BudgetMonth.Category] = []
    @State private var categoryId: String?

    private var signed: String {
        let difference = model.difference ?? 0
        return (difference > 0 ? "+" : "") + BudgetAmountFormat.string(difference, style: style)
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Text(signed).font(.largeTitle.weight(.bold).monospacedDigit())
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                Section {
                    LabeledRow(label: ReconcileWords.payee, value: ReconcileWords.adjustmentLabel)
                    LabeledRow(label: ReconcileWords.date, value: String(format: ReconcileWords.today, Dates.todayLong()))
                    Picker(ReconcileWords.category, selection: $categoryId) {
                        Text(ReconcileWords.noCategory).tag(String?.none)
                        ForEach(categories) { category in Text(category.name).tag(String?.some(category.id)) }
                    }
                    LabeledRow(label: ReconcileWords.cleared, value: ReconcileWords.locksInStepFour)
                } footer: {
                    Text(String(format: ReconcileWords.budgetChanges, BudgetAmountFormat.string(abs(model.difference ?? 0), style: style)))
                }
                if let error = model.error { Text(error.message).foregroundColor(.secondary) }
            }
            .safeAreaInset(edge: .bottom) {
                ReconcilePrimaryButton(title: String(format: ReconcileWords.addSignedAdjustment, signed), isEnabled: model.difference != 0) {
                    Task {
                        if await model.adjust(categoryId: categoryId, label: ReconcileWords.adjustmentLabel) { dismiss() }
                    }
                }
                .padding()
                .background(NativeReconcileTokens.background)
            }
            .navigationTitle(ReconcileWords.addAdjustmentTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel(Text(ReconcileWords.close))
                }
            }
        }
        .tint(NativeReconcileTokens.accent)
        .mediumDetent()
        .task { categories = await loadCategories() }
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer(minLength: 12)
            Text(value).foregroundColor(.secondary).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

extension View {
    // A medium-detent sheet on iOS 16 and later; full height before
    @ViewBuilder func mediumDetent() -> some View {
        if #available(iOS 16.4, *) {
            // Opaque, so the page behind never shows through the sheet
            presentationDetents([.medium, .large]).presentationBackground(NativeReconcileTokens.background)
        } else if #available(iOS 16, *) {
            presentationDetents([.medium, .large])
        } else {
            self
        }
    }
}

// MARK: Step 4

struct ReconcileLockView: View {
    @ObservedObject var model: ReconcileLockViewModel
    let style: BudgetAmountStyle
    let accountName: String
    let provider: String?
    let adjustmentToken: String?
    let back: () -> Void
    let close: () -> Void
    let removed: () -> Void
    let locked: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private func amount(_ value: Int) -> String { BudgetAmountFormat.string(value, style: style) }

    var body: some View {
        List {
            if typeSize.isAccessibilitySize {
                ReconcilePinnedHeader(step: 4, name: ReconcileWords.lockStep, summary: summary, style: style)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
            }
            if let preview = model.state.read {
                Section(header: Text(ReconcileWords.whatLocks)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(format: ReconcileWords.clearedCount, preview.count))
                        Text(accountName).font(.subheadline).foregroundColor(.secondary)
                    }
                    if !preview.partners.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(format: ReconcileWords.linkedCount, preview.partners.count))
                            Text(partnersLine(preview)).font(.subheadline).foregroundColor(.secondary)
                        }
                    }
                    if let record = preview.record {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ReconcileWords.balanceOnRecord)
                            Text(recordLine(record)).font(.subheadline).foregroundColor(.secondary)
                        }
                    }
                    if let adjustmentToken {
                        Button(ReconcileWords.removeAdjustment) {
                            Task { if await model.removeAdjustment(token: adjustmentToken) { removed() } }
                        }
                    }
                }
            } else if case .failed(let error) = model.state {
                ReconcileErrorView(message: error.message) { Task { await model.load() } }
            }
            if typeSize.isAccessibilitySize {
                lockNote.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            if let error = model.error { Text(error.message).foregroundColor(.secondary) }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .top) {
            if !typeSize.isAccessibilitySize { ReconcilePinnedHeader(step: 4, name: ReconcileWords.lockStep, summary: summary, style: style) }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                if !typeSize.isAccessibilitySize { lockNote }
                ReconcilePrimaryButton(
                    title: String(format: ReconcileWords.lockCount, model.state.read?.count ?? 0),
                    isEnabled: model.state.read != nil && !model.isLocking
                ) {
                    Task {
                        guard await model.lock(), let result = model.result else { return }
                        UINotificationFeedbackGenerator().notificationOccurred(result.verified ? .success : .warning)
                        locked()
                    }
                }
                Button(action: close) {
                    Text(ReconcileWords.notNow).fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.center)
                }
                .font(.headline).frame(minHeight: 44)
            }
            .padding()
            .background(NativeReconcileTokens.background)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: back) { Image(systemName: "chevron.left") }.accessibilityLabel(Text(ReconcileWords.backToTick))
            }
            ToolbarItem(placement: .principal) {
                Text(String(format: ReconcileWords.reconcileAccount, accountName)).font(.headline).accessibilityAddTraits(.isHeader)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel(Text(ReconcileWords.closeKeepTicks))
            }
        }
        .task { await model.load() }
    }

    // Words and a lock symbol on its tint, never colour alone
    private var lockNote: some View {
        Label(ReconcileWords.lockNote, systemImage: "lock.fill").font(.footnote)
            .foregroundColor(NativeReconcileTokens.attention)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(NativeReconcileTokens.attention.opacity(0.1)))
    }

    // The lock needs a zero difference, so the record's amount is both
    private var summary: ReconcileSummary? {
        model.state.read?.record.map { ReconcileSummary(statement: $0.amount, cleared: $0.amount, difference: 0) }
    }

    private func partnersLine(_ preview: ReconcileLockPreview) -> String {
        let legs = preview.partners.map { partner in
            "\(partner.account ?? "") \(amount(partner.amount)) (\(Dates.short(partner.date)))"
        }
        return legs.joined(separator: " · ") + ". " + String(format: ReconcileWords.onlyThisAccount, accountName)
    }

    private func recordLine(_ record: ReconcileLockPreview.Record) -> String {
        let when = Date(timeIntervalSince1970: record.enteredAt / 1000).formatted(date: .omitted, time: .shortened)
        let source =
            switch record.source {
            case "bank-sync": provider.map { String(format: ReconcileWords.fromProviderShort, $0) } ?? ReconcileWords.fromBankShort
            case "cleared": ReconcileWords.fromClearedShort
            default: ReconcileWords.enteredShort
            }
        return String(format: ReconcileWords.recordLine, amount(record.amount), source, when)
    }
}

// MARK: Done

struct ReconcileDoneView: View {
    @ObservedObject var model: ReconcileLockViewModel
    let style: BudgetAmountStyle
    let accountName: String
    let next: ReconcileMonth.Account?
    let open: (String) -> Void
    let checklist: () -> Void
    let close: () -> Void
    let review: () -> Void

    private var verified: Bool { model.result?.verified ?? true }
    private var lockedCount: Int { model.state.read?.count ?? 0 }

    var body: some View {
        // Scrolls, so nothing truncates at accessibility sizes
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: verified ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.system(size: 56)).foregroundColor(verified ? NativeReconcileTokens.accent : NativeReconcileTokens.attention)
                    .accessibilityHidden(true)
                    .padding(.top, 80)
                Text(title).font(.title2.weight(.bold)).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding()
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                if verified {
                    if let next { ReconcilePrimaryButton(title: String(format: ReconcileWords.nextAccount, next.name)) { open(next.id) } }
                } else {
                    ReconcilePrimaryButton(title: String(format: ReconcileWords.reviewAccount, accountName), action: review)
                }
                Button(action: checklist) {
                    Text(ReconcileWords.backToChecklist).fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.center)
                }
                .font(.headline).frame(minHeight: 44)
            }
            .padding()
            .background(NativeReconcileTokens.background)
        }
        .background(NativeReconcileTokens.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: close) { Image(systemName: "checkmark") }.accessibilityLabel(Text(ReconcileWords.close))
            }
        }
        .onAppear {
            UIAccessibility.post(notification: .announcement, argument: verified ? title : title + ". " + String(format: ReconcileWords.reviewAccount, accountName))
        }
    }

    private var title: String {
        verified ? String(format: ReconcileWords.isReconciled, accountName) : ReconcileWords.balanceMoved
    }

    private var detail: String {
        let statement = model.state.read?.record.map { BudgetAmountFormat.string($0.amount, style: style) } ?? ""
        return verified
            ? String(format: ReconcileWords.reconciledDetail, statement, lockedCount)
            : String(format: ReconcileWords.balanceMovedDetail, lockedCount, statement)
    }
}

extension Dates {
    static func todayLong() -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        return formatter.string(from: Date())
    }
}

extension ReconcileWords {
    static let resolve = NSLocalizedString("Resolve difference", comment: "Native Reconcile: step 3 name")
    static let lockStep = NSLocalizedString("Lock", comment: "Native Reconcile: step 4 name")
    static let likely = NSLocalizedString("Likely the missing one", comment: "Native Reconcile: step 3 matches")
    static let sameAmount = NSLocalizedString("Same amount, not cleared", comment: "Native Reconcile: a single match")
    static let twoRows = NSLocalizedString("Two rows that add up to it", comment: "Native Reconcile: a pair match")
    static let untickDetail = NSLocalizedString("Cleared, the opposite amount", comment: "Native Reconcile: an untick match")
    static let tickIt = NSLocalizedString("Tick it ✓", comment: "Native Reconcile: tick a match")
    static let untickIt = NSLocalizedString(
        "Untick it — this cleared row may not be on your statement", comment: "Native Reconcile: untick a match")
    static let otherWays = NSLocalizedString("Other ways to find it", comment: "Native Reconcile: step 3 section")
    static let searchFor = NSLocalizedString("Search for %@", comment: "Native Reconcile: search for the difference")
    static let swappedDigits = NSLocalizedString(
        "Also finds amounts with two digits swapped", comment: "Native Reconcile: search detail")
    static let addMissing = NSLocalizedString("Add the missing transaction", comment: "Native Reconcile: open the add form")
    static let addMissingDetail = NSLocalizedString(
        "Opens Add with %@ and this account filled in", comment: "Native Reconcile: add form detail")
    static let backToTick = NSLocalizedString("Back to tick off", comment: "Native Reconcile: back to step 2")
    static let checkAgain = NSLocalizedString("Check the rows again", comment: "Native Reconcile: back to step 2 detail")
    static let cantFind = NSLocalizedString("Can’t find it?", comment: "Native Reconcile: adjustment section")
    static let addAdjustmentOf = NSLocalizedString("Add an adjustment of %@…", comment: "Native Reconcile: open the adjustment sheet")
    static let adjustmentDetail = NSLocalizedString(
        "Adds one transaction so Cleared matches. You’ll confirm it first.", comment: "Native Reconcile: adjustment detail")
    static let differenceZero = NSLocalizedString("Difference zero", comment: "Native Reconcile: VoiceOver at zero")
    static let addAdjustmentTitle = NSLocalizedString("Add adjustment?", comment: "Native Reconcile: adjustment sheet title")
    static let payee = NSLocalizedString("Payee", comment: "Native Reconcile: adjustment sheet field")
    static let date = NSLocalizedString("Date", comment: "Native Reconcile: adjustment sheet field")
    static let today = NSLocalizedString("Today, %@", comment: "Native Reconcile: the adjustment's date")
    static let category = NSLocalizedString("Category", comment: "Native Reconcile: adjustment sheet field")
    static let noCategory = NSLocalizedString("None (optional)", comment: "Native Reconcile: no category chosen")
    static let locksInStepFour = NSLocalizedString("Yes — it locks in step 4", comment: "Native Reconcile: the adjustment is cleared")
    static let adjustmentLabel = NSLocalizedString(
        "Reconciliation balance adjustment", comment: "Native Reconcile: the adjustment's notes, as the web app writes them")
    static let budgetChanges = NSLocalizedString(
        "Your budget changes by %@ in the chosen category (or To budget if none). Use this only if you can’t find the real transaction.",
        comment: "Native Reconcile: adjustment budget note")
    static let addSignedAdjustment = NSLocalizedString("Add %@ adjustment", comment: "Native Reconcile: confirm the adjustment")
    static let whatLocks = NSLocalizedString("What locks", comment: "Native Reconcile: step 4 section")
    static let clearedCount = NSLocalizedString("%d cleared transactions", comment: "Native Reconcile: rows that lock")
    static let linkedCount = NSLocalizedString("%d linked transfers (not locked)", comment: "Native Reconcile: transfer partners")
    static let onlyThisAccount = NSLocalizedString(
        "Only %@’s rows lock; the other side stays as it is and the app asks before you edit it.",
        comment: "Native Reconcile: transfer partners note")
    static let balanceOnRecord = NSLocalizedString("Balance on record", comment: "Native Reconcile: the recorded balance")
    static let recordLine = NSLocalizedString("%@ · %@, confirmed by you at %@", comment: "Native Reconcile: amount, source, time")
    static let fromProviderShort = NSLocalizedString("from %@", comment: "Native Reconcile: record source, the provider")
    static let fromBankShort = NSLocalizedString("from your bank balance", comment: "Native Reconcile: record source")
    static let fromClearedShort = NSLocalizedString("from your cleared balance", comment: "Native Reconcile: record source")
    static let enteredShort = NSLocalizedString("entered by you", comment: "Native Reconcile: record source")
    static let removeAdjustment = NSLocalizedString("Remove the adjustment", comment: "Native Reconcile: undo the adjustment")
    static let lockNote = NSLocalizedString(
        "Locked rows can only be unlocked here in the app (open a row › Unlock), never by an assistant. Locking keeps these amounts from changing by accident.",
        comment: "Native Reconcile: the lock note")
    static let lockCount = NSLocalizedString("Lock %d transactions", comment: "Native Reconcile: the lock button")
    static let notNow = NSLocalizedString("Not now — keep my ticks", comment: "Native Reconcile: leave step 4")
    static let isReconciled = NSLocalizedString("%@ is reconciled", comment: "Native Reconcile: done title")
    static let reconciledDetail = NSLocalizedString("At %@ · %d transactions locked", comment: "Native Reconcile: done detail")
    static let nextAccount = NSLocalizedString("Next: %@", comment: "Native Reconcile: reconcile the next due account")
    static let backToChecklist = NSLocalizedString("Back to checklist", comment: "Native Reconcile: done")
    static let balanceMoved = NSLocalizedString("Locked, but the balance moved", comment: "Native Reconcile: unverified lock title")
    static let balanceMovedDetail = NSLocalizedString(
        "%d transactions are locked. A cleared transaction changed while locking, so Cleared no longer matches %@. Review the account; the reconciled date was not updated.",
        comment: "Native Reconcile: unverified lock detail")
    static let reviewAccount = NSLocalizedString("Review %@", comment: "Native Reconcile: open the account register")
}
