import SwiftUI
import UIKit

// Fork-only (sc-3751, native-budget-screen spec). The read-only native Budget
// tab: a month of an envelope or tracking budget. Every number is a loot-core
// cell, read through native/budget-month and shown as it came; this file adds
// nothing up. The writes are a category's budgeted amount (sc-3769) and a move
// of money on an envelope month (sc-3787), sent through the view model to
// loot-core. NativeTabBarController lays it over the web
// Budget screen while the switch is on, so the web view stays in the window.
final class NativeBudgetViewController: UIHostingController<BudgetTabView> {
    private let model: BudgetViewModel
    private var lifecycleObservers: [NSObjectProtocol] = []

    init(client: NativeBridgeClient) {
        model = BudgetViewModel(client: client)
        super.init(rootView: BudgetTabView(model: model))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The page's change events (NativeBridgePlugin.onEvent) end here
    func changeEventReceived() { model.changeEventReceived() }

    // The page bridge's "ready" message, after the inbound origin guard (sc-3859)
    func pageReady() {
        Task { await model.pageReady() }
    }

    // The tab also re-reads each time it shows
    func reload() {
        Task { await model.load() }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Opaque, so the web Budget screen under it never shows through, and
        // modal, so VoiceOver skips that web view while this screen shows
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
        let center = NotificationCenter.default
        for (name, active) in [(UIApplication.didBecomeActiveNotification, true), (UIApplication.willResignActiveNotification, false)] {
            lifecycleObservers.append(
                center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    guard let model = self?.model else { return }
                    Task { await model.setSceneActive(active) }
                })
        }
    }

    deinit { for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) } }
}

