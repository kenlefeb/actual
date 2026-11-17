import SwiftUI
import UIKit

// Fork-only (sc-4801, native-reconcile-flow D7, Figma "Reconcile — iPhone &
// Mac"). The native Reconcile flow, presented full screen (large detent only)
// over the web Accounts screens: the "Reconcile this month" checklist, step 1
// (confirm the statement balance) and step 2 (tick off). Every amount and the
// difference are loot-core's; this only shows them. Steps 3 and 4 are sc-4825:
// at 0.00 step 2 hands over to the web register, which locks.
final class NativeReconcileViewController: UIHostingController<ReconcileFlowView> {
    private let flow: ReconcileFlowModel

    // `navigate` asks the page to show a path, after the flow has closed
    init(month: ReconcileMonthViewModel, request: PresentReconcile, client: NativeBridgeClient, navigate: @escaping (String) -> Void) {
        let flow = ReconcileFlowModel(month: month, client: client, request: request)
        self.flow = flow
        var close: () -> Void = {}
        var open: (String) -> Void = { _ in }
        super.init(rootView: ReconcileFlowView(flow: flow, month: month, close: { close() }, closeAndOpen: { open($0) }))
        close = { [weak self] in self?.dismiss(animated: true) }
        open = { [weak self] path in self?.dismiss(animated: true) { navigate(path) } }
        modalPresentationStyle = .pageSheet
        sheetPresentationController?.detents = [.large()]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    #if DEBUG
    func showStepTwo(_ id: String) { flow.confirmed(id) }
    #endif

    // A page event (sync-event and its changed tables)
    func eventReceived(_ event: String, tables: [String]) {
        flow.month.eventReceived(event, tables: tables)
        flow.tick?.eventReceived(event, tables: tables)
    }
}

// Which screen the flow shows; step 1 and step 2 keep their models
@MainActor
final class ReconcileFlowModel: ObservableObject {
    enum Screen: Equatable { case checklist, stepOne(String), stepTwo(String) }

    @Published var screen: Screen
    @Published private(set) var stepOne: ReconcileStepOneViewModel?
    @Published private(set) var tick: ReconcileTickViewModel?
    let month: ReconcileMonthViewModel
    private let client: NativeBridgeClient

    init(month: ReconcileMonthViewModel, client: NativeBridgeClient, request: PresentReconcile) {
        self.month = month
        self.client = client
        screen = .checklist
        if case .account(let id) = request { open(id) }
    }

    var style: BudgetAmountStyle? { month.state.read?.amountStyle }

    func name(of id: String) -> String {
        let read = month.state.read
        return read?.accounts.first { $0.id == id }?.name ?? read?.hidden.first { $0.id == id }?.name ?? ""
    }

    func open(_ id: String) {
        guard let style else { return }
        stepOne = ReconcileStepOneViewModel(client: client, accountId: id, style: style)
        tick = nil
        screen = .stepOne(id)
    }

    func confirmed(_ id: String) {
        tick = ReconcileTickViewModel(client: client, accountId: id, style: style)
        screen = .stepTwo(id)
    }

    func backToChecklist() {
        (stepOne, tick) = (nil, nil)
        screen = .checklist
        Task { await month.load() }
    }
}

struct ReconcileFlowView: View {
    @ObservedObject var flow: ReconcileFlowModel
    @ObservedObject var month: ReconcileMonthViewModel
    let close: () -> Void
    let closeAndOpen: (String) -> Void

