import SwiftUI
import UIKit

// Fork-only (sc-3611, native-accounts-screen D7 and D8). One account's
// register, pushed over the Accounts list: the header, Upcoming, then date
// sections newest first, paged on demand. Every number is loot-core's; rows
// change only through the merged native writes, each undoable. A closed
// account's register is read-only.
struct AccountRegisterView: View {
    @ObservedObject var model: AccountRegisterViewModel
    let list: AccountsList?
    let actions: AccountsActions
    let reconcileOn: Bool

    @State private var searchText = ""
    @State private var confirming: RegisterConfirmation?
    @State private var categorizing: Categorizing?
    // sc-4973: an upcoming row's read-only detail
    @State private var upcomingDetail: AccountUpcoming.Row?

    private var account: AccountsList.Account? {
        guard let list else { return nil }
        return (list.sections.onBudget.accounts + list.sections.offBudget.accounts + list.closed.accounts).first { $0.id == model.accountId }
    }

    private var readOnly: Bool { account?.closed ?? true }

    var body: some View {
        content
            .navigationBarTitle(Text(account?.name ?? ""), displayMode: .inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { moreMenu } }
            // Always shown: it is the way to the scope chips (task 3.6, frame 27:201)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(RegisterWords.searchPrompt))
            .onChange(of: searchText) { text in Task { await model.setSearch(text) } }
            .refreshable { await model.refresh() }
            .task { if case .loading = model.state { await model.load() } }
            .safeAreaInset(edge: .bottom) {
                UndoBar(offer: model.undoOffer, isWorking: model.writes.isWorking) { Task { await model.undo() } }
            }
            .alert(model.actionError?.message ?? "", isPresented: isErrorShown) { Button(AccountsWords.ok, role: .cancel) {} }
            .onChange(of: model.actionError) { error in
                if let error { UIAccessibility.post(notification: .announcement, argument: error.message) }
            }
            .onChange(of: model.state.error) { error in
                if let error { AccessibilityAnnouncer.post(error.registerMessage) }
            }
            .onChange(of: model.undoOffer) { offer in
                if let offer { UIAccessibility.post(notification: .announcement, argument: AccountsWords.undoText(offer)) }
            }
            .confirmationDialog(confirming?.title ?? "", isPresented: isConfirming, titleVisibility: .visible, presenting: confirming) { ask in
                Button(ask.action, role: ask.isDelete ? .destructive : nil) { confirmed(ask) }
                Button(RegisterWords.cancel, role: .cancel) {}
            } message: { ask in
                Text(ask.message)
            }
            // loot-core refused for a reconciled row the screen could not see: ask, then resend
            .background(
                Color.clear.confirmationDialog(
                    RegisterWords.reconciledInvolvedTitle, isPresented: isRetryAsked, titleVisibility: .visible,
                    presenting: model.confirmationNeeded
                ) { retry in
                    Button(retryAction(retry), role: retry.isDelete ? .destructive : nil) { Task { await model.confirmRetry() } }
                    Button(RegisterWords.cancel, role: .cancel) { model.cancelRetry() }
                } message: { _ in
                    Text(RegisterWords.reconciledInvolved)
                })
            .sheet(item: $upcomingDetail) { row in
                UpcomingRowDetail(
                    row: row, accountName: account?.name ?? "", style: model.state.value?.first.amountStyle,
                    isUpdating: model.upcoming.isUpdating)
            }
            .sheet(item: $categorizing) { item in
                CategoryPicker(model: model, currentId: item.row.categoryId) { category in
                    categorizing = nil
                    Task { await model.categorize(item.row, category: category, confirmed: item.confirmed) }
                }
            }
    }

    private var isRetryAsked: Binding<Bool> {
        Binding(get: { model.confirmationNeeded != nil }, set: { if !$0 { model.cancelRetry() } })
    }

    private func retryAction(_ retry: RegisterRetry) -> String {
        retry.isDelete ? RegisterWords.delete : RegisterWords.changeCategory
    }

    private var isErrorShown: Binding<Bool> {
        Binding(get: { model.actionError != nil }, set: { if !$0 { model.clearActionError() } })
    }