struct BudgetTabView: View {
    @ObservedObject var model: BudgetViewModel
    @State private var editing: BudgetMonth.Category?
    // The month the edit was opened on; the save is refused if it changed
    @State private var editingMonth = ""
    // The month the Move money sheet was opened on (sc-3787)
    @State private var moving: BudgetMonth?
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        NavigationView {
            content
                // Pull to refresh (sc-3884): the spinner shows until the sync and the re-read end
                .refreshable { await model.refresh() }
                .navigationBarTitle(Text(monthTitle), displayMode: .large)
                .toolbar { monthControls }
                .toolbar { moveControl }
                // Its own view, so it never competes with the edit sheet below
                .sheet(isPresented: Binding(get: { moving != nil }, set: { if !$0 { moving = nil } })) {
                    if let moving { MoveMoneySheet(model: model, month: moving) }
                }
        }
        .navigationViewStyle(.stack)
        .task { await model.load() }
        .onChange(of: model.refreshError) { error in
            if let error { UIAccessibility.post(notification: .announcement, argument: error.message) }
        }
        .sheet(item: $editing) { category in
            if case .loaded(let month) = model.state {
                EditBudgetedSheet(model: model, month: editingMonth, category: category, style: month.amountStyle)
            }
        }
        // A failure after the sheet closed (the save landed, the refresh did not)
        .alert(isPresented: Binding(get: { editing == nil && moving == nil && model.saveError != nil }, set: { _ in model.clearSaveError() })) {
            Alert(title: Text(verbatim: model.saveError?.message ?? ""))
        }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(Text(Words.loading))
        case .loaded(let month):
            BudgetMonthList(month: month, onEdit: { (editingMonth, editing) = (month.month, $0) })
        case .stale(let month, let error):
            // The last good numbers, dimmed, with the reason and a retry; not editable.
            // After a failed pull, the pull's fixed message, and the retry pulls again.
            VStack(spacing: 0) {
                Group {
                    if let refreshError = model.refreshError { refreshMessage(refreshError) } else { errorMessage(error) }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.secondarySystemGroupedBackground))
                BudgetMonthList(month: month).opacity(contrast == .increased ? 0.75 : 0.5)
            }
        case .failed(let error):
            errorMessage(error)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func refreshMessage(_ error: BudgetRefreshError) -> some View {
        VStack(spacing: 12) {
            Text(verbatim: error.message).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            // A timed-out sync is still running and updates the screen itself
            if error != .timedOut {
                Button(NSLocalizedString("Retry", comment: "Native Budget tab: try loading again")) {
                    Task { await model.refresh() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private func errorMessage(_ error: BudgetLoadError) -> some View {
        VStack(spacing: 12) {
            Text(verbatim: error.message).multilineTextAlignment(.center)
            if error.canRetry {
                Button(NSLocalizedString("Retry", comment: "Native Budget tab: try loading again")) {
                    Task { await model.load() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    // Previous, picker and next (sc-3760); the view model decides what is reachable
    @ToolbarContentBuilder private var monthControls: some ToolbarContent {
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            Button {
                Task { await model.previous() }
            } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(!model.canGoPrevious)
            .accessibilityLabel(Text(NSLocalizedString("Previous month", comment: "Native Budget tab: month navigation")))
            Menu {
                let marked = model.markedPickerMonth  // once, not per row
                ForEach(model.pickerMonths.reversed(), id: \.self) { month in
                    Button {
                        Task { await model.select(month) }
                    } label: {
                        if month == marked {
                            Label(Self.title(of: month), systemImage: "checkmark")
                        } else {
                            Text(Self.title(of: month))
                        }
                    }
                    .accessibilityAddTraits(month == marked ? .isSelected : [])
                }
            } label: {
                Image(systemName: "calendar")
            }
            .accessibilityLabel(Text(NSLocalizedString("Choose month", comment: "Native Budget tab: month picker")))
            Button {
                Task { await model.next() }
            } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(!model.canGoNext)
            .accessibilityLabel(Text(NSLocalizedString("Next month", comment: "Native Budget tab: month navigation")))
        }
    }

    // Envelope months only: the view model refuses a tracking month, so it is not offered there
    @ToolbarContentBuilder private var moveControl: some ToolbarContent {
        ToolbarItem(placement: .navigationBarLeading) {
            if model.canMoveMoney, case .loaded(let month) = model.state {
                Button { moving = month } label: { Image(systemName: "arrow.left.arrow.right") }
                    .accessibilityLabel(Text(Words.moveMoney))
            }
        }
    }

    private var monthTitle: String { Self.title(of: model.month) }

    private static func title(of month: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: month) else { return month }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return formatter.string(from: date)
    }
}

private enum Words {
    static let toBudget = NSLocalizedString("To budget", comment: "Native Budget tab: money not yet given a category")
    static let budgeted = NSLocalizedString("Budgeted", comment: "Native Budget tab column")
    static let spent = NSLocalizedString("Spent", comment: "Native Budget tab column")
    static let received = NSLocalizedString("Received", comment: "Native Budget tab: income column")
    static let balance = NSLocalizedString("Balance", comment: "Native Budget tab column")
    static let editHint = NSLocalizedString("Edits the budgeted amount", comment: "Native Budget tab: VoiceOver hint on the budgeted amount")
    static let save = NSLocalizedString("Save", comment: "Native Budget tab: save an edited amount")
    static let cancel = NSLocalizedString("Cancel", comment: "Native Budget tab: close the edit sheet")
    static let budgetedIncome = NSLocalizedString("Budgeted income", comment: "Native Budget tab: tracking budget summary")
    static let income = NSLocalizedString("Income", comment: "Native Budget tab: tracking budget summary")
    static let budgetedExpenses = NSLocalizedString("Budgeted expenses", comment: "Native Budget tab: tracking budget summary")
    static let expenses = NSLocalizedString("Expenses", comment: "Native Budget tab: tracking budget summary")
    static let saved = NSLocalizedString("Saved", comment: "Native Budget tab: tracking budget summary")
    static let overspent = NSLocalizedString("Overspent", comment: "Native Budget tab: a negative balance")
    static let loading = NSLocalizedString("Loading", comment: "Native Budget tab: VoiceOver label on the loading spinner")
    static let moveMoney = NSLocalizedString("Move money", comment: "Native Budget tab: move money between categories and to-budget")
    static let move = NSLocalizedString("Move", comment: "Native Move money sheet: confirm the move")
    static let from = NSLocalizedString("From", comment: "Native Move money sheet: the source")
    static let to = NSLocalizedString("To", comment: "Native Move money sheet: the destination")
    static let amount = NSLocalizedString("Amount", comment: "Native Move money sheet: the amount to move")
}

// A save error shows in the sheet's footer; VoiceOver is told when it appears
private func announce(_ message: String?) {
    if let message { UIAccessibility.post(notification: .announcement, argument: message) }
}

// DESIGN.native.md money colours (light, dark)
private func moneyColor(_ tone: BudgetAmountFormat.Tone) -> Color {
    func color(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
    switch tone {
    case .positive: return color(0x1F7A35, 0x30D158)
    case .negative: return color(0xC00013, 0xFF7B73)
    case .zero: return color(0x636366, 0xAEAEB2)
    }
}

// A title and one amount: side by side, stacked at the accessibility text sizes
// so the amount wraps instead of truncating. One VoiceOver element.
private struct AmountRow: View {
    let title: String
    let amount: String
    let tone: BudgetAmountFormat.Tone
    var isHeadline = false
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        Group {
            if sizeCategory.isAccessibilityCategory {
                VStack(alignment: .leading, spacing: 2) { texts }
            } else {
                HStack { texts }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(amount))
    }

    @ViewBuilder private var texts: some View {
        Text(title).font(isHeadline ? .headline : .body)
        if !sizeCategory.isAccessibilityCategory { Spacer() }
        Text(amount).font(isHeadline ? .headline : .body).monospacedDigit().foregroundColor(moneyColor(tone))
    }
}

private struct BudgetMonthList: View {
    let month: BudgetMonth
    var onEdit: ((BudgetMonth.Category) -> Void)?

    var body: some View {
        List {
            if let toBudget = month.totals.toBudget {
                Section {
                    AmountRow(title: Words.toBudget, amount: format(toBudget), tone: BudgetAmountFormat.tone(toBudget), isHeadline: true)
                }
            }
            // A tracking budget has no to-budget: its totals as loot-core computed them
            if month.budgetType == .tracking {
                Section {
                    ForEach([
                        (Words.budgetedIncome, month.totals.budgetedIncome), (Words.income, month.totals.income),
                        (Words.budgetedExpenses, month.totals.budgeted), (Words.expenses, month.totals.spent),
                        (month.totals.saved.map(BudgetBalance.savedIsOverspent) == true ? Words.overspent : Words.saved, month.totals.saved),
                    ], id: \.0) { title, amount in
                        if let amount {
                            AmountRow(title: title, amount: format(amount), tone: BudgetAmountFormat.tone(amount), isHeadline: title == Words.saved || title == Words.overspent)
                        }
                    }
                }
            }
            ForEach(month.expenseGroups) { group in
                groupSection(group)
            }
            ForEach(month.incomeGroups) { group in
                groupSection(group)
            }
        }
        .listStyle(.insetGrouped)
    }

    private func groupSection(_ group: BudgetMonth.Group) -> some View {
        Section(header: GroupHeader(group: group, style: month.amountStyle)) {
            ForEach(group.visibleCategories) { category in
                CategoryRow(
                    category: category, isIncome: group.isIncome, canEditIncome: month.budgetType == .tracking, style: month.amountStyle,
                    onEdit: onEdit)
            }
        }
    }

    private func format(_ amount: Int?) -> String {
        BudgetAmountFormat.string(amount, style: month.amountStyle)
    }
}

// The group's own totals, as loot-core computed them; nothing is added here
private struct GroupHeader: View {
    let group: BudgetMonth.Group
    let style: BudgetAmountStyle
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(group.name)
            // Only the totals loot-core has for this group (an income group has no budgeted or balance)
            let parts = [(Words.budgeted, group.budgeted), (group.isIncome ? Words.received : Words.spent, group.spent), (Words.balance, BudgetBalance.shown(group.balance, isIncome: group.isIncome))]
                .compactMap { title, amount in amount.map { "\(title) \(BudgetAmountFormat.string($0, style: style))" } }
            if !parts.isEmpty {
                // One part per line at the accessibility sizes, so none is cut mid-amount
                Text(verbatim: parts.joined(separator: sizeCategory.isAccessibilityCategory ? "\n" : "  "))
                    .font(.caption2).monospacedDigit().textCase(nil)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: group.name))
        .accessibilityValue(
            Text(verbatim: BudgetSpeech.value(budgeted: group.budgeted, spent: group.spent, balance: group.balance, isIncome: group.isIncome, style: style))
        )
        .accessibilityAddTraits(.isHeader)
    }
}

private struct CategoryRow: View {
    let category: BudgetMonth.Category
    let isIncome: Bool
    // A tracking budget holds budgeted income; an envelope budget does not
    let canEditIncome: Bool
    let style: BudgetAmountStyle
    let onEdit: ((BudgetMonth.Category) -> Void)?
    @Environment(\.sizeCategory) private var sizeCategory

    private var editAction: (() -> Void)? {
        guard category.budgeted != nil, !isIncome || canEditIncome, let onEdit else { return nil }
        return { onEdit(category) }
    }

    // The activate action exists only when the amount can be edited
    @ViewBuilder var body: some View {
        if let editAction { row.accessibilityAction(.default, editAction) } else { row }
    }

    private var row: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(category.name)
            // Side by side, stacked at the accessibility sizes so no amount is cut
            if sizeCategory.isAccessibilityCategory {
                VStack(alignment: .leading, spacing: 6) { columns }
            } else {
                HStack(alignment: .top) { columns }
            }
        }
        .padding(.vertical, 2)
        .fixedSize(horizontal: false, vertical: true)
        // One element: the name, then the amounts; a button when the amount can be edited
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: category.name))
        .accessibilityValue(
            Text(
                verbatim: BudgetSpeech.value(
                    budgeted: category.budgeted, spent: category.spent, balance: category.balance, isIncome: isIncome, style: style)))
        .accessibilityHint(Text(editAction == nil ? "" : Words.editHint))
        .accessibilityAddTraits(editAction == nil ? [] : .isButton)
    }

    @ViewBuilder private var columns: some View {
        if category.budgeted != nil {
            if let editAction {
                // Tap the budgeted amount to type a new one
                Button(action: editAction) { column(Words.budgeted, category.budgeted) }
                    .buttonStyle(.plain)
            } else {
                column(Words.budgeted, category.budgeted)
            }
        }
        column(isIncome ? Words.received : Words.spent, category.spent)
        if let balance = BudgetBalance.shown(category.balance, isIncome: isIncome) { column(Words.balance, balance, colored: true) }
    }

    private func format(_ amount: Int?) -> String { BudgetAmountFormat.string(amount, style: style) }

    private func column(_ title: String, _ amount: Int?, colored: Bool = false) -> some View {
        let tone = BudgetAmountFormat.tone(amount)
        return VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption2).foregroundColor(.secondary)
            Text(format(amount).isEmpty ? "-" : format(amount)).font(.footnote).monospacedDigit()
                .foregroundColor(colored ? moneyColor(tone) : .primary)
            // The word, never colour alone
            if colored, tone == .negative {
                Text(Words.overspent).font(.caption2).foregroundColor(moneyColor(.negative))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Types a category's budgeted amount. The text becomes minor units in the view
// model, from the snapshot's currency; nothing is computed here.
private struct EditBudgetedSheet: View {
    @ObservedObject var model: BudgetViewModel
    let month: String
    let category: BudgetMonth.Category
    let style: BudgetAmountStyle
    @State private var text: String
    @Environment(\.presentationMode) private var presentation

    init(model: BudgetViewModel, month: String, category: BudgetMonth.Category, style: BudgetAmountStyle) {
        self.model = model
        self.month = month
        self.category = category
        self.style = style
        _text = State(initialValue: BudgetAmountFormat.editString(category.budgeted ?? 0, style: style))
    }

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text(category.name), footer: error) {
                    TextField(Words.budgeted, text: $text)
                        .keyboardType(.numbersAndPunctuation)
                        .monospacedDigit()
                        .accessibilityLabel(Text(verbatim: "\(Words.budgeted) \(category.name)"))
                }
            }
            .navigationBarTitle(Text(Words.budgeted), displayMode: .inline)
            .navigationBarItems(
                leading: Button(Words.cancel) { close() },
                trailing: Button(Words.save) { Task { await save() } }.disabled(model.isSaving))
        }
        .navigationViewStyle(.stack)
        .onAppear { model.clearSaveError() }
        .onChange(of: model.saveError?.message) { announce($0) }
    }

    @ViewBuilder private var error: some View {
        if let saveError = model.saveError {
            Text(verbatim: saveError.message).foregroundColor(moneyColor(.negative))
        }
    }

    private func save() async {
        if await model.saveBudgeted(month: month, category: category.id, text: text) {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            close()
        }
    }

    private func close() {
        model.clearSaveError()
        presentation.wrappedValue.dismiss()
    }
}