    var body: some View {
        NavigationView {
            Group {
                switch flow.screen {
                case .checklist:
                    ReconcileChecklistView(month: month, open: flow.open, close: close)
                case .stepOne(let id):
                    if let model = flow.stepOne {
                        ReconcileStepOneView(
                            model: model, accountName: flow.name(of: id), provider: account(id)?.providerName,
                            lastReconciled: account(id)?.lastReconciled,
                            close: close, confirmed: { flow.confirmed(id) },
                            openBankSync: { closeAndOpen("/settings/bank-sync") })
                    }
                case .stepTwo(let id):
                    if let model = flow.tick, let style = flow.style {
                        ReconcileTickView(
                            model: model, style: style, accountName: flow.name(of: id), back: { flow.open(id) },
                            close: close, closeAndOpen: closeAndOpen)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .navigationViewStyle(.stack)
        .tint(NativeReconcileTokens.accent)
        .task { if month.state.read == nil { await month.load() } }
    }

    private func account(_ id: String) -> ReconcileMonth.Account? {
        month.state.read?.accounts.first { $0.id == id }
    }
}

enum NativeReconcileTokens {
    static let accent = Color(NativeTabBarController.accent)
    // Money in, as the register tints it
    static let positive = Color(UIColor { $0.userInterfaceStyle == .dark ? .systemGreen : UIColor(red: 0.1, green: 0.5, blue: 0.2, alpha: 1) })
    // A difference still to find: worded too, never colour alone
    // Light: a dark orange (about 5:1 on its pale tint); dark: the system orange
    static let attention = Color(UIColor { $0.userInterfaceStyle == .dark ? .systemOrange : UIColor(red: 0.62, green: 0.27, blue: 0, alpha: 1) })
    static let card = Color(UIColor.secondarySystemGroupedBackground)
    // Text on the accent: the dark-mode teal is light, so its text is dark
    static let onAccent = Color(UIColor { $0.userInterfaceStyle == .dark ? .black : .white })
    static let background = Color(UIColor.systemGroupedBackground)
}

// MARK: Checklist

struct ReconcileChecklistView: View {
    @ObservedObject var month: ReconcileMonthViewModel
    let open: (String) -> Void
    let close: () -> Void
    @State private var isEditingList = false

    var body: some View {
        content
            .background(NativeReconcileTokens.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: close) { Image(systemName: "xmark") }
                        .accessibilityLabel(Text(ReconcileWords.close))
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(title).font(.headline)
                        if let read = month.state.read, !read.accounts.isEmpty {
                            Text(String(format: ReconcileWords.doneOf, month.doneCount, read.accounts.count))
                                .font(.caption).foregroundColor(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button { isEditingList = true } label: { Label(ReconcileWords.editList, systemImage: "list.bullet") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(Text(ReconcileWords.more))
                }
            }
            .sheet(isPresented: $isEditingList) { ReconcileEditListView(month: month) }
    }

    private var title: String {
        guard let month = month.state.read?.month else { return ReconcileWords.reconcile }
        return String(format: ReconcileWords.reconcileMonth, Dates.monthName(month))
    }

    @ViewBuilder private var content: some View {
        switch month.state {
        case .loading:
            ProgressView().accessibilityLabel(Text(ReconcileWords.loading)).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let error):
            ReconcileErrorView(message: error.message) { Task { await month.load() } }
        case .loaded, .stale:
            List {
                if ReconcileMonthViewModel.showsReady, !month.ready.isEmpty {
                    Section(header: Text(ReconcileWords.ready)) { rows(month.ready) }
                }
                if !month.due.isEmpty {
                    Section(header: Text(ReconcileWords.due)) { rows(month.due) }
                }
                if !month.done.isEmpty {
                    Section(header: Text(ReconcileWords.done)) { rows(month.done) }
                }
                Section(footer: Text(ReconcileWords.listFooter)) { EmptyView() }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func rows(_ accounts: [ReconcileMonth.Account]) -> some View {
        ForEach(accounts) { account in
            Button { open(account.id) } label: { ReconcileChecklistRow(account: account, style: month.state.read?.amountStyle) }
                .foregroundColor(.primary)
        }
    }
}

struct ReconcileChecklistRow: View {
    let account: ReconcileMonth.Account
    let style: BudgetAmountStyle?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundColor(account.status == .done ? NativeReconcileTokens.accent : .secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name)
                Text(detail).font(.subheadline).foregroundColor(.secondary)
                // The status word moves under the detail at accessibility sizes
                if typeSize.isAccessibilitySize { statusWord }
            }
            Spacer(minLength: 8)
            if !typeSize.isAccessibilitySize { statusWord }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([account.name, word, detail].joined(separator: ", ")))
        .accessibilityAddTraits(.isButton)
    }

    private var symbol: String {
        switch account.status {
        case .done: "checkmark.circle.fill"
        case .inProgress: "circle.lefthalf.filled"
        case .ready: "exclamationmark.circle.fill"
        case .due, .other: "circle"
        }
    }

    private var word: String {
        switch account.status {
        case .done: ReconcileWords.statusDone
        case .inProgress: ReconcileWords.statusInProgress
        case .ready: ReconcileWords.statusReady
        case .due, .other: ReconcileWords.statusDue
        }
    }

    private var statusWord: some View {
        Text(account.status == .done ? word : word + " ›").font(.subheadline.weight(.semibold))
            .foregroundColor(account.status == .done ? NativeReconcileTokens.accent : .secondary)
    }

    private var detail: String {
        if account.status == .done, let day = Dates.day(fromMilliseconds: account.lastReconciled) {
            return String(format: ReconcileWords.reconciledOn, Dates.short(day))
        }
        guard let style else { return "" }
        if let statement = account.detail.statement {
            return String(format: ReconcileWords.statementIs, BudgetAmountFormat.string(statement, style: style))
        }
        return String(format: ReconcileWords.clearedIs, BudgetAmountFormat.string(account.detail.cleared, style: style))
    }
}

struct ReconcileEditListView: View {
    @ObservedObject var month: ReconcileMonthViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                Section(header: Text(ReconcileWords.listed)) {
                    ForEach(month.state.read?.accounts ?? []) { account in
                        HStack {
                            Text(account.name)
                            Spacer()
                            Button(ReconcileWords.remove) { Task { await month.remove(account.id) } }
                                .accessibilityLabel(Text(String(format: ReconcileWords.removeNamed, account.name)))
                        }
                    }
                }
                if let hidden = month.state.read?.hidden, !hidden.isEmpty {
                    Section(header: Text(ReconcileWords.notListed)) {
                        ForEach(hidden) { account in
                            HStack {
                                Text(account.name)
                                Spacer()
                                Button(ReconcileWords.add) { Task { await month.restore(account.id) } }
                                    .accessibilityLabel(Text(String(format: ReconcileWords.addNamed, account.name)))
                            }
                        }
                    }
                }
                if let error = month.error {
                    Text(error.message).foregroundColor(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(ReconcileWords.editList)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(ReconcileWords.doneButton) { dismiss() } }
            }
        }
        .tint(NativeReconcileTokens.accent)
    }
}

// MARK: Step header

struct ReconcileStepHeader: View {
    let step: Int
    let name: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach(1...4, id: \.self) { index in
                    Capsule().fill(index <= step ? NativeReconcileTokens.accent : Color(UIColor.systemGray4)).frame(height: 4)
                }
            }
            .accessibilityHidden(true)
            Text(String(format: ReconcileWords.stepOf, step, 4) + " · " + name)
                .font(.footnote.weight(.semibold)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(Text(String(format: ReconcileWords.stepSpoken, step, 4, name)))
                .accessibilityAddTraits(.isHeader)
        }
        .onAppear {
            UIAccessibility.post(notification: .screenChanged, argument: String(format: ReconcileWords.stepSpoken, step, 4, name))
        }
    }
}

// MARK: Step 1

struct ReconcileStepOneView: View {
    @ObservedObject var model: ReconcileStepOneViewModel
    let accountName: String
    // The bank sync provider (SimpleFIN), as the web dialog names it
    let provider: String?
    let lastReconciled: String?
    let close: () -> Void
    let confirmed: () -> Void
    let openBankSync: () -> Void
    @State private var showsNote = false
    @State private var showsClearedNote = false
    @FocusState private var isFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ReconcileStepHeader(step: 1, name: ReconcileWords.statementBalance)
                balanceCard
                alternatives
                Text(lastLine).font(.footnote).foregroundColor(.secondary)
                if let error = model.error { Text(error.message).font(.footnote).foregroundColor(.secondary) }
            }
            .padding()
        }
        .background(NativeReconcileTokens.background.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            Button(action: confirm) {
                Text(ReconcileWords.confirmBalance).font(.headline).foregroundColor(model.canConfirm ? NativeReconcileTokens.onAccent : nil)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .disabled(!model.canConfirm)
            .accessibilityHint(model.canConfirm ? Text("") : Text(ReconcileWords.enterFirst))
            .padding()
            .background(NativeReconcileTokens.background)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel(Text(ReconcileWords.closeNothingSaved))
            }
            ToolbarItem(placement: .principal) {
                Text(String(format: ReconcileWords.reconcileAccount, accountName)).font(.headline).accessibilityAddTraits(.isHeader)
            }
        }
        .task {
            if model.state.read == nil { await model.load() }
            if model.prefill == nil { isFocused = true }
        }
        .alert(ReconcileWords.clearedNoteTitle, isPresented: $showsClearedNote) {
            Button(ReconcileWords.continueButton) { confirmed() }
        } message: {
            Text(ReconcileWords.clearedNote)
        }
    }

    private func confirm() {
        Task {
            guard await model.confirm() else { return }
            if model.showsClearedNote { showsClearedNote = true } else { confirmed() }
        }
    }

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(ReconcileWords.closingBalance).font(.subheadline).foregroundColor(.secondary)
            amountField.font(.largeTitle.weight(.bold).monospacedDigit())
            sourceLine
            if showsNote, case .bankSync = model.source {
                VStack(alignment: .leading, spacing: 8) {
                    Text(ReconcileWords.bankNote).font(.subheadline)
                    Button(ReconcileWords.bankSyncSettings, action: openBankSync).font(.subheadline.weight(.semibold))
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(NativeReconcileTokens.background))
            }
            if model.source == .entered, let prefill = model.prefill {
                Button(String(format: ReconcileWords.restore, model.string(prefill.amount))) { model.restoreBankBalance() }
                    .font(.subheadline.weight(.semibold))
            }
            if model.prefill == nil, model.source == .none {
                Text(ReconcileWords.enterHint).font(.subheadline).foregroundColor(.secondary)
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 16).fill(NativeReconcileTokens.card))
    }

    private var amountField: some View {
        TextField(ReconcileWords.amountPlaceholder, text: $model.text)
            .keyboardType(.numbersAndPunctuation)
            .focused($isFocused)
            .submitLabel(.done)
            .onSubmit(confirm)
            .accessibilityLabel(Text(ReconcileWords.closingBalance))
            .accessibilityValue(Text([model.amount.map(model.string) ?? model.text, sourceText].joined(separator: ", ")))
    }

    // Words and a symbol, never colour alone (D4); tap the symbol for the note
    private var sourceLine: some View {
        Button {
            showsNote.toggle()
        } label: {
            Label(sourceText, systemImage: "info.circle").font(.subheadline).foregroundColor(.secondary)
        }
        .accessibilityHint(Text(ReconcileWords.sourceHint))
    }

    private var sourceText: String {
        switch model.source {
        case .bankSync(let asOf):
            switch (provider, asOf) {
            case (let provider?, let asOf?): return String(format: ReconcileWords.fromProvider, provider, Dates.short(asOf))
            case (let provider?, nil): return String(format: ReconcileWords.fromProviderUnknown, provider)
            case (nil, let asOf?): return String(format: ReconcileWords.fromBank, Dates.short(asOf))
            case (nil, nil): return ReconcileWords.fromBankUnknown
            }
        case .entered: return ReconcileWords.enteredByYou
        case .cleared: return ReconcileWords.fromCleared
        case .none: return model.staleBank == nil ? ReconcileWords.noSource : ReconcileWords.noRecentSource
        }
    }

    @ViewBuilder private var alternatives: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let stale = model.staleBank, model.source != .bankSync(asOf: stale.asOf) {
                Button(String(format: ReconcileWords.useStale, stale.asOf.map(Dates.short) ?? ReconcileWords.unknownDate, model.string(stale.amount))) {
                    model.useStaleBank()
                }
            }
            if let cleared = model.cleared {
                VStack(alignment: .leading, spacing: 2) {
                    Button(String(format: ReconcileWords.useCleared, model.string(cleared.amount))) { model.useCleared() }
                    Text(ReconcileWords.clearedCaveat).font(.footnote).foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(NativeReconcileTokens.card))
    }

    private var lastLine: String {
        guard let day = Dates.day(fromMilliseconds: lastReconciled) else { return ReconcileWords.notYetReconciled }
        return String(format: ReconcileWords.lastReconciled, Dates.short(day))
    }
}

