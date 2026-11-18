import Combine
import SwiftUI
import UIKit

// Fork-only (sc-4931, sc-3611; native-accounts-screen D4 to D7a). The native
// Accounts screen's host: NativeTabBarController lays it over the web Accounts
// screens while the switch is on and the page shows `/accounts` or
// `/accounts/<id>` with the tab bar. It stays hidden, so the web screen shows,
// until loot-core has answered and knows the account. The switch is off by
// default until task 3.8; developers set the UserDefaults key
// `NativeScreen.accounts` (NativeScreenSwitch.accountsKey) to true.
final class NativeAccountsViewController: UIHostingController<AccountsScreen> {
    let route: NativeAccountsRoute
    private let model: AccountsListViewModel
    private let chrome: NativeChromePlugin
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var stateObserver: AnyCancellable?

    init(client: NativeBridgeClient, route: NativeAccountsRoute, chrome: NativeChromePlugin, syncStatus: NativeSyncStatus) {
        self.route = route
        self.chrome = chrome
        let model = AccountsListViewModel(client: client)
        model.syncStatus = syncStatus
        self.model = model
        weak var handOff: NativeAccountsViewController?
        super.init(
            rootView: AccountsScreen(
                model: model, navigate: { [weak chrome] in chrome?.navigate(to: $0) },
                handOff: { handOff?.handOff($0, accountId: $1) }))
        handOff = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // A page event (NativeBridgePlugin.onPaychecksEvent): "ready" is the page back after a refused call
    func eventReceived(_ event: String, tables: [String]) {
        if event == "ready" {
            Task { await model.pageReady() }
        } else {
            model.eventReceived(event, tables: tables)
        }
    }

    // loot-core's sync outcome, as NativeBridgePlugin follows it
    func syncStatusChanged(_ status: NativeSyncStatus) { model.syncStatus = status }

    // The closed set of web flows (D7a); an action or account it does not allow is dropped
    func handOff(_ action: String, accountId: String? = nil) {
        guard let list = model.state.value,
              let hand = try? WebAccountAction(action, accountId: accountId, openAccountIds: NativeAccountsRoute.openAccountIds(in: list))
        else { return }
        chrome.handOff(hand)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
        UIView.appearance(whenContainedInInstancesOf: [UIAlertController.self]).tintColor = NativeTabBarController.accent
        // The web screen shows until the list is read; a failed first read shows the native error
        view.isHidden = true
        stateObserver = model.$state.sink { [weak self] state in
            guard let self else { return }
            // shortcut: the native register is the next piece of story 3611; until it lands,
            // `/accounts/<id>` stays the web register
            guard self.route == .list else { return }
            switch state {
            case .loading: self.view.isHidden = true
            case .loaded, .stale, .failed: self.view.isHidden = false
            }
        }
        let center = NotificationCenter.default
        for (name, active) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
            lifecycleObservers.append(
                center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    guard let model = self?.model else { return }
                    Task { await model.setSceneActive(active) }
                })
        }
        Task { await model.load() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        model.leave()
    }

    deinit { lifecycleObservers.forEach(NotificationCenter.default.removeObserver) }
}

// D7: the list. Every balance and total is loot-core's; Swift formats them.
struct AccountsScreen: View {
    @ObservedObject var model: AccountsListViewModel
    let navigate: (String) -> Void
    // A web flow (D7a): the action and, for the account ones, its id
    let handOff: (String, String?) -> Void
    @Environment(\.editMode) private var editMode

    var body: some View {
        NavigationView {
            content
                .navigationBarTitle(Text(AccountsWords.title), displayMode: .large)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        if let list = model.state.value, !list.sections.onBudget.accounts.isEmpty || !list.sections.offBudget.accounts.isEmpty {
                            EditButton()
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) { addMenu }
                }
        }
        .navigationViewStyle(.stack)
        .tint(Color(NativeTabBarController.accent))
        .safeAreaInset(edge: .bottom) { undoBar }
        .alert(model.actionError?.message ?? "", isPresented: isErrorShown) {
            Button(AccountsWords.ok, role: .cancel) {}
        }
        .onChange(of: model.actionError) { error in
            if let error { UIAccessibility.post(notification: .announcement, argument: error.message) }
        }
    }

    private var isErrorShown: Binding<Bool> {
        Binding(get: { model.actionError != nil }, set: { if !$0 { model.clearActionError() } })
    }

    private var addMenu: some View {
        Menu {
            Button { handOff("add-account", nil) } label: { Label(AccountsWords.addAccount, systemImage: "plus") }
            Button { handOff("link-account", nil) } label: { Label(AccountsWords.linkAccount, systemImage: "building.columns") }
        } label: {
            Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(Text(AccountsWords.add))
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            // The real layout, redacted; no spinner and no shimmer (D6)
            AccountsListBody(list: .placeholder, status: .syncing, isSyncing: true, staleError: nil, model: model, navigate: { _ in }, handOff: { _, _ in })
                .redacted(reason: .placeholder)
                .disabled(true)
                .accessibilityLabel(Text(AccountsWords.loading))
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
            AccountsEmpty(status: model.syncStatus, staleError: staleError, handOff: handOff) { Task { await model.refresh() } }
        } else {
            AccountsListBody(
                list: list, status: model.syncStatus, isSyncing: model.isSyncing, staleError: staleError, model: model, navigate: navigate,
                handOff: handOff)
        }
    }

    @ViewBuilder private var undoBar: some View {
        if let offer = model.undoOffer {
            HStack {
                Text(undoText(offer)).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(AccountsWords.undo) { Task { await model.undo() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isWorking)
            }
            .padding()
            .background(.regularMaterial)
        }
    }

    private func undoText(_ offer: AccountsUndoOffer) -> String {
        switch offer.action {
        case .reopen: String(format: AccountsWords.reopened, offer.accountName)
        case .move: String(format: AccountsWords.moved, offer.accountName)
        }
    }
}

