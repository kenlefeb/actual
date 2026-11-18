import Combine
import SwiftUI
import UIKit

// Fork-only (sc-4931, sc-3611; native-accounts-screen D4 to D8). The native
// Accounts screen's host: NativeTabBarController lays it over the web Accounts
// screens while the switch is on. One screen serves `/accounts` (the list) and
// `/accounts/<id>` (a register pushed over it). It steps aside, keeping its
// place, while the web shows, and re-reads when the page comes back. It stays
// hidden until loot-core has answered and knows the account. The switch is off
// by default until task 3.8; developers set the UserDefaults key
// `NativeScreen.accounts` (NativeScreenSwitch.accountsKey) to true.
final class NativeAccountsViewController: UIHostingController<AccountsScreen> {
    private(set) var route: NativeAccountsRoute?
    private let model: AccountsListViewModel
    private let nav: AccountsNavigation
    private let reconcileMonth: ReconcileMonthViewModel
    private let client: NativeBridgeClient
    private let chrome: NativeChromePlugin
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var stateObserver: AnyCancellable?
    private var hasShown = false

    init(client: NativeBridgeClient, chrome: NativeChromePlugin, syncStatus: NativeSyncStatus, presentReconcile: @escaping (Any) -> Void) {
        self.client = client
        self.chrome = chrome
        let model = AccountsListViewModel(client: client)
        model.syncStatus = syncStatus
        self.model = model
        let nav = AccountsNavigation()
        self.nav = nav
        reconcileMonth = ReconcileMonthViewModel(client: client)
        weak var host: NativeAccountsViewController?
        let actions = AccountsActions(
            navigate: { [weak chrome] in chrome?.navigate(to: $0) },
            handOff: { host?.handOff($0, accountId: $1) },
            openRegister: { host?.openRegister($0) },
            closeRegister: { host?.closeRegister() },
            // sc-4801: the flow is native only while its own switch is on, as the page's message
            reconcile: { id in
                guard NativeScreenSwitch.isReconcileNative() else { return }
                presentReconcile(id.map { ["type": "presentReconcile", "account_id": $0] } ?? ["type": "presentReconcile", "checklist": true])
            })
        super.init(rootView: AccountsScreen(model: model, nav: nav, reconcileMonth: reconcileMonth, actions: actions))
        host = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The page's route, or nil while the web screen should show
    func show(_ route: NativeAccountsRoute?) {
        let returning = self.route == nil && hasShown
        self.route = route
        guard let route else {
            model.leave()
            nav.register?.leave()
            updateVisibility()
            return
        }
        hasShown = true
        switch route {
        case .list: nav.register = nil
        case .register(let id): openRegister(id, fromPage: true)
        }
        updateVisibility()
        // Back from the web (the editor, a sheet): the visible view reads again
        if returning {
            Task {
                await model.load()
                await nav.register?.reload()
            }
        }
    }

    // A page event (NativeBridgePlugin.onPaychecksEvent): "ready" is the page back after a refused call
    func eventReceived(_ event: String, tables: [String]) {
        if event == "ready" {
            Task {
                await model.pageReady()
                await nav.register?.pageReady()
            }
        } else {
            model.eventReceived(event, tables: tables)
            nav.register?.eventReceived(event, tables: tables)
            reconcileMonth.eventReceived(event, tables: tables)
        }
    }

    // loot-core's sync outcome, as NativeBridgePlugin follows it
    func syncStatusChanged(_ status: NativeSyncStatus) { model.syncStatus = status }

    // sc-5219: whether a change is still being stored on this device
    func writePendingChanged(_ isPending: Bool) { model.isWritePending = isPending }

    // The closed set of web flows (D7a); an action or account it does not allow is dropped
    func handOff(_ action: String, accountId: String? = nil) {
        guard let list = model.state.value,
              let hand = try? WebAccountAction(action, accountId: accountId, openAccountIds: NativeAccountsRoute.openAccountIds(in: list))
        else { return }
        chrome.handOff(hand)
    }

    // Pushes the register at once and tells the page, which reports the route back
    private func openRegister(_ id: String, fromPage: Bool = false) {
        if nav.register?.accountId != id {
            nav.register = AccountRegisterViewModel(client: client, accountId: id)
        }
        if !fromPage { chrome.navigate(to: "/accounts/\(id)") }
    }

    // The register's back button: the list, here and on the page
    private func closeRegister() {
        guard nav.register != nil else { return }
        nav.register?.leave()
        nav.register = nil
        chrome.navigate(to: "/accounts")
    }

    private func updateVisibility() {
        guard let route else {
            view.isHidden = true
            return
        }
        view.isHidden = !route.showsNative(model.state)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
        UIView.appearance(whenContainedInInstancesOf: [UIAlertController.self]).tintColor = NativeTabBarController.accent
        view.isHidden = true
        stateObserver = model.$state.sink { [weak self] _ in
            DispatchQueue.main.async { self?.updateVisibility() }
        }
        let center = NotificationCenter.default
        for (name, active) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
            lifecycleObservers.append(
                center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    guard let self else { return }
                    let register = self.nav.register
                    Task {
                        await self.model.setSceneActive(active)
                        await register?.setSceneActive(active)
                    }
                })
        }
        Task {
            await model.load()
            if NativeScreenSwitch.isReconcileNative() { await reconcileMonth.load() }
        }
    }

    deinit { lifecycleObservers.forEach(NotificationCenter.default.removeObserver) }
}