// MARK: Step 2

struct ReconcileTickView: View {
    @ObservedObject var model: ReconcileTickViewModel
    let style: BudgetAmountStyle
    let accountName: String
    let back: () -> Void
    let close: () -> Void
    let closeAndOpen: (String) -> Void
    @State private var search = ""
    @Environment(\.dynamicTypeSize) private var typeSize
    private let haptics = UIImpactFeedbackGenerator(style: .light)

    var body: some View {
        list
            .safeAreaInset(edge: .top) {
                VStack(spacing: 12) {
                    if typeSize.isAccessibilitySize {
                        difference.padding(.horizontal)
                    } else {
                        ReconcileStepHeader(step: 2, name: ReconcileWords.tickOff).padding(.horizontal)
                        summary.padding(.horizontal)
                        scopePicker.padding(.horizontal)
                    }
                }
                .padding(.vertical, 8)
                .background(NativeReconcileTokens.background)
            }
            .onChange(of: model.scope) { _ in Task { await model.load() } }
            .background(NativeReconcileTokens.background.ignoresSafeArea())
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic), prompt: Text(ReconcileWords.findAmount))
        .safeAreaInset(edge: .bottom) { exitButton }
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button(action: back) { Image(systemName: "chevron.left") }.accessibilityLabel(Text(ReconcileWords.backToStepOne))
            }
            ToolbarItem(placement: .principal) {
                Text(String(format: ReconcileWords.reconcileAccount, accountName)).font(.headline).accessibilityAddTraits(.isHeader)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel(Text(ReconcileWords.closeKeepTicks))
            }
        }
        .task { await model.load() }
        .onChange(of: model.announcement) { message in
            if let message { UIAccessibility.post(notification: .announcement, argument: message) }
        }
    }

    private func amount(_ value: Int?) -> String {
        value.map { BudgetAmountFormat.string($0, style: style) } ?? "—"
    }

    private var scopePicker: some View {
        Picker(ReconcileWords.show, selection: $model.scope) {
            Text(ReconcileWords.toTick).tag(ReconcileScope.toTick)
            Text(ReconcileWords.all).tag(ReconcileScope.all)
        }
        .pickerStyle(.segmented)
    }

    // Three columns; at accessibility sizes one, so no number breaks mid-digit
    private var summary: some View {
        let columns = typeSize.isAccessibilitySize ? [GridItem(.flexible())] : Array(repeating: GridItem(.flexible(), alignment: .top), count: 3)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            figure(ReconcileWords.statement, amount(model.summary?.statement))
            figure(ReconcileWords.cleared, amount(model.summary?.cleared))
            if !typeSize.isAccessibilitySize { difference }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 16).fill(NativeReconcileTokens.card))
    }

    private var difference: some View {
        let difference = model.summary?.difference
        let tint = difference == 0 ? NativeReconcileTokens.accent : NativeReconcileTokens.attention
        return figure(difference == 0 ? ReconcileWords.balanced : ReconcileWords.difference, amount(difference), tint: tint)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 10).fill(tint.opacity(0.12)))
            .accessibilityAddTraits(.updatesFrequently)
    }

    private func figure(_ label: String, _ value: String, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundColor(tint == .primary ? .secondary : tint)
            Text(value).font(.headline.monospacedDigit()).foregroundColor(tint).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var shownRows: [ReconcileRows.Row] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return model.rows }
        // Find amount: matches the shown amount's digits, nothing summed
        let digits = query.filter(\.isNumber)
        return model.rows.filter { BudgetAmountFormat.string($0.amount, style: style).filter(\.isNumber).contains(digits) }
    }

    private var list: some View {
        List {
            if typeSize.isAccessibilitySize {
                Section {
                    ReconcileStepHeader(step: 2, name: ReconcileWords.tickOff)
                    figure(ReconcileWords.statement, amount(model.summary?.statement))
                    figure(ReconcileWords.cleared, amount(model.summary?.cleared))
                    scopePicker
                }
            }
            Section(header: Text(ReconcileWords.tapHint)) {
                ForEach(shownRows) { row in
                    NativeTransactionRow(
                        payee: row.payee ?? row.notes ?? "", category: row.category, date: row.date,
                        amount: (row.amount > 0 ? "+" : "") + amount(row.amount), isIncome: row.amount > 0,
                        status: row.reconciled ? .locked : row.cleared ? .cleared : .notCleared
                    )
                    .onTapGesture { toggle(row) }
                    .swipeActions(edge: .leading) {
                        if !row.reconciled {
                            Button { toggle(row) } label: {
                                Label(row.cleared ? ReconcileWords.markNotCleared : ReconcileWords.markCleared, systemImage: "checkmark.circle")
                            }
                            .tint(NativeReconcileTokens.accent)
                        }
                    }
                    .contextMenu {
                        Button { closeAndOpen("/transactions/\(row.id)") } label: { Label(ReconcileWords.editTransaction, systemImage: "pencil") }
                    }
                    .accessibilityHint(row.reconciled ? Text("") : Text(row.cleared ? ReconcileWords.hintUnmark : ReconcileWords.hintMark))
                    .accessibilityAction { toggle(row) }
                    .accessibilityAction(named: Text(ReconcileWords.editTransaction)) { closeAndOpen("/transactions/\(row.id)") }
                }
            }
            if let error = model.error { Text(error.message).foregroundColor(.secondary) }
        }
        .listStyle(.insetGrouped)
    }

    private func toggle(_ row: ReconcileRows.Row) {
        guard !row.reconciled else { return }
        haptics.impactOccurred()
        Task { await model.toggle(row) }
    }

    private var exitButton: some View {
        Button {
            if model.exit == .readyToLock, let statement = model.summary?.statement {
                closeAndOpen("/accounts/\(model.accountId)?reconcile=\(statement)")
            } else {
                close()
            }
        } label: {
            Text(model.exit == .readyToLock ? ReconcileWords.readyToLock : ReconcileWords.doneForNow)
                .font(.headline).foregroundColor(NativeReconcileTokens.onAccent).frame(maxWidth: .infinity, minHeight: 44)
                .multilineTextAlignment(.center)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .padding()
        .background(NativeReconcileTokens.background)
    }
}