private struct AccountsListBody: View {
    let list: AccountsList
    let status: NativeSyncStatus
    let isSyncing: Bool
    let staleError: AccountsLoadError?
    @ObservedObject var model: AccountsListViewModel
    let navigate: (String) -> Void
    let handOff: (String, String?) -> Void

    var body: some View {
        List {
            Section(header: SyncSubtitle(status: isSyncing ? .syncing : status, staleError: staleError) { Task { await model.refresh() } }) {
                Button { navigate("/accounts/all") } label: {
                    LinkRow { AccountTexts(name: AccountsWords.allAccounts, detail: AccountsWords.allAccountsDetail) }
                }
                .foregroundColor(.primary)
            }
            section(.onBudget, title: AccountsWords.onBudget, list.sections.onBudget)
            section(.offBudget, title: AccountsWords.offBudget, list.sections.offBudget)
            if !list.closed.accounts.isEmpty {
                Section {
                    NavigationLink {
                        ClosedAccountsView(model: model, navigate: navigate)
                    } label: {
                        AccountTexts(name: AccountsWords.closedAccounts, detail: String(format: AccountsWords.accountCount, list.closed.accounts.count))
                    }
                }
            }
            Section {
                AmountLine(title: AccountsWords.netWorth, amount: list.netWorth, style: list.amountStyle, isHeadline: true)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
    }

    @ViewBuilder private func section(_ which: AccountsListSection, title: String, _ section: AccountsList.Section) -> some View {
        if !section.accounts.isEmpty {
            Section(header: AmountLine(title: title, amount: section.total, style: list.amountStyle, isHeadline: true).textCase(nil)) {
                ForEach(section.accounts) { account in
                    Button { navigate("/accounts/\(account.id)") } label: {
                        LinkRow { AccountRow(account: account, style: list.amountStyle) }
                    }
                    .foregroundColor(.primary)
                }
                .onMove { from, to in
                    guard let first = from.first else { return }
                    Task { await model.move(in: which, from: first, to: to) }
                }
            }
        }
    }
}

// The subtitle under the large title: sync status in words (mobile-sync-status), and a
// failed re-read in place of it. A failure is warning text and a tap retries.
private struct SyncSubtitle: View {
    let status: NativeSyncStatus
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
        case .offline: return (AccountsWords.offline, false)
        case .failed: return (AccountsWords.syncFailed, true)
        case .local: return (AccountsWords.localFile, false)
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
    }

    private var texts: some View { AccountTexts(name: account.name, detail: detail, isSecondary: isSecondary) }

    private var amountText: String { BudgetAmountFormat.string(account.balance, style: style) }

    private var balance: some View {
        Text(amountText)
            .font(.body.monospacedDigit())
            .foregroundColor(account.balance < 0 ? Money.negative : .primary)
            .fixedSize(horizontal: false, vertical: true)
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
    }

    @ViewBuilder private var texts: some View {
        Text(title).font(isHeadline ? .headline : .body).foregroundColor(.primary)
        if !typeSize.isAccessibilitySize { Spacer() }
        Text(BudgetAmountFormat.string(amount, style: style))
            .font(.body.monospacedDigit())
            .foregroundColor(amount < 0 ? Money.negative : .secondary)
    }
}

// D7: closed accounts in secondary text; Reopen in teal on a trailing swipe and in the context menu
private struct ClosedAccountsView: View {
    @ObservedObject var model: AccountsListViewModel
    let navigate: (String) -> Void

    var body: some View {
        List {
            Section(footer: Text(AccountsWords.closedFooter)) {
                ForEach(model.state.value?.closed.accounts ?? []) { account in
                    Button { navigate("/accounts/\(account.id)") } label: {
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
    let staleError: AccountsLoadError?
    let handOff: (String, String?) -> Void
    let retry: () -> Void

    var body: some View {
        List {
            Section(header: SyncSubtitle(status: status, staleError: staleError, retry: retry)) {
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
    static let accountCount = NSLocalizedString("%d accounts", comment: "Native Accounts: closed accounts count")
    static let netWorth = NSLocalizedString("Net worth", comment: "Native Accounts: footer")
    static let retry = NSLocalizedString("Retry", comment: "Native Accounts: read again after a failure")
    static let retryHint = NSLocalizedString("Syncs again", comment: "Native Accounts: VoiceOver hint on a failed sync")
    static let ok = NSLocalizedString("OK", comment: "Native Accounts: close an error")
    static let undo = NSLocalizedString("Undo", comment: "Native Accounts: undo the last change")
    static let reopen = NSLocalizedString("Reopen", comment: "Native Accounts: reopen a closed account")
    static let reopened = NSLocalizedString("Reopened \"%@\".", comment: "Native Accounts: after a reopen")
    static let moved = NSLocalizedString("Moved \"%@\".", comment: "Native Accounts: after a reorder")
    static let closedFooter = NSLocalizedString(
        "Swipe left or long-press to reopen. Closed accounts keep their transactions and reports.",
        comment: "Native Accounts: closed accounts footer")
    static let firstAccount = NSLocalizedString("Add your first account", comment: "Native Accounts: no accounts")
    static let firstAccountDetail = NSLocalizedString(
        "Add an account by hand, or link your bank to bring in transactions automatically.", comment: "Native Accounts: no accounts")
    static let syncing = NSLocalizedString("Syncing…", comment: "Native Accounts: sync status")
    static let offline = NSLocalizedString("Offline — changes saved on this iPhone", comment: "Native Accounts: sync status")
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