    private var isConfirming: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })
    }

    // D7: Reconcile (native); Account settings and Sync now hand off to the web until sc-4385
    private var moreMenu: some View {
        Menu {
            if !readOnly {
                if reconcileOn {
                    Button { actions.reconcile(model.accountId) } label: { Label(AccountsWords.reconcile, systemImage: "checkmark.seal") }
                }
                Button { actions.handOff("account-settings", model.accountId) } label: {
                    Label(RegisterWords.accountSettings, systemImage: "gearshape")
                }
                if account?.bankSync == true {
                    Button { actions.handOff("bank-sync", model.accountId) } label: {
                        Label(RegisterWords.syncNow, systemImage: "arrow.triangle.2.circlepath")
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(Text(RegisterWords.more))
        .disabled(readOnly)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            RegisterList(content: .placeholder, model: model, search: "", rowActions: { _ in .none }, actions: rowHandlers)
                .redacted(reason: .placeholder)
                .disabled(true)
                // Each made-up row is hidden from VoiceOver (hiddenWhilePlaceholder), with one
                // "Loading" element in their place (sc-3611 task 3.6)
                .overlay { Color.clear.accessibilityElement().accessibilityLabel(Text(RegisterWords.loading)) }
        case .loaded(let content):
            RegisterList(
                content: content, model: model, search: model.search, rowActions: rowActions, actions: rowHandlers,
                clearingFor: account?.clearingFor, openUpcoming: { upcomingDetail = $0 })
        case .stale(let content, let error):
            RegisterList(
                content: content, model: model, search: model.search, rowActions: rowActions, actions: rowHandlers,
                clearingFor: account?.clearingFor, staleError: error, openUpcoming: { upcomingDetail = $0 })
        case .failed(let error):
            VStack(spacing: 12) {
                Text(verbatim: error.registerMessage).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Button(AccountsWords.retry) { Task { await model.load() } }.buttonStyle(.borderedProminent)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func rowActions(_ row: AccountRegister.Row) -> RegisterRowActions {
        let transfer = row.transferAccount.flatMap { partner in
            list.flatMap { list in
                (list.sections.onBudget.accounts + list.sections.offBudget.accounts + list.closed.accounts).first { $0.id == partner.id }
            }
        }
        return RegisterRowActions(
            row, accountOffBudget: account?.offbudget ?? true, transferOffBudget: transfer.map(\.offbudget), readOnly: readOnly)
    }

    private var rowHandlers: RegisterRowHandlers {
        RegisterRowHandlers(
            open: { actions.navigate("/transactions/\($0.id)") },
            toggleCleared: { row in
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                Task { await model.setCleared(row, !row.cleared) }
            },
            categorize: { row in
                if rowActions(row).asksFirst {
                    confirming = RegisterConfirmation(row: row, kind: .categorize)
                } else {
                    categorizing = Categorizing(row: row, confirmed: false)
                }
            },
            delete: { row in
                if rowActions(row).asksFirst || row.transferAccount != nil {
                    confirming = RegisterConfirmation(row: row, kind: .delete)
                } else {
                    Task { await model.delete(row, confirmed: false) }
                }
            })
    }

    private func confirmed(_ ask: RegisterConfirmation) {
        let reconciled = rowActions(ask.row).asksFirst
        switch ask.kind {
        case .categorize: categorizing = Categorizing(row: ask.row, confirmed: reconciled)
        case .delete: Task { await model.delete(ask.row, confirmed: reconciled) }
        }
    }
}

struct RegisterRowHandlers {
    let open: (AccountRegister.Row) -> Void
    let toggleCleared: (AccountRegister.Row) -> Void
    let categorize: (AccountRegister.Row) -> Void
    let delete: (AccountRegister.Row) -> Void
}

private struct Categorizing: Identifiable {
    let row: AccountRegister.Row
    // The person agreed to change a reconciled row
    let confirmed: Bool
    var id: String { row.id }
}

// Asked before a change to a reconciled row or a transfer (D7, spec)
private struct RegisterConfirmation: Identifiable {
    enum Kind { case categorize, delete }

    let row: AccountRegister.Row
    let kind: Kind
    var id: String { row.id }
    var isDelete: Bool { kind == .delete }

    private var reconciled: Bool { row.reconciled || row.transferReconciled == true }

    var title: String {
        switch kind {
        case .delete: row.transferAccount != nil ? RegisterWords.deleteTransferTitle : RegisterWords.deleteTitle
        case .categorize: RegisterWords.categorizeReconciledTitle
        }
    }

    var message: String {
        var parts: [String] = []
        if reconciled { parts.append(RegisterWords.isReconciled) }
        if kind == .delete, let partner = row.transferAccount { parts.append(String(format: RegisterWords.partnerDeleted, partner.name)) }
        return parts.joined(separator: " ")
    }

    var action: String { kind == .delete ? RegisterWords.delete : RegisterWords.changeCategory }
}

private extension RegisterRetry {
    var isDelete: Bool {
        if case .delete = self { return true }
        return false
    }
}

private extension RegisterRowActions {
    static let none = RegisterRowActions(canClear: false, canCategorize: false, canDelete: false, asksFirst: false)
}

private struct RegisterList: View {
    let content: AccountRegisterContent
    @ObservedObject var model: AccountRegisterViewModel
    let search: String
    let rowActions: (AccountRegister.Row) -> RegisterRowActions
    let actions: RegisterRowHandlers
    var clearingFor: String?
    var staleError: AccountsLoadError?
    var openUpcoming: (AccountUpcoming.Row) -> Void = { _ in }
    @Environment(\.isSearching) private var isSearching

    private var style: BudgetAmountStyle { content.first.amountStyle }

    var body: some View {
        List {
            Group {
            if let staleError {
                Text(verbatim: staleError.registerMessage).foregroundColor(Money.warning).font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isSearching { chips }
            if !isSearching, search.isEmpty, let header = content.header {
                Section { RegisterHeader(header: header, style: style, clearingFor: clearingFor) }
            }
            if let results, results.count > 0 {
                Text(AccountsCountWords.results(results.count)).font(.headline).listRowBackground(Color.clear)
                    .accessibilityAddTraits(.isHeader)
            }
            // sc-4973: above the posted rows, kept while filtered (unlike the web)
            UpcomingSectionView(
                section: model.upcoming, filtered: !search.isEmpty || model.scope != .all, style: style,
                retry: { Task { await model.retryUpcoming() } }, open: openUpcoming)
            if content.rows.isEmpty {
                Text(
                    RegisterEmptyWords.text(
                        search: search, scope: model.scope, upcomingShown: !(model.upcoming.read?.upcoming.isEmpty ?? true)))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            ForEach(RegisterDay.days(of: content.rows)) { day in
                Section(header: sectionTitle(RegisterDay.title(day.date))) {
                    ForEach(day.rows) { row in
                        RegisterRow(row: row, style: style, allowed: rowActions(row), actions: actions)
                            .onAppear { if row.id == content.rows.last?.id { Task { await model.loadMore() } } }
                    }
                }
            }
            if model.hasMore {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                    .accessibilityLabel(Text(RegisterWords.loadingMore))
            }
            // The search footer: loot-core's total over every page (D1), never summed here
            if let results, results.count > 0 {
                LabelledAmount(label: RegisterWords.resultsTotal, amount: BudgetAmountFormat.string(results.total, style: style))
                    .font(.footnote).foregroundColor(.secondary).listRowBackground(Color.clear)
            }
            }
            .hiddenWhilePlaceholder()
        }
        .listStyle(.insetGrouped)
        // Cancel (the field closing) restores the whole register, scope included
        .onChange(of: isSearching) { searching in
            if !searching { Task { await model.cancelSearch() } }
        }
    }

    private var results: RegisterResults? { content.results(search: search, scope: model.scope) }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.headline).foregroundColor(.primary).textCase(nil).accessibilityAddTraits(.isHeader)
    }

    private func signed(_ amount: Int) -> String { (amount > 0 ? "+" : "") + BudgetAmountFormat.string(amount, style: style) }

    // D7: All, Uncleared, Uncategorized
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(.all, RegisterWords.all)
                chip(.uncleared, RegisterWords.uncleared)
                chip(.uncategorized, RegisterWords.uncategorized)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    private func chip(_ scope: AccountRegisterScope, _ title: String) -> some View {
        let selected = model.scope == scope
        return Button { Task { await model.setScope(scope) } } label: {
            Text(title).font(.subheadline.weight(.medium)).padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundColor(selected ? NativeReconcileTokens.onAccent : .primary)
                .background(Capsule().fill(selected ? NativeReconcileTokens.accent : Color(.tertiarySystemFill)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// sc-4973 (native-register-upcoming-rows): the upcoming rows as they will
// post, from native/account-upcoming. While a re-read runs the old rows stay at
// the same height, dimmed and marked Updating, so the posted rows never move.
private struct UpcomingSectionView: View {
    let section: UpcomingSection
    let filtered: Bool
    let style: BudgetAmountStyle
    let retry: () -> Void
    let open: (AccountUpcoming.Row) -> Void

    var body: some View {
        switch section {
        case .loading:
            Section(header: title) {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(UpcomingWords.loading).foregroundColor(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        case .failed:
            Section(header: title) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(UpcomingWords.failed).fixedSize(horizontal: false, vertical: true)
                    Button(AccountsWords.retry, action: retry)
                }
            }
        case .loaded(let read), .updating(let read):
            if !read.upcoming.isEmpty || read.upcomingMore == true || read.upcomingCapDays != nil {
                rows(read, updating: section.isUpdating)
            }
        }
    }

    private var title: some View { heading(RegisterWords.upcoming) }

    private func heading(_ text: String) -> some View {
        Text(text).font(.headline).foregroundColor(.primary).textCase(nil).accessibilityAddTraits(.isHeader)
    }

    private func rows(_ read: AccountUpcoming, updating: Bool) -> some View {
        Section(
            header: heading(updating ? "\(RegisterWords.upcoming) · \(UpcomingWords.updating)" : RegisterWords.upcoming),
            footer: notices(read)
        ) {
            ForEach(read.upcoming) { row in
                Button { open(row) } label: {
                    NativeTransactionRow(
                        payee: UpcomingRowText.payee(row), category: UpcomingRowText.detail(row), date: row.date,
                        amount: UpcomingRowText.amount(row, style: style), isIncome: row.amount > 0, status: .scheduled, style: .register)
                }
                .foregroundColor(.primary)
                .opacity(updating ? 0.45 : 1)
                .accessibilityHint(updating ? Text(UpcomingWords.updating) : Text(""))
            }
            // loot-core's count and total, apart from the posted results; never summed here
            VStack(alignment: .leading, spacing: 2) {
                Text(UpcomingWords.summary(read, filtered: filtered)).font(.subheadline)
                LabelledAmount(label: UpcomingWords.totalLabel(read), amount: BudgetAmountFormat.string(read.upcomingTotal, style: style))
                    .font(.footnote).foregroundColor(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .opacity(updating ? 0.45 : 1)
            .accessibilityElement(children: .combine)
            .accessibilityValue(updating ? Text(UpcomingWords.updating) : Text(""))
        }
        .onChange(of: updating) { isUpdating in
            if isUpdating { UIAccessibility.post(notification: .announcement, argument: UpcomingWords.updating) }
        }
    }

    @ViewBuilder private func notices(_ read: AccountUpcoming) -> some View {
        let lines = [UpcomingWords.capNotice(read), UpcomingWords.moreNotice(read)].compactMap { $0 }
        if !lines.isEmpty {
            Text(lines.joined(separator: "\n")).fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum UpcomingRowText {
    static func payee(_ row: AccountUpcoming.Row) -> String { UpcomingWords.payee(row) }

    // As posted rows read: the split count, the transfer's other account, or the category
    static func detail(_ row: AccountUpcoming.Row) -> String? {
        if row.splitCount > 0 { return String(format: RegisterWords.split, row.splitCount) }
        if let transfer = row.transferAccount, row.category == nil { return String(format: RegisterWords.transfer, transfer.name) }
        return row.category
    }

    static func amount(_ row: AccountUpcoming.Row, style: BudgetAmountStyle) -> String {
        (row.amount > 0 ? "+" : "") + BudgetAmountFormat.string(row.amount, style: style)
    }
}

// D5a: read-only, no edit and no web hand-off (schedule editing is story 4617)
private struct UpcomingRowDetail: View {
    let row: AccountUpcoming.Row
    let accountName: String
    let style: BudgetAmountStyle?
    let isUpdating: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        NavigationView {
            List {
                Section {
                    Text(isUpdating ? "\(UpcomingWords.scheduled) · \(UpcomingWords.updating)" : UpcomingWords.scheduled)
                        .font(.headline)
                    line(RegisterWords.detailDate, Dates.short(row.date))
                    line(RegisterWords.detailPayee, UpcomingRowText.payee(row))
                    line(RegisterWords.detailCategory, UpcomingRowText.detail(row) ?? RegisterWords.uncategorized)
                    line(RegisterWords.detailAmount, style.map { UpcomingRowText.amount(row, style: $0) } ?? "", isAmount: true)
                    line(RegisterWords.detailAccount, accountName)
                    if let notes = row.notes, !notes.isEmpty { line(RegisterWords.detailNotes, notes) }
                }
                if let fields = UpcomingWords.ruleFields(row.ruleFields) {
                    Section { Text(fields).fixedSize(horizontal: false, vertical: true) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationBarTitle(Text(UpcomingWords.scheduled), displayMode: .inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(RegisterWords.done) { dismiss() } } }
        }
        .tint(Color(NativeTabBarController.accent))
    }

    // At accessibility sizes the value goes under its label, whole, so no word breaks
    @ViewBuilder private func line(_ label: String, _ value: String, isAmount: Bool = false) -> some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundColor(.secondary)
                    valueText(value, isAmount: isAmount)
                }
            } else {
                HStack(alignment: .top) {
                    Text(label).foregroundColor(.secondary)
                    Spacer(minLength: 12)
                    valueText(value, isAmount: isAmount).multilineTextAlignment(.trailing)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func valueText(_ value: String, isAmount: Bool) -> some View {
        if isAmount {
            Text(value).monospacedDigit().wholeAmount()
        } else {
            Text(value).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// Working balance, then cleared and uncleared, all loot-core's (D7)
private struct RegisterHeader: View {
    let header: AccountRegister.Header
    let style: BudgetAmountStyle
    let clearingFor: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(RegisterWords.workingBalance).font(.subheadline).foregroundColor(.secondary)
            Text(BudgetAmountFormat.string(header.balance, style: style))
                .font(.largeTitle.bold().monospacedDigit())
                .foregroundColor(header.balance < 0 ? Money.negative : .primary)
                .oneLineAmount()
            // At the accessibility sizes each label sits above its whole amount
            Group {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 6) {
                        LabelledAmount(label: RegisterWords.clearedLabel, amount: BudgetAmountFormat.string(header.cleared, style: style))
                        LabelledAmount(label: RegisterWords.unclearedLabel, amount: BudgetAmountFormat.string(header.uncleared, style: style))
                    }
                } else {
                    Text(
                        String(
                            format: RegisterWords.clearedUncleared, BudgetAmountFormat.string(header.cleared, style: style),
                            BudgetAmountFormat.string(header.uncleared, style: style))
                    )
                    .oneLineAmount()
                }
            }
            .font(.footnote.monospacedDigit()).foregroundColor(.secondary)
            if let clearingFor {
                Text(AccountsWords.detail(.clearing(paycheck: clearingFor), style: style)).font(.footnote).foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .hiddenWhilePlaceholder()
    }
}

// A row: tap opens the web editor (until sc-3602); leading swipe clears, trailing
// deletes, long-press categorizes. VoiceOver offers the same as actions.
private struct RegisterRow: View {
    let row: AccountRegister.Row
    let style: BudgetAmountStyle
    let allowed: RegisterRowActions
    let actions: RegisterRowHandlers

    var body: some View {
        Button { actions.open(row) } label: {
            NativeTransactionRow(
                payee: [row.payee, row.transferAccount?.name, row.notes].compactMap { $0 }.first { !$0.isEmpty } ?? RegisterWords.noPayee,
                category: category, date: row.date,
                amount: (row.amount > 0 ? "+" : "") + BudgetAmountFormat.string(row.amount, style: style), isIncome: row.amount > 0,
                status: status, style: .register)
        }
        .foregroundColor(.primary)
        .swipeActions(edge: .leading) {
            if allowed.canClear {
                Button { actions.toggleCleared(row) } label: {
                    Label(row.cleared ? RegisterWords.unclear : RegisterWords.clear, systemImage: row.cleared ? "circle" : "checkmark.circle")
                }
                .tint(Color(NativeTabBarController.accent))
            }
        }
        .swipeActions(edge: .trailing) {
            if allowed.canDelete {
                Button(role: allowed.asksFirst || row.transferAccount != nil ? nil : .destructive) { actions.delete(row) } label: {
                    Label(RegisterWords.delete, systemImage: "trash")
                }
                .tint(.red)
            }
        }
        .contextMenu {
            if allowed.canCategorize {
                Button { actions.categorize(row) } label: { Label(RegisterWords.categorize, systemImage: "tag") }
            }
            if allowed.canClear {
                Button { actions.toggleCleared(row) } label: { Label(row.cleared ? RegisterWords.unclear : RegisterWords.clear, systemImage: "checkmark.circle") }
            }
            if allowed.canDelete {
                Button(role: .destructive) { actions.delete(row) } label: { Label(RegisterWords.delete, systemImage: "trash") }
            }
        }
        .modifier(OptionalAccessibilityAction(name: row.cleared ? RegisterWords.unclear : RegisterWords.clear, isOn: allowed.canClear) {
            actions.toggleCleared(row)
        })
        .modifier(OptionalAccessibilityAction(name: RegisterWords.categorize, isOn: allowed.canCategorize) { actions.categorize(row) })
        .modifier(OptionalAccessibilityAction(name: RegisterWords.delete, isOn: allowed.canDelete) { actions.delete(row) })
    }

    private var category: String? {
        if row.splitCount > 0 { return String(format: RegisterWords.split, row.splitCount) }
        if let transfer = row.transferAccount, row.category == nil { return String(format: RegisterWords.transfer, transfer.name) }
        return row.category
    }

    private var status: NativeTransactionRow.Status {
        switch RegisterRowStatus(row) {
        case .pending: .notCleared
        case .cleared: .cleared
        case .reconciled: .locked
        }
    }
}

// Long-press › Categorize: the budget's visible categories (D3, from native/budget-month)
private struct CategoryPicker: View {
    @ObservedObject var model: AccountRegisterViewModel
    // The row's category id; nil when it has none
    let currentId: String?
    // nil clears the category, which loot-core allows wherever Categorize is offered
    let pick: (String?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Group {
                if let groups = model.categoryGroups {
                    List {
                        Section {
                            choice(RegisterWords.uncategorized, isCurrent: currentId == nil) { pick(nil) }
                        }
                        ForEach(groups) { group in
                            Section(header: Text(group.name)) {
                                ForEach(group.categories) { category in
                                    choice(category.name, isCurrent: category.id == currentId) { pick(category.id) }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                } else if model.categoriesFailed {
                    VStack(spacing: 12) {
                        Text(RegisterWords.categoriesFailed).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                        Button(AccountsWords.retry) { Task { await load() } }.buttonStyle(.borderedProminent)
                    }
                    .padding()
                } else {
                    ProgressView().accessibilityLabel(Text(RegisterWords.loading))
                }
            }
            .navigationBarTitle(Text(RegisterWords.categorize), displayMode: .inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(RegisterWords.cancel) { dismiss() } } }
        }
        .tint(Color(NativeTabBarController.accent))
        .task { await load() }
    }

    private func load() async { await model.loadCategories(month: NativeBridgeBenchmark.currentMonth()) }

    private func choice(_ name: String, isCurrent: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(name).foregroundColor(.primary)
                Spacer()
                if isCurrent {
                    Image(systemName: "checkmark").foregroundColor(Color(NativeTabBarController.accent))
                        .accessibilityLabel(Text(RegisterWords.currentCategory))
                }
            }
        }
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}

extension AccountRegister {
    var amountStyle: BudgetAmountStyle {
        BudgetAmountStyle(
            currencyCode: currencyCode, currencySymbol: currencySymbol, decimalPlaces: currencyDecimalPlaces,
            symbolPosition: currencySymbolPosition, symbolSpace: currencySpace, numberFormat: numberFormat,
            hideFraction: hideFraction)
    }
}

extension AccountRegisterContent {
    // The redacted first load's layout
    static let placeholder: AccountRegisterContent = {
        let rows = (0..<8).map { index in
            AccountRegister.Row(
                id: "p\(index)", date: index < 3 ? "2026-01-02" : "2026-01-01", payee: "Placeholder payee", category: "Category",
                categoryId: nil, splitCount: 0, notes: nil, amount: -12_345, cleared: true, reconciled: false, transferAccount: nil,
                transferReconciled: nil, runningBalance: nil)
        }
        let first = AccountRegister(
            currencyCode: "", currencyDecimalPlaces: 2, currencySymbol: "", currencySymbolPosition: .before, currencySpace: false,
            numberFormat: .commaDot, hideFraction: false, rows: rows, nextCursor: nil,
            header: AccountRegister.Header(balance: 1_234_567, cleared: 1_234_567, uncleared: 0), upcoming: nil, resultCount: nil,
            resultTotal: nil)
        return AccountRegisterContent(first: first, rows: rows, nextCursor: nil, pages: 1)
    }()
}

enum RegisterWords {
    static let clearedLabel = NSLocalizedString("Cleared", comment: "Native Accounts register: header, above the amount at large text")
    static let unclearedLabel = NSLocalizedString("Uncleared", comment: "Native Accounts register: header, above the amount at large text")
    static let categoriesFailed = NSLocalizedString(
        "The categories could not be loaded.", comment: "Native Accounts register: category picker read failed")
    static let reconciledInvolvedTitle = NSLocalizedString(
        "Change a reconciled transaction?", comment: "Native Accounts register: loot-core asked for a confirmation")
    static let reconciledInvolved = NSLocalizedString(
        "A reconciled transaction is part of this change, so the reconciled balance changes too.",
        comment: "Native Accounts register: loot-core asked for a confirmation")
    static let resultsTotal = NSLocalizedString("Total of results: ", comment: "Native Accounts register: search footer, before the total")
    static let noPayee = NSLocalizedString("No payee", comment: "Native Accounts register: a row without a payee")
    static let searchPrompt = NSLocalizedString("Search payee, category, notes", comment: "Native Accounts register: search field")
    static let loading = NSLocalizedString("Loading", comment: "Native Accounts register: VoiceOver while loading")
    static let loadingMore = NSLocalizedString("Loading more transactions", comment: "Native Accounts register: next page")
    static let more = NSLocalizedString("More", comment: "Native Accounts register: the ••• menu")
    static let accountSettings = NSLocalizedString("Account settings", comment: "Native Accounts register: web hand-off")
    static let syncNow = NSLocalizedString("Sync now", comment: "Native Accounts register: bank sync, web hand-off")
    static let workingBalance = NSLocalizedString("Working balance", comment: "Native Accounts register: header")
    static let clearedUncleared = NSLocalizedString("Cleared %1$@ · Uncleared %2$@", comment: "Native Accounts register: header")
    static let upcoming = NSLocalizedString("Upcoming", comment: "Native Accounts register: scheduled transactions section")
    static let done = NSLocalizedString("Done", comment: "Native Accounts register: close the scheduled row detail")
    static let detailDate = NSLocalizedString("Date", comment: "Native Accounts register: scheduled row detail")
    static let detailPayee = NSLocalizedString("Payee", comment: "Native Accounts register: scheduled row detail")
    static let detailCategory = NSLocalizedString("Category", comment: "Native Accounts register: scheduled row detail")
    static let detailAmount = NSLocalizedString("Amount", comment: "Native Accounts register: scheduled row detail")
    static let detailAccount = NSLocalizedString("Account", comment: "Native Accounts register: scheduled row detail")
    static let detailNotes = NSLocalizedString("Notes", comment: "Native Accounts register: scheduled row detail")
    static let all = NSLocalizedString("All", comment: "Native Accounts register: scope chip")
    static let uncleared = NSLocalizedString("Uncleared", comment: "Native Accounts register: scope chip")
    static let uncategorized = NSLocalizedString("Uncategorized", comment: "Native Accounts register: scope chip")
    static let clear = NSLocalizedString("Clear", comment: "Native Accounts register: mark cleared")
    static let unclear = NSLocalizedString("Unclear", comment: "Native Accounts register: mark not cleared")
    static let categorize = NSLocalizedString("Categorize", comment: "Native Accounts register: change the category")
    static let delete = NSLocalizedString("Delete", comment: "Native Accounts register: delete a transaction")
    static let cancel = NSLocalizedString("Cancel", comment: "Native Accounts register: cancel")
    static let changeCategory = NSLocalizedString("Change category", comment: "Native Accounts register: confirm categorizing")
    static let split = NSLocalizedString("Split (%d)", comment: "Native Accounts register: a split transaction")
    static let transfer = NSLocalizedString("Transfer · %@", comment: "Native Accounts register: a transfer's other account")
    static let currentCategory = NSLocalizedString("Current category", comment: "Native Accounts register: VoiceOver on the checkmark")
    static let deleteTitle = NSLocalizedString("Delete this transaction?", comment: "Native Accounts register: delete confirmation")
    static let deleteTransferTitle = NSLocalizedString("Delete this transfer?", comment: "Native Accounts register: delete confirmation")
    static let categorizeReconciledTitle = NSLocalizedString(
        "Change a reconciled transaction?", comment: "Native Accounts register: categorize confirmation")
    static let isReconciled = NSLocalizedString(
        "It is reconciled, so the reconciled balance changes too.", comment: "Native Accounts register: confirmation message")
    static let partnerDeleted = NSLocalizedString(
        "The %@ row is deleted too.", comment: "Native Accounts register: deleting a transfer deletes its other side")
}