// Moves money between to-budget and the visible expense categories of an
// envelope month. The view model checks the move and sends it; the sheet only
// shows the limit loot-core's numbers give (sc-3787).
private struct MoveMoneySheet: View {
    @ObservedObject var model: BudgetViewModel
    let month: BudgetMonth
    @State private var from: MoveEnd = .toBudget
    @State private var to: MoveEnd
    @State private var text: String
    @Environment(\.presentationMode) private var presentation

    init(model: BudgetViewModel, month: BudgetMonth) {
        self.model = model
        self.month = month
        let first = month.expenseGroups.flatMap(\.visibleCategories).first
        _to = State(initialValue: first.map { .category($0.id) } ?? .toBudget)
        _text = State(initialValue: model.movePrefill(from: .toBudget))
    }

    private var ends: [(MoveEnd, String)] {
        [(.toBudget, Words.toBudget)] + month.expenseGroups.flatMap(\.visibleCategories).map { (.category($0.id), $0.name) }
    }

    var body: some View {
        NavigationView {
            Form {
                Section(footer: footer) {
                    picker(Words.from, $from)
                    picker(Words.to, $to)
                    TextField(Words.amount, text: $text)
                        .keyboardType(.numbersAndPunctuation)
                        .monospacedDigit()
                        .accessibilityLabel(Text(Words.amount))
                        .accessibilityHint(Text(verbatim: model.moveLimitMessage(from: from)))
                }
            }
            .navigationBarTitle(Text(Words.moveMoney), displayMode: .inline)
            .navigationBarItems(
                leading: Button(Words.cancel) { close() },
                trailing: Button(Words.move) { Task { await move() } }
                    .disabled(model.isSaving || !model.canConfirmMove(from: from, to: to, text: text)))
        }
        .navigationViewStyle(.stack)
        .onAppear { model.clearSaveError() }
        // A new source: start again from all it holds
        .onChange(of: from) { text = model.movePrefill(from: $0) }
        .onChange(of: model.saveError?.message) { announce($0) }
    }

    private func picker(_ title: String, _ selection: Binding<MoveEnd>) -> some View {
        Picker(title, selection: selection) {
            ForEach(ends, id: \.0) { end, name in Text(verbatim: name).tag(end) }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: model.moveLimitMessage(from: from))
            if let saveError = model.saveError {
                Text(verbatim: saveError.message).foregroundColor(moneyColor(.negative))
            }
        }
    }

    private func move() async {
        if await model.moveMoney(month: month.month, from: from, to: to, text: text) {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            close()
        }
    }

    private func close() {
        model.clearSaveError()
        presentation.wrappedValue.dismiss()
    }
}