// Which register is pushed over the list (D5)
@MainActor
final class AccountsNavigation: ObservableObject {
    @Published var register: AccountRegisterViewModel?
}

// What the screens ask of their host
struct AccountsActions {
    let navigate: (String) -> Void
    // A web flow (D7a): the action and, for the account ones, its id
    let handOff: (String, String?) -> Void
    let openRegister: (String) -> Void
    let closeRegister: () -> Void
    // An account's Reconcile flow, or the checklist for nil (D8)
    let reconcile: (String?) -> Void
}

// D7: the list. Every balance and total is loot-core's; Swift formats them.
struct AccountsScreen: View {
    @ObservedObject var model: AccountsListViewModel
    @ObservedObject var nav: AccountsNavigation
    @ObservedObject var reconcileMonth: ReconcileMonthViewModel
    let actions: AccountsActions
    // Owned here and handed to the list: a toolbar EditButton's own edit mode
    // never reached the List (sc-3611 hands-on pass)
    @State private var editMode: EditMode = .inactive
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationView {
            content
                .environment(\.editMode, $editMode)
                .navigationBarTitle(Text(AccountsWords.title), displayMode: .large)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        if let list = model.state.value, !list.sections.onBudget.accounts.isEmpty || !list.sections.offBudget.accounts.isEmpty {
                            Button(editMode.isEditing ? AccountsWords.done : AccountsWords.edit) {
                                withAnimation(reduceMotion ? nil : .default) { editMode = editMode.isEditing ? .inactive : .active }
                            }
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) { addMenu }
                }
                .background(registerLink)
        }
        .navigationViewStyle(.stack)
        .tint(Color(NativeTabBarController.accent))
        .safeAreaInset(edge: .bottom) {
            if nav.register == nil { UndoBar(offer: model.undoOffer, isWorking: model.writes.isWorking) { Task { await model.undo() } } }
        }
        .alert(model.actionError?.message ?? "", isPresented: isErrorShown) {
            Button(AccountsWords.ok, role: .cancel) {}
        }
        .onChange(of: model.actionError) { error in
            if let error { AccessibilityAnnouncer.post(error.message) }
        }
        // The register announces its own reads while it is pushed over the list
        // Once per failed read, including a retry that fails the same way
        .onChange(of: model.failureCount) { _ in
            if let error = model.state.error, nav.register == nil { AccessibilityAnnouncer.post(error.message) }
        }
    }

    // The register, pushed by the route (D5); the system back pops it to the list
    private var registerLink: some View {
        NavigationLink(
            isActive: Binding(get: { nav.register != nil }, set: { if !$0 { actions.closeRegister() } }),
            destination: {
                if let register = nav.register {
                    AccountRegisterView(
                        model: register, list: model.state.value, actions: actions,
                        reconcileOn: NativeScreenSwitch.isReconcileNative())
                }
            },
            label: { EmptyView() }
        )
        .hidden()
    }

    private var isErrorShown: Binding<Bool> {
        Binding(get: { model.actionError != nil }, set: { if !$0 { model.clearActionError() } })
    }

    private var addMenu: some View {
        Menu {
            Button { actions.handOff("add-account", nil) } label: { Label(AccountsWords.addAccount, systemImage: "plus") }
            Button { actions.handOff("link-account", nil) } label: { Label(AccountsWords.linkAccount, systemImage: "building.columns") }
        } label: {
            Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(Text(AccountsWords.add))
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            // The real layout, redacted; no spinner and no shimmer (D6)
            AccountsListBody(
                list: .placeholder, status: .syncing, isSyncing: true, staleError: nil, model: model, reconcileMonth: nil, actions: actions,
                isPlaceholder: true
            )
            .redacted(reason: .placeholder)
            .disabled(true)
            // The placeholder rows are made-up names and numbers: each is hidden from VoiceOver
            // (hiddenWhilePlaceholder), with one "Loading accounts" element in their place
            .overlay { Color.clear.accessibilityElement().accessibilityLabel(Text(AccountsWords.loading)) }
        case .loaded(let list):
            loaded(list, staleError: nil)
        case .stale(let list, let error):
            loaded(list, staleError: error)
        case .failed(let error):
            VStack(spacing: 12) {
                Text(verbatim: error.message).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Button(AccountsWords.retry) { Task { await model.load() } }.buttonStyle(.borderedProminent)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private func loaded(_ list: AccountsList, staleError: AccountsLoadError?) -> some View {
        if list.isEmpty {
            AccountsEmpty(status: model.syncStatus, isWritePending: model.isWritePending, staleError: staleError, handOff: actions.handOff) { Task { await model.refresh() } }
        } else {
            AccountsListBody(
                list: list, status: model.syncStatus, isSyncing: model.isSyncing, staleError: staleError, model: model,
                reconcileMonth: NativeScreenSwitch.isReconcileNative() ? reconcileMonth : nil, actions: actions)
        }
    }
}

// The brief Undo after a write, over the tab bar
struct UndoBar: View {
    let offer: AccountsUndoOffer?
    let isWorking: Bool
    let undo: () -> Void

    var body: some View {
        if let offer {
            HStack {
                Text(AccountsWords.undoText(offer)).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(AccountsWords.undo, action: undo)
                    .buttonStyle(.borderedProminent)
                    .disabled(isWorking)
            }
            .padding()
            .background(.regularMaterial)
            // The bar sits outside the screen's tint (a safe-area inset), so it takes the accent itself
            .tint(Color(NativeTabBarController.accent))
        }
    }
}

private struct AccountsListBody: View {
    let list: AccountsList
    let status: NativeSyncStatus
    let isSyncing: Bool
    let staleError: AccountsLoadError?
    @ObservedObject var model: AccountsListViewModel
    // nil while the Reconcile flow's switch is off
    let reconcileMonth: ReconcileMonthViewModel?
    let actions: AccountsActions
    var isPlaceholder = false

    private var hasSubtitle: Bool {
        if staleError != nil || isSyncing { return true }
        if case .unknown = status { return false }
        return true
    }

    @ViewBuilder private var firstRows: some View {
        if let reconcileMonth { ReconcileBanner(month: reconcileMonth) { actions.reconcile(nil) } }
        Button { actions.navigate("/accounts/all") } label: {
            LinkRow { AccountTexts(name: AccountsWords.allAccounts, detail: AccountsWords.allAccountsDetail) }
        }
        .foregroundColor(.primary)
    }

    var body: some View {
        List {
            Group {
            if hasSubtitle {
                Section(header: SyncSubtitle(status: isSyncing && status != .waitingForStorage ? .syncing : status, isWritePending: model.isWritePending, staleError: staleError) { Task { await model.refresh() } }) {
                    firstRows
                }
            } else {
                // No status yet: a header with no words would be an unlabeled element
                Section { firstRows }
            }
            section(.onBudget, title: AccountsWords.onBudget, list.sections.onBudget)
            section(.offBudget, title: AccountsWords.offBudget, list.sections.offBudget)
            if !list.closed.accounts.isEmpty {
                Section {
                    NavigationLink {
                        ClosedAccountsView(model: model, open: actions.openRegister)
                    } label: {
                        AccountTexts(name: AccountsWords.closedAccounts, detail: AccountsCountWords.accounts(list.closed.accounts.count))
                    }
                }
            }
            Section {
                AmountLine(title: AccountsWords.netWorth, amount: list.netWorth, style: list.amountStyle, isHeadline: true)
            }
            }
            .hiddenWhilePlaceholder()
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
    }

    @ViewBuilder private func section(_ which: AccountsListSection, title: String, _ section: AccountsList.Section) -> some View {
        if !section.accounts.isEmpty {
            Section(header: AmountLine(title: title, amount: section.total, style: list.amountStyle, isHeadline: true).textCase(nil).accessibilityHidden(isPlaceholder)) {
                ForEach(section.accounts) { account in
                    Button { actions.openRegister(account.id) } label: {
                        LinkRow { AccountRow(account: account, style: list.amountStyle) }
                    }
                    .foregroundColor(.primary)
                    // D8: long-press opens Reconcile for this account
                    .contextMenu {
                        if reconcileMonth != nil {
                            Button { actions.reconcile(account.id) } label: { Label(AccountsWords.reconcile, systemImage: "checkmark.seal") }
                        }
                    }
                    .modifier(OptionalAccessibilityAction(name: AccountsWords.reconcile, isOn: reconcileMonth != nil) { actions.reconcile(account.id) })
                }
                .onMove { from, to in
                    guard let first = from.first else { return }
                    Task { await model.move(in: which, from: first, to: to) }
                }
            }
        }
    }
}

// D8: "2 accounts to reconcile", collapsing to "November reconciled ✓" once the month is done
private struct ReconcileBanner: View {
    @ObservedObject var month: ReconcileMonthViewModel
    let open: () -> Void

    var body: some View {
        if let read = month.state.read, !read.accounts.isEmpty {
            if month.due.isEmpty {
                Label(String(format: AccountsWords.monthReconciled, Dates.monthName(read.month)), systemImage: "checkmark.circle.fill")
                    .foregroundColor(.secondary)
            } else {
                Button(action: open) {
                    LinkRow {
                        Label(AccountsCountWords.toReconcile(month.due.count), systemImage: "checkmark.seal")
                            .foregroundColor(Color(NativeTabBarController.accent))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

struct OptionalAccessibilityAction: ViewModifier {
    let name: String
    let isOn: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if isOn { content.accessibilityAction(named: Text(name), action) } else { content }
    }
}

// The subtitle under the large title: sync status in words (mobile-sync-status), and a
// failed re-read in place of it. A failure is warning text and a tap retries.
private struct SyncSubtitle: View {
    let status: NativeSyncStatus
    let isWritePending: Bool
    let staleError: AccountsLoadError?
    let retry: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let (text, isWarning) = words(now: context.date)
            Group {
                if isWarning {
                    Button(action: retry) { Text(text).foregroundColor(Money.warning) }
                        .accessibilityHint(Text(AccountsWords.retryHint))
                } else {
                    Text(text).foregroundColor(.secondary)
                }
            }
            .font(.subheadline)
            .textCase(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func words(now: Date) -> (String, Bool) {
        if let staleError { return (staleError.message, true) }
        switch status {
        case .unknown: return ("", false)
        case .syncing: return (AccountsWords.syncing, false)
        case .synced(let date): return (AccountsWords.synced(date, now: now), false)
        case .offline:
            let words = NativeSyncStatus.offlineWords(
                AccountsWords.offline, plain: AccountsWords.offlinePlain, isWritePending: isWritePending,
                storageLineIsOn: WriteStorageLineRollout.isOn)
            return (words, false)
        case .failed: return (AccountsWords.syncFailed, true)
        case .local: return (AccountsWords.localFile, false)
        case .waitingForStorage: return (NativeSyncStatus.waitingMessage, false)
        }
    }
}

// A tappable row with the system chevron, as a NavigationLink draws it
private struct LinkRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack {
            content
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Color(.tertiaryLabel))
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }
}

private struct AccountTexts: View {
    let name: String
    let detail: String?
    var isSecondary = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.body).foregroundColor(isSecondary ? .secondary : .primary)
            if let detail, !detail.isEmpty { Text(detail).font(.subheadline).foregroundColor(.secondary) }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Name and detail, then the signed balance; at accessibility sizes the balance
// moves under the name, whole (D7)
private struct AccountRow: View {
    let account: AccountsList.Account
    let style: BudgetAmountStyle
    var isSecondary = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    texts
                    balance
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    texts
                    Spacer(minLength: 8)
                    balance
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([account.name, amountText, detail].filter { !$0.isEmpty }.joined(separator: ", ")))
        .accessibilityAddTraits(.isButton)
        .hiddenWhilePlaceholder()
    }

    private var texts: some View { AccountTexts(name: account.name, detail: detail, isSecondary: isSecondary) }

    private var amountText: String { BudgetAmountFormat.string(account.balance, style: style) }

    private var balance: some View {
        Text(amountText)
            .font(.body.monospacedDigit())
            .foregroundColor(account.balance < 0 ? Money.negative : .primary)
            .wholeAmount()
    }

    private var detail: String { AccountsWords.detail(AccountDetail(account), style: style) }
}

// A title and an amount, stacked at the accessibility sizes so the amount never truncates
private struct AmountLine: View {
    let title: String
    let amount: Int
    let style: BudgetAmountStyle
    var isHeadline = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) { texts }
            } else {
                HStack { texts }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(BudgetAmountFormat.string(amount, style: style)))
        .accessibilityAddTraits(.isHeader)
        .hiddenWhilePlaceholder()
    }

    @ViewBuilder private var texts: some View {
        Text(title).font(isHeadline ? .headline : .body).foregroundColor(.primary)
        if !typeSize.isAccessibilitySize { Spacer() }
        Text(BudgetAmountFormat.string(amount, style: style))
            .font(.body.monospacedDigit())
            .foregroundColor(amount < 0 ? Money.negative : .secondary)
            .wholeAmount()
    }
}

// D7: closed accounts in secondary text; Reopen in teal on a trailing swipe and in the context menu
private struct ClosedAccountsView: View {
    @ObservedObject var model: AccountsListViewModel
    let open: (String) -> Void

    var body: some View {
        List {
            Section(footer: Text(AccountsWords.closedFooter)) {
                ForEach(model.state.value?.closed.accounts ?? []) { account in
                    Button { open(account.id) } label: {
                        LinkRow { AccountRow(account: account, style: model.state.value?.amountStyle ?? AccountsList.placeholder.amountStyle, isSecondary: true) }
                    }
                    .foregroundColor(.primary)
                    .swipeActions(edge: .trailing) {
                        Button { reopen(account) } label: { Label(AccountsWords.reopen, systemImage: "arrow.uturn.backward") }
                            .tint(Color(NativeTabBarController.accent))
                    }
                    .contextMenu {
                        Button { reopen(account) } label: { Label(AccountsWords.reopen, systemImage: "arrow.uturn.backward") }
                    }
                    .accessibilityAction(named: Text(AccountsWords.reopen)) { reopen(account) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationBarTitle(Text(AccountsWords.closedAccounts), displayMode: .inline)
    }

    private func reopen(_ account: AccountsList.Account) { Task { await model.reopen(account.id) } }
}

// D7 States: no accounts. Add and Link hand off to the web flows (D7a).
private struct AccountsEmpty: View {
    let status: NativeSyncStatus
    let isWritePending: Bool
    let staleError: AccountsLoadError?
    let handOff: (String, String?) -> Void
    let retry: () -> Void

    var body: some View {
        List {
            Section(header: SyncSubtitle(status: status, isWritePending: isWritePending, staleError: staleError, retry: retry)) {
                VStack(spacing: 12) {
                    Text(AccountsWords.firstAccount).font(.headline).accessibilityAddTraits(.isHeader)
                    Text(AccountsWords.firstAccountDetail).foregroundColor(.secondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(AccountsWords.addAccount) { handOff("add-account", nil) }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    Button(AccountsWords.linkAccount) { handOff("link-account", nil) }.buttonStyle(.borderless)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
        }
        .listStyle(.insetGrouped)
    }
}

extension AccountsList {
    // The redacted first load's layout: names and amounts only shape the placeholders
    static let placeholder: AccountsList = {
        func account(_ id: String, _ name: String, _ offbudget: Bool) -> Account {
            Account(
                id: id, name: name, balance: 123_456, offbudget: offbudget, closed: false, lastSync: nil, lastTransactionDate: "2026-01-01",
                bankSync: false, clearingFor: nil)
        }
        return AccountsList(
            currencyCode: "", currencyDecimalPlaces: 2, currencySymbol: "", currencySymbolPosition: .before, currencySpace: false,
            numberFormat: .commaDot, hideFraction: false,
            sections: Sections(
                onBudget: Section(total: 1_234_567, accounts: (1...4).map { account("p\($0)", "Placeholder account", false) }),
                offBudget: Section(total: 1_234_567, accounts: (5...6).map { account("p\($0)", "Placeholder", true) })),
            closed: Section(total: 0, accounts: []), netWorth: 2_469_134)
    }()
}

enum AccountsWords {
    static let title = NSLocalizedString("Accounts", comment: "Native Accounts: screen title")
    static let loading = NSLocalizedString("Loading accounts", comment: "Native Accounts: VoiceOver label while the first read runs")
    static let add = NSLocalizedString("Add", comment: "Native Accounts: the + menu")
    static let addAccount = NSLocalizedString("Add account", comment: "Native Accounts: add an account (web flow)")
    static let linkAccount = NSLocalizedString("Link bank account", comment: "Native Accounts: link a bank account (web flow)")
    static let allAccounts = NSLocalizedString("All accounts", comment: "Native Accounts: the all-accounts register row")
    static let allAccountsDetail = NSLocalizedString("Every transaction, newest first", comment: "Native Accounts: all-accounts row detail")
    static let onBudget = NSLocalizedString("On budget", comment: "Native Accounts: section")
    static let offBudget = NSLocalizedString("Off budget", comment: "Native Accounts: section")
    static let closedAccounts = NSLocalizedString("Closed accounts", comment: "Native Accounts: closed accounts row and screen")
    static let netWorth = NSLocalizedString("Net worth", comment: "Native Accounts: footer")
    static let retry = NSLocalizedString("Retry", comment: "Native Accounts: read again after a failure")
    static let retryHint = NSLocalizedString("Syncs again", comment: "Native Accounts: VoiceOver hint on a failed sync")
    static let ok = NSLocalizedString("OK", comment: "Native Accounts: close an error")
    static let edit = NSLocalizedString("Edit", comment: "Native Accounts: start reordering accounts")
    static let done = NSLocalizedString("Done", comment: "Native Accounts: stop reordering accounts")
    static let undo = NSLocalizedString("Undo", comment: "Native Accounts: undo the last change")
    static let reopen = NSLocalizedString("Reopen", comment: "Native Accounts: reopen a closed account")
    static let reopened = NSLocalizedString("Reopened \"%@\".", comment: "Native Accounts: after a reopen")
    static let moved = NSLocalizedString("Moved \"%@\".", comment: "Native Accounts: after a reorder")
    static let cleared = NSLocalizedString("Cleared \"%@\".", comment: "Native Accounts: after clearing a transaction")
    static let uncleared = NSLocalizedString("Marked \"%@\" pending.", comment: "Native Accounts: after unclearing a transaction")
    static let categorized = NSLocalizedString("Changed the category of \"%@\".", comment: "Native Accounts: after categorizing")
    static let deleted = NSLocalizedString("Deleted \"%@\".", comment: "Native Accounts: after deleting a transaction")
    static let reconcile = NSLocalizedString("Reconcile", comment: "Native Accounts: open the Reconcile flow")
    static let monthReconciled = NSLocalizedString("%@ reconciled", comment: "Native Accounts: reconcile banner, the month is done")

    static func undoText(_ offer: AccountsUndoOffer) -> String {
        let format: String =
            switch offer.action {
            case .reopen: reopened
            case .move: moved
            case .clear: cleared
            case .unclear: uncleared
            case .categorize: categorized
            case .delete: deleted
            }
        return String(format: format, offer.name)
    }
    static let closedFooter = NSLocalizedString(
        "Swipe left or long-press to reopen. Closed accounts keep their transactions and reports.",
        comment: "Native Accounts: closed accounts footer")
    static let firstAccount = NSLocalizedString("Add your first account", comment: "Native Accounts: no accounts")
    static let firstAccountDetail = NSLocalizedString(
        "Add an account by hand, or link your bank to bring in transactions automatically.", comment: "Native Accounts: no accounts")
    static let syncing = NSLocalizedString("Syncing…", comment: "Native Accounts: sync status")
    static let offline = NSLocalizedString("Offline — changes saved on this iPhone", comment: "Native Accounts: sync status")
    static let offlinePlain = NSLocalizedString("Offline", comment: "Native Accounts: sync status while a change may not be stored yet")
    static let syncFailed = NSLocalizedString("Sync failed — tap to retry", comment: "Native Accounts: sync status")
    static let localFile = NSLocalizedString("Local file — not syncing", comment: "Native Accounts: sync status")
    static let syncedJustNow = NSLocalizedString("Synced just now", comment: "Native Accounts: sync status")
    static let syncedAgo = NSLocalizedString("Synced %@", comment: "Native Accounts: sync status or row detail, e.g. Synced 2 min. ago")
    static let updated = NSLocalizedString("Updated %@", comment: "Native Accounts: row detail, the latest transaction's date")
    static let clearing = NSLocalizedString(
        "Clearing for “%1$@” · back to %2$@ each payday", comment: "Native Accounts: a paycheck clearing account's detail")
    static let closedOn = NSLocalizedString("Closed · on budget", comment: "Native Accounts: closed account detail")
    static let closedOff = NSLocalizedString("Closed · off budget", comment: "Native Accounts: closed account detail")

    static func synced(_ date: Date, now: Date) -> String {
        guard now.timeIntervalSince(date) >= 60 else { return syncedJustNow }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return String(format: syncedAgo, formatter.localizedString(for: date, relativeTo: now))
    }

    static func detail(_ detail: AccountDetail, style: BudgetAmountStyle) -> String {
        switch detail {
        case .clearing(let paycheck): String(format: clearing, paycheck, BudgetAmountFormat.string(0, style: style))
        case .synced(let date): synced(date, now: Date())
        case .updated(let day): String(format: updated, Dates.monthDay(day))
        case .closed(let offBudget): offBudget ? closedOff : closedOn
        case .none: ""
        }
    }
}