struct ReconcileErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(message).multilineTextAlignment(.center)
            Button(ReconcileWords.tryAgain, action: retry)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension Dates {
    // loot-core's last_reconciled is ms as text
    static func day(fromMilliseconds value: String?) -> String? {
        guard let value, let ms = Double(value) else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    static func monthName(_ month: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: month) else { return month }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM")
        return formatter.string(from: date)
    }
}

enum ReconcileWords {
    static let reconcile = NSLocalizedString("Reconcile", comment: "Native Reconcile: title before the month is read")
    static let reconcileMonth = NSLocalizedString("Reconcile %@", comment: "Native Reconcile: checklist title, the month name")
    static let reconcileAccount = NSLocalizedString("Reconcile %@", comment: "Native Reconcile: step title, the account name")
    static let doneOf = NSLocalizedString("%d of %d done", comment: "Native Reconcile: checklist subtitle")
    static let close = NSLocalizedString("Close", comment: "Native Reconcile: close the checklist")
    static let closeNothingSaved = NSLocalizedString("Close without saving a balance", comment: "Native Reconcile: step 1 close")
    static let closeKeepTicks = NSLocalizedString("Close and keep the ticks", comment: "Native Reconcile: step 2 close")
    static let backToStepOne = NSLocalizedString("Back to the statement balance", comment: "Native Reconcile: step 2 back")
    static let more = NSLocalizedString("More", comment: "Native Reconcile: checklist menu")
    static let editList = NSLocalizedString("Edit List", comment: "Native Reconcile: choose the accounts on the checklist")
    static let loading = NSLocalizedString("Loading", comment: "Native Reconcile: VoiceOver label on the spinner")
    static let ready = NSLocalizedString("Ready to confirm", comment: "Native Reconcile: checklist group")
    static let due = NSLocalizedString("Due", comment: "Native Reconcile: checklist group")
    static let done = NSLocalizedString("Done", comment: "Native Reconcile: checklist group")
    static let statusDue = NSLocalizedString("Due", comment: "Native Reconcile: an account's status word")
    static let statusDone = NSLocalizedString("Done", comment: "Native Reconcile: an account's status word")
    static let statusInProgress = NSLocalizedString("In progress", comment: "Native Reconcile: an account's status word")
    static let statusReady = NSLocalizedString("Confirm", comment: "Native Reconcile: an account's status word, ready to confirm")
    static let listFooter = NSLocalizedString(
        "Shows open accounts that you reconcile monthly. ••• › Edit List to add or remove one.", comment: "Native Reconcile: checklist footer")
    static let reconciledOn = NSLocalizedString("Reconciled %@", comment: "Native Reconcile: a done account's detail, the date")
    static let statementIs = NSLocalizedString("Statement %@", comment: "Native Reconcile: an in-progress account's detail")
    static let clearedIs = NSLocalizedString("Cleared %@", comment: "Native Reconcile: a due account's detail")
    static let listed = NSLocalizedString("On the checklist", comment: "Native Reconcile: Edit List section")
    static let notListed = NSLocalizedString("Not on the checklist", comment: "Native Reconcile: Edit List section")
    static let remove = NSLocalizedString("Remove", comment: "Native Reconcile: Edit List, take an account off")
    static let removeNamed = NSLocalizedString("Remove %@", comment: "Native Reconcile: Edit List, VoiceOver")
    static let add = NSLocalizedString("Add", comment: "Native Reconcile: Edit List, put an account back")
    static let addNamed = NSLocalizedString("Add %@", comment: "Native Reconcile: Edit List, VoiceOver")
    static let doneButton = NSLocalizedString("Done", comment: "Native Reconcile: close Edit List")
    static let stepOf = NSLocalizedString("Step %d of %d", comment: "Native Reconcile: step header")
    static let stepSpoken = NSLocalizedString("Step %d of %d, %@", comment: "Native Reconcile: VoiceOver step announcement")
    static let statementBalance = NSLocalizedString("Statement balance", comment: "Native Reconcile: step 1 name")
    static let tickOff = NSLocalizedString("Tick off", comment: "Native Reconcile: step 2 name")
    static let closingBalance = NSLocalizedString("Closing balance on your statement", comment: "Native Reconcile: step 1 field label")
    static let amountPlaceholder = NSLocalizedString("0.00", comment: "Native Reconcile: empty amount field")
    static let fromBank = NSLocalizedString("From your bank balance, synced %@", comment: "Native Reconcile: source line")
    static let fromBankUnknown = NSLocalizedString("From your bank balance, balance date unknown", comment: "Native Reconcile: source line")
    static let fromProvider = NSLocalizedString("From %@ balance, synced %@", comment: "Native Reconcile: source line, the provider and day")
    static let fromProviderUnknown = NSLocalizedString(
        "From %@ balance, balance date unknown", comment: "Native Reconcile: source line, the provider")
    static let enteredByYou = NSLocalizedString("Entered by you", comment: "Native Reconcile: source line after an edit")
    static let fromCleared = NSLocalizedString("Your cleared balance", comment: "Native Reconcile: source line, cleared chosen")
    static let noSource = NSLocalizedString("No bank sync for this account", comment: "Native Reconcile: source line, no source")
    static let noRecentSource = NSLocalizedString("No recent bank balance", comment: "Native Reconcile: source line, only a stale bank balance")
    static let sourceHint = NSLocalizedString("Shows or hides where this balance comes from", comment: "Native Reconcile: VoiceOver hint")
    static let bankNote = NSLocalizedString(
        "This is your bank’s balance when the app last synced. It may include pending items, so compare it with the closing balance printed on your statement.",
        comment: "Native Reconcile: the source note")
    static let bankSyncSettings = NSLocalizedString("Bank sync settings ›", comment: "Native Reconcile: link to Bank Sync settings")
    static let restore = NSLocalizedString("Restore bank balance (%@)", comment: "Native Reconcile: undo an edit")
    static let enterHint = NSLocalizedString("Enter the closing balance from your statement.", comment: "Native Reconcile: no source hint")
    static let useStale = NSLocalizedString("Use bank balance from %@ (%@)", comment: "Native Reconcile: a stale bank balance")
    static let unknownDate = NSLocalizedString("an unknown date", comment: "Native Reconcile: a bank balance with no date")
    static let useCleared = NSLocalizedString("Use cleared balance (%@)", comment: "Native Reconcile: choose the cleared balance")
    static let clearedCaveat = NSLocalizedString(
        "Your own cleared total — not an independent check", comment: "Native Reconcile: the cleared balance caveat")
    static let lastReconciled = NSLocalizedString("Last reconciled %@.", comment: "Native Reconcile: step 1 footer")
    static let notYetReconciled = NSLocalizedString("Not yet reconciled.", comment: "Native Reconcile: step 1 footer")
    static let confirmBalance = NSLocalizedString("Confirm balance", comment: "Native Reconcile: step 1 confirm")
    static let enterFirst = NSLocalizedString("Enter a balance first.", comment: "Native Reconcile: VoiceOver hint on a dimmed Confirm")
    static let clearedNoteTitle = NSLocalizedString("Saved from your cleared balance", comment: "Native Reconcile: cleared note title")
    static let clearedNote = NSLocalizedString(
        "The cleared balance is the app’s own figure, not a statement, so an assistant cannot use it to reconcile. Enter your statement’s balance to let it. You can still reconcile yourself.",
        comment: "Native Reconcile: the fixed cleared note (D3)")
    static let continueButton = NSLocalizedString("Continue", comment: "Native Reconcile: dismiss the cleared note")
    static let show = NSLocalizedString("Show", comment: "Native Reconcile: step 2 row filter")
    static let toTick = NSLocalizedString("To tick", comment: "Native Reconcile: uncleared rows up to today")
    static let all = NSLocalizedString("All", comment: "Native Reconcile: every row of the period")
    static let findAmount = NSLocalizedString("Find amount", comment: "Native Reconcile: search rows by amount")
    static let tapHint = NSLocalizedString("Tap a row when it’s on your statement", comment: "Native Reconcile: step 2 hint")
    static let statement = NSLocalizedString("Statement", comment: "Native Reconcile: summary figure")
    static let cleared = NSLocalizedString("Cleared", comment: "Native Reconcile: summary figure")
    static let difference = NSLocalizedString("Difference", comment: "Native Reconcile: summary figure")
    static let balanced = NSLocalizedString("Balanced", comment: "Native Reconcile: summary figure at a zero difference")
    static let markCleared = NSLocalizedString("Mark cleared", comment: "Native Reconcile: swipe action")
    static let markNotCleared = NSLocalizedString("Mark not cleared", comment: "Native Reconcile: swipe action")
    static let hintMark = NSLocalizedString("Double-tap to mark cleared", comment: "Native Reconcile: VoiceOver row hint")
    static let hintUnmark = NSLocalizedString("Double-tap to mark not cleared", comment: "Native Reconcile: VoiceOver row hint")
    static let editTransaction = NSLocalizedString("Edit transaction", comment: "Native Reconcile: row action")
    static let readyToLock = NSLocalizedString("Ready to lock — finish in the register", comment: "Native Reconcile: step 2 exit at 0.00")
    static let doneForNow = NSLocalizedString("Done for now", comment: "Native Reconcile: step 2 exit above zero")
    static let tryAgain = NSLocalizedString("Try again", comment: "Native Reconcile: retry a failed read")
}
