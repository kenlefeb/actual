import SwiftUI
import UIKit

// Fork-only (sc-4343, native-paychecks-screen spec). The iPhone paycheck
// editor: a full-height sheet with ✕ and ✓ (Ken, 2026-11-14), the web
// editor's sections in its order, each collapsible, and net pay pinned. Every
// number, date and error comes from loot-core through PaycheckEditorViewModel
// (ADR 11). A paycheck's own schedules are never offered here: they are
// edited only through the paycheck (removing a deposit removes its schedule).
struct PaycheckEditorRequest: Identifiable {
    // nil adds a paycheck
    let paycheckId: String?
    var id: String { paycheckId ?? "new" }
}

struct PaycheckEditorSheet: View {
    @StateObject private var model: PaycheckEditorViewModel
    let style: BudgetAmountStyle
    @Environment(\.presentationMode) private var presentation
    @Environment(\.sizeCategory) private var sizeCategory
    @State private var alert: EditorAlert?
    @State private var expanded: Set<PaycheckEditorViewModel.Field>

    init(
        request: PaycheckEditorRequest, client: NativeBridgeClient, style: BudgetAmountStyle,
        onWrite: @escaping (PaychecksUndoOffer) -> Void,
        onPending: @escaping (String, @escaping () async -> Bool) -> Void = { _, _ in }
    ) {
        _model = StateObject(
            wrappedValue: PaycheckEditorViewModel(
                client: client, paycheckId: request.paycheckId, today: EditorDates.today(), onWrite: onWrite, onPending: onPending))
        self.style = style
        // A new paycheck starts open; an existing one starts as summaries, as the web
        _expanded = State(initialValue: request.paycheckId == nil ? Set(PaycheckEditorViewModel.Field.allCases) : [])
    }

    private enum EditorAlert: Identifiable {
        case discard, delete, error(String)
        var id: String {
            switch self {
            case .discard: "discard"
            case .delete: "delete"
            case .error(let message): "error-\(message)"
            }
        }
    }

    var body: some View {
        NavigationView {
            content
                .navigationBarTitle(Text(model.isNew ? EditorWords.addTitle : EditorWords.editTitle), displayMode: .inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(action: cancel) { Image(systemName: "xmark") }
                            .accessibilityLabel(Text(EditorWords.cancel))
                            .keyboardShortcut(.cancelAction)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: save) {
                            if model.isSaving { ProgressView() } else { Image(systemName: "checkmark").font(.body.weight(.semibold)) }
                        }
                        .accessibilityLabel(Text(EditorWords.save))
                        .disabled(!model.canSave)
                        .keyboardShortcut(.defaultAction)
                    }
                }
        }
        .navigationViewStyle(.stack)
        .tint(PaychecksTokens.skipConfirm)
        // Swiping down never drops unsaved changes
        .interactiveDismissDisabled(model.hasChanges || model.isSaving || model.isDeleting)
        .task { await model.start() }
        .onChange(of: model.announcement) { message in
            if let message { UIAccessibility.post(notification: .announcement, argument: message) }
        }
        .onChange(of: model.actionError) { message in
            if let message { alert = .error(message) }
        }
        // One alert for the sheet, so the confirmations and an error never compete
        .alert(alertTitle, isPresented: isAlertShown, presenting: alert) { alert in
            switch alert {
            case .discard:
                Button(EditorWords.keepEditing, role: .cancel) {}
                Button(EditorWords.discard, role: .destructive) { close() }
            case .delete:
                Button(EditorWords.keepIt, role: .cancel) {}
                // Undoable for a while after, so the normal teal accent (Ken)
                Button(EditorWords.deleteIt) {
                    Task { if await model.delete() { close() } }
                }
            case .error:
                Button(EditorWords.ok, role: .cancel) { model.clearActionError() }
            }
        } message: { alert in
            switch alert {
            case .discard: Text(EditorWords.discardMessage)
            case .delete: Text(String(format: EditorWords.deleteMessage, model.draft.name))
            case .error: EmptyView()
            }
        }
    }

    private var alertTitle: String {
        switch alert {
        case .discard: EditorWords.discardTitle
        case .delete: EditorWords.deleteTitle
        case .error(let message): message
        case nil: ""
        }
    }

    private var isAlertShown: Binding<Bool> {
        Binding(get: { alert != nil }, set: { if !$0 { alert = nil } })
    }

    private func cancel() {
        if model.hasChanges { alert = .discard } else { close() }
    }

    private func save() {
        Task { if await model.save() { close() } }
    }

    private func close() { presentation.wrappedValue.dismiss() }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityLabel(Text(EditorWords.loading))
        case .failed(let error):
            VStack(spacing: 12) {
                Text(verbatim: error.message).multilineTextAlignment(.center)
                Button(EditorWords.retry) { Task { await model.start() } }.buttonStyle(.borderedProminent)
            }
            .padding()
        case .gone:
            Text(EditorWords.gone).foregroundColor(.secondary).padding()
        case .ready:
            form.safeAreaInset(edge: .bottom) { netPay }
        }
    }

    // Pinned at every text size; the incoming-only money colour. Stacked at
    // the accessibility sizes, so the amount never breaks across lines.
    @ViewBuilder private var netPay: some View {
        let label = Text(EditorWords.netPay).font(.headline)
        let amount = Text(model.preview.map { PaycheckDateText.incoming($0.netAmount, style: style) } ?? "—")
            .font(.headline).monospacedDigit().foregroundColor(Money.positive)
            .lineLimit(1).minimumScaleFactor(0.5)
        Group {
            if sizeCategory.isAccessibilityCategory {
                VStack(alignment: .leading, spacing: 2) {
                    label
                    amount
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack {
                    label
                    Spacer(minLength: 8)
                    amount
                }
            }
        }
        .padding()
        .background(.regularMaterial)
        .accessibilityElement(children: .combine)
    }

    private var form: some View {
        Form {
            section(.name, title: EditorWords.details, summary: [model.draft.name, model.preview?.employerName ?? ""]) {
                TextField(EditorWords.name, text: binding(\.name))
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                optionPicker(
                    EditorWords.employer, selection: binding(\.definition.payee), none: EditorWords.noEmployer,
                    options: model.options.payees.map { ($0.id, $0.name) })
            }
            section(.clearingAccount, title: EditorWords.clearingAndDates, summary: [clearingSummary, nextPaySummary]) {
                clearingFields
                payDateFields
            }
            section(.grossPay, title: EditorWords.grossPay, summary: [money(model.draft.definition.grossAmount)]) {
                AmountField(label: EditorWords.grossPay, value: binding(\.definition.grossAmount), style: style)
                optionPicker(
                    EditorWords.incomeCategory, selection: binding(\.definition.incomeCategory), none: EditorWords.noCategory,
                    options: model.options.categories.filter(\.is_income).map { ($0.id, $0.name) })
            }
            section(.deductions, title: EditorWords.deductions, summary: [deductionSummary]) {
                deductionFields
            }
            section(.deposits, title: EditorWords.deposits, summary: [depositSummary]) {
                depositFields
            }
            if !model.isNew { yearToDate }
            if !model.isNew {
                Section {
                    Button(EditorWords.deletePaycheck, role: .destructive) { alert = .delete }
                        .disabled(model.isSaving || model.isDeleting)
                }
            }
        }
    }

    // A collapsible section: its title, a summary while closed, and its errors
    // next to it, always shown, so a closed section never hides one
    private func section<Content: View>(
        _ field: PaycheckEditorViewModel.Field, title: String, summary: [String], @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        let errorField: PaycheckEditorViewModel.Field = field == .grossPay ? .deductions : field
        let errors = field == .grossPay ? [] : model.errors(for: errorField)
        return Section {
            DisclosureGroup(
                isExpanded: Binding(
                    get: { expanded.contains(field) },
                    set: { if $0 { expanded.insert(field) } else { expanded.remove(field) } })
            ) {
                content()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).foregroundColor(.primary)
                    let text = summary.filter { !$0.isEmpty }.joined(separator: " · ")
                    if !expanded.contains(field), !text.isEmpty {
                        Text(text).font(.subheadline).foregroundColor(.secondary).monospacedDigit()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            ForEach(errors, id: \.self) { error in
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .foregroundColor(Color(.systemRed))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(EditorWords.errorPrefix + error))
            }
        }
    }

    // MARK: Clearing account and pay dates

    @ViewBuilder private var clearingFields: some View {
        if model.isNew {
            Picker(EditorWords.clearingAccount, selection: binding(\.isNewAccount)) {
                Text(EditorWords.newClearing).tag(true)
                Text(EditorWords.existingAccount).tag(false)
            }
            if model.draft.isNewAccount {
                TextField(
                    model.defaultClearingName.isEmpty ? EditorWords.newClearingPlaceholder : model.defaultClearingName,
                    text: binding(\.newClearingAccountName)
                )
                .accessibilityLabel(Text(EditorWords.newClearingName))
            } else {
                accountPicker(EditorWords.existingClearing, selection: binding(\.definition.clearingAccount))
            }
        } else {
            accountPicker(EditorWords.clearingAccount, selection: binding(\.definition.clearingAccount))
        }
    }

    @ViewBuilder private var payDateFields: some View {
        let date = model.draft.definition.date
        Picker(EditorWords.frequency, selection: binding(\.definition.date.frequency)) {
            ForEach(EditorWords.frequencies, id: \.0) { Text($0.1).tag($0.0) }
        }
        Stepper(
            String(format: EditorWords.every, date.interval ?? 1, EditorWords.unit(date.frequency, date.interval ?? 1)),
            value: Binding(get: { date.interval ?? 1 }, set: { value in model.update { $0.definition.date.interval = value } }),
            in: 1...99)
        DatePicker(
            EditorWords.startDate,
            selection: Binding(
                get: { EditorDates.date(date.start) ?? Date() },
                set: { value in model.update { $0.definition.date.start = EditorDates.day(value) } }),
            displayedComponents: .date)
        if date.frequency == "monthly" { payDays(date) }
        Picker(EditorWords.weekendMove, selection: binding(\.definition.weekendSolveMode)) {
            Text(EditorWords.before).tag("before")
            Text(EditorWords.after).tag("after")
        }
        if let next = model.preview?.payDate {
            Text(String(format: EditorWords.nextPaycheck, EditorDates.long(next))).font(.body.weight(.semibold))
        }
        // Ends are edited on the web; shown so a paycheck that ends never looks open-ended
        if let end = PaycheckDateText.end(model.draft.definition.date) {
            Text(end).font(.subheadline).foregroundColor(.secondary)
        }
    }

    // A monthly paycheck's days: the web's day patterns. Other patterns (a
    // weekday of the month) are kept as they are and shown, not edited here.
    @ViewBuilder private func payDays(_ date: PaycheckDefinition.RecurConfig) -> some View {
        let patterns = date.patterns ?? []
        ForEach(Array(patterns.enumerated()), id: \.offset) { index, pattern in
            if pattern.type == "day" {
                HStack {
                    Picker(
                        String(format: EditorWords.payDay, index + 1),
                        selection: Binding(
                            get: { pattern.value },
                            set: { value in model.update { $0.definition.date.patterns?[index].value = value } })
                    ) {
                        ForEach(Array(1...31) + [-1], id: \.self) { day in
                            Text(day == -1 ? EditorWords.lastDay : String(day)).tag(day)
                        }
                    }
                    Button {
                        model.update { $0.definition.date.patterns?.remove(at: index) }
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Text(String(format: EditorWords.removePayDay, index + 1)))
                }
            } else {
                Text(PaycheckDateText.pattern(pattern) ?? "").foregroundColor(.secondary)
            }
        }
        Button(EditorWords.addPayDay) {
            model.update { $0.definition.date.patterns = ($0.definition.date.patterns ?? []) + [.init(value: 1, type: "day")] }
        }
        .buttonStyle(.borderless)
    }

    // MARK: Deductions

    @ViewBuilder private var deductionFields: some View {
        ForEach(Array(model.draft.definition.deductions.enumerated()), id: \.element.id) { index, deduction in
            let number = index + 1
            VStack(alignment: .leading, spacing: 8) {
                TextField(EditorWords.name, text: deductionBinding(deduction, \.name))
                    .accessibilityLabel(Text(String(format: EditorWords.deductionName, number)))
                AmountField(
                    label: String(format: EditorWords.deductionAmount, number), value: deductionBinding(deduction, \.amount), style: style)
                Picker(
                    String(format: EditorWords.deductionGoesTo, number),
                    selection: Binding(
                        get: { deduction.isTransfer },
                        set: { isTransfer in model.update { $0.definition.deductions.write(deduction.id, \.transferAccount, isTransfer ? "" : nil) } })
                ) {
                    Text(EditorWords.category).tag(false)
                    Text(EditorWords.transfer).tag(true)
                }
                if deduction.isTransfer {
                    accountPicker(
                        String(format: EditorWords.deductionTransfer, number),
                        selection: Binding(
                            get: { deduction.transferAccount ?? "" },
                            set: { value in model.update { $0.definition.deductions.write(deduction.id, \.transferAccount, value) } }))
                }
                optionPicker(
                    String(format: EditorWords.deductionCategory, number), selection: deductionBinding(deduction, \.category),
                    none: EditorWords.noCategory, options: model.options.categories.filter { !$0.is_income }.map { ($0.id, $0.name) })
                Button(EditorWords.remove, role: .destructive) {
                    model.update { $0.definition.deductions.remove(at: index) }
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text(String(format: EditorWords.removeDeduction, number)))
            }
            .padding(.vertical, 4)
        }
        Button(EditorWords.addDeduction) {
            model.update { $0.definition.deductions.append(.init(id: UUID().uuidString, name: "", amount: 0, category: nil)) }
        }
        .buttonStyle(.borderless)
    }

    // MARK: Direct deposits

    @ViewBuilder private var depositFields: some View {
        ForEach(Array(model.draft.definition.deposits.enumerated()), id: \.element.id) { index, deposit in
            let number = index + 1
            let answer = model.preview?.deposits.first { $0.id == deposit.id }
            VStack(alignment: .leading, spacing: 8) {
                accountPicker(String(format: EditorWords.depositAccount, number), selection: depositBinding(deposit, \.account))
                Picker(
                    String(format: EditorWords.depositKind, number),
                    selection: Binding(
                        get: { deposit.kind },
                        set: { kind in
                            model.update {
                                $0.definition.deposits[index].kind = kind
                                $0.definition.deposits[index].value = 0
                            }
                        })
                ) {
                    Text(EditorWords.fixed).tag("fixed")
                    Text(EditorWords.percent).tag("percent")
                    Text(EditorWords.remainder).tag("remainder")
                }
                if deposit.kind == "fixed" {
                    AmountField(
                        label: String(format: EditorWords.depositFixed, number),
                        value: Binding(
                            get: { Int(deposit.value) },
                            set: { value in model.update { $0.definition.deposits[index].value = Double(value) } }),
                        style: style)
                } else if deposit.kind == "percent" {
                    PercentField(
                        label: String(format: EditorWords.depositPercent, number),
                        value: Binding(
                            get: { deposit.value },
                            set: { value in model.update { $0.definition.deposits[index].value = value } }))
                }
                if let answer {
                    HStack {
                        Text(answer.date.map(EditorDates.medium) ?? "")
                        Spacer()
                        Text(PaycheckDateText.incoming(answer.amount, style: style)).monospacedDigit()
                            .foregroundColor(Money.positive)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        Text(String(format: EditorWords.depositAmount, number) + ", " + PaycheckDateText.incoming(answer.amount, style: style)))
                }
                Toggle(
                    EditorWords.postAutomatically,
                    isOn: Binding(
                        get: { deposit.postAutomatically ?? false },
                        set: { value in model.update { $0.definition.deposits[index].postAutomatically = value } }))
                if deposit.postAutomatically == true {
                    Text(EditorWords.postNote).font(.footnote).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let saved = answer?.savedDaysEarly, !deposit.account.isEmpty {
                    let days = model.draft.daysEarly[deposit.account] ?? saved
                    Stepper(
                        String(format: EditorWords.daysEarly, days),
                        value: Binding(get: { days }, set: { model.setDaysEarly($0, for: deposit.account) }),
                        in: PaycheckSave.daysEarlyRange)
                    Text(String(format: EditorWords.calendar, answer?.calendarName ?? EditorWords.weekendsOnly))
                        .font(.footnote).foregroundColor(.secondary)
                    if days != saved {
                        Text(String(format: EditorWords.appliesToEvery, model.options.accountName(deposit.account) ?? ""))
                            .font(.footnote).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button(EditorWords.remove, role: .destructive) {
                    model.update { $0.definition.deposits.remove(at: index) }
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text(String(format: EditorWords.removeDeposit, number)))
            }
            .padding(.vertical, 4)
        }
        Button(EditorWords.addDeposit) {
            model.update { $0.definition.deposits.append(.init(id: UUID().uuidString, account: "", kind: "fixed", value: 0)) }
        }
        .buttonStyle(.borderless)
    }

    // MARK: Year to date

    @ViewBuilder private var yearToDate: some View {
        if let years = model.yearToDate {
            Section(header: Text(EditorWords.yearToDate)) {
                if model.isYearToDateEmpty {
                    Text(EditorWords.noYearToDate).foregroundColor(.secondary)
                } else {
                    ForEach(years, id: \.year) { year in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(year.year)).font(.subheadline.weight(.semibold))
                            ytdRow(EditorWords.grossPay, year.gross)
                            ForEach(year.deductions, id: \.name) { ytdRow($0.name.isEmpty ? EditorWords.unnamedDeduction : $0.name, $0.amount) }
                            ytdRow(EditorWords.netPay, year.net)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private func ytdRow(_ label: String, _ amount: Int) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(money(amount)).monospacedDigit()
        }
        .font(.subheadline)
    }

    // MARK: Helpers

    private var clearingSummary: String {
        model.draft.isNewAccount && model.isNew ? model.clearingName : model.options.accountName(model.draft.definition.clearingAccount) ?? ""
    }

    private var nextPaySummary: String {
        model.preview?.payDate.map { String(format: EditorWords.nextPaycheck, EditorDates.medium($0)) } ?? ""
    }

    private var deductionSummary: String {
        let deductions = model.draft.definition.deductions
        return String(format: EditorWords.deductionCount, deductions.count, money(deductions.reduce(0) { $0 + $1.amount }))
    }

    private var depositSummary: String {
        model.draft.definition.deposits.map { deposit in
            let amount = model.preview?.deposits.first { $0.id == deposit.id }?.amount ?? 0
            return "\(model.options.accountName(deposit.account) ?? EditorWords.noAccount) \(money(amount))"
        }
        .joined(separator: ", ")
    }

    private func money(_ amount: Int) -> String { BudgetAmountFormat.string(amount, style: style) }

    private func binding<Value>(_ path: WritableKeyPath<PaycheckDraft, Value>) -> Binding<Value> {
        Binding(get: { model.draft[keyPath: path] }, set: { value in model.update { $0[keyPath: path] = value } })
    }

    private func deductionBinding<Value>(_ row: PaycheckDefinition.Deduction, _ path: WritableKeyPath<PaycheckDefinition.Deduction, Value>) -> Binding<Value> {
        let (id, fallback) = (row.id, row[keyPath: path])
        Binding(
            get: { model.draft.definition.deductions.read(id, path, fallback: fallback) },
            set: { value in model.update { $0.definition.deductions.write(id, path, value) } })
    }

    private func depositBinding<Value>(_ row: PaycheckDefinition.Deposit, _ path: WritableKeyPath<PaycheckDefinition.Deposit, Value>) -> Binding<Value> {
        let (id, fallback) = (row.id, row[keyPath: path])
        Binding(
            get: { model.draft.definition.deposits.read(id, path, fallback: fallback) },
            set: { value in model.update { $0.definition.deposits.write(id, path, value) } })
    }

    // Open accounts, plus the chosen one if it has closed since
    private func accountPicker(_ label: String, selection: Binding<String>) -> some View {
        let open = model.options.openAccounts
        let chosen = model.options.accounts.first { $0.id == selection.wrappedValue && $0.closed }
        return Picker(label, selection: selection) {
            Text(EditorWords.chooseAccount).tag("")
            ForEach(open + (chosen.map { [$0] } ?? [])) { Text($0.name).tag($0.id) }
        }
    }

    private func optionPicker(_ label: String, selection: Binding<String?>, none: String, options: [(String, String)]) -> some View {
        Picker(label, selection: selection) {
            Text(none).tag(String?.none)
            ForEach(options, id: \.0) { Text($0.1).tag(String?.some($0.0)) }
        }
    }
}

// Money typed in the budget's own format; loot-core gets minor units
private struct AmountField: View {
    let label: String
    @Binding var value: Int
    let style: BudgetAmountStyle
    @State private var text = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, text: $text)
                .multilineTextAlignment(.trailing)
                .keyboardType(.decimalPad)
                .monospacedDigit()
                .focused($isFocused)
                .accessibilityLabel(Text(label))
                .onChange(of: text) { typed in
                    // A half-typed amount waits; positive amounts only, as the web's sign="+"
                    if let units = BudgetAmountFormat.minorUnits(from: typed, style: style), units >= 0, units != value { value = units }
                    if typed.trimmingCharacters(in: .whitespaces).isEmpty, value != 0 { value = 0 }
                }
                .onChange(of: isFocused) { focused in
                    if !focused { text = BudgetAmountFormat.editString(value, style: style) }
                }
                .onAppear { text = BudgetAmountFormat.editString(value, style: style) }
        }
    }
}

private struct PercentField: View {
    let label: String
    @Binding var value: Double
    @State private var text = ""

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, text: $text)
                .multilineTextAlignment(.trailing)
                .keyboardType(.decimalPad)
                .accessibilityLabel(Text(label))
                .onChange(of: text) { typed in
                    let number = Double(typed.replacingOccurrences(of: ",", with: ".")) ?? 0
                    if max(0, number) != value { value = max(0, number) }
                }
                .onAppear { text = value == 0 ? "" : String(format: "%g", value) }
            Text(verbatim: "%").foregroundColor(.secondary)
        }
    }
}

private enum EditorDates {
    private static let parser: DateFormatter = {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        return parser
    }()

    static func today() -> String { parser.string(from: Date()) }
    static func date(_ day: String) -> Date? { parser.date(from: day) }
    static func day(_ date: Date) -> String { parser.string(from: date) }

    private static func format(_ day: String, _ template: String) -> String {
        guard let date = parser.date(from: day) else { return day }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    static func long(_ day: String) -> String { format(day, "EEEEMMMMdyyyy") }
    static func medium(_ day: String) -> String { format(day, "EEEMMMd") }
}

private enum EditorWords {
    static let addTitle = NSLocalizedString("Add paycheck", comment: "Paycheck editor: title")
    static let editTitle = NSLocalizedString("Edit paycheck", comment: "Paycheck editor: title")
    static let cancel = NSLocalizedString("Cancel", comment: "Paycheck editor: ✕")
    static let save = NSLocalizedString("Save", comment: "Paycheck editor: ✓")
    static let loading = NSLocalizedString("Loading", comment: "Paycheck editor: spinner")
    static let retry = NSLocalizedString("Retry", comment: "Paycheck editor: load again")
    static let gone = NSLocalizedString("This paycheck was deleted.", comment: "Paycheck editor: deleted elsewhere")
    static let netPay = NSLocalizedString("Net pay", comment: "Paycheck editor")
    static let details = NSLocalizedString("Details", comment: "Paycheck editor section")
    static let clearingAndDates = NSLocalizedString("Clearing account and pay dates", comment: "Paycheck editor section")
    static let grossPay = NSLocalizedString("Gross pay", comment: "Paycheck editor section")
    static let deductions = NSLocalizedString("Deductions", comment: "Paycheck editor section")
    static let deposits = NSLocalizedString("Direct deposits", comment: "Paycheck editor section")
    static let yearToDate = NSLocalizedString("Year to date", comment: "Paycheck editor section")
    static let noYearToDate = NSLocalizedString("No paychecks posted this year or last year.", comment: "Paycheck editor: no history")
    static let unnamedDeduction = NSLocalizedString("Unnamed deduction", comment: "Paycheck editor")
    static let name = NSLocalizedString("Name", comment: "Paycheck editor field")
    static let employer = NSLocalizedString("Employer", comment: "Paycheck editor field")
    static let noEmployer = NSLocalizedString("No employer", comment: "Paycheck editor: no payee")
    static let clearingAccount = NSLocalizedString("Clearing account", comment: "Paycheck editor field")
    static let newClearing = NSLocalizedString("New clearing account", comment: "Paycheck editor option")
    static let existingAccount = NSLocalizedString("Existing account", comment: "Paycheck editor option")
    static let existingClearing = NSLocalizedString("Existing clearing account", comment: "Paycheck editor field")
    static let newClearingName = NSLocalizedString("New clearing account name", comment: "Paycheck editor field")
    static let newClearingPlaceholder = NSLocalizedString("For example, Acme Paycheck", comment: "Paycheck editor placeholder")
    static let chooseAccount = NSLocalizedString("Choose an account", comment: "Paycheck editor: no account yet")
    static let noAccount = NSLocalizedString("No account", comment: "Paycheck editor summary")
    static let frequency = NSLocalizedString("Repeats", comment: "Paycheck editor: pay frequency")
    static let frequencies = [
        ("daily", NSLocalizedString("Daily", comment: "Pay frequency")),
        ("weekly", NSLocalizedString("Weekly", comment: "Pay frequency")),
        ("monthly", NSLocalizedString("Monthly", comment: "Pay frequency")),
        ("yearly", NSLocalizedString("Yearly", comment: "Pay frequency")),
    ]
    static let every = NSLocalizedString("Every %1$d %2$@", comment: "Paycheck editor: interval, e.g. Every 2 weeks")
    static func unit(_ frequency: String, _ count: Int) -> String {
        switch (frequency, count == 1) {
        case ("daily", true): NSLocalizedString("day", comment: "Interval unit")
        case ("daily", false): NSLocalizedString("days", comment: "Interval unit")
        case ("weekly", true): NSLocalizedString("week", comment: "Interval unit")
        case ("weekly", false): NSLocalizedString("weeks", comment: "Interval unit")
        case ("yearly", true): NSLocalizedString("year", comment: "Interval unit")
        case ("yearly", false): NSLocalizedString("years", comment: "Interval unit")
        case (_, true): NSLocalizedString("month", comment: "Interval unit")
        default: NSLocalizedString("months", comment: "Interval unit")
        }
    }
    static let startDate = NSLocalizedString("Starting", comment: "Paycheck editor: first pay date")
    static let payDay = NSLocalizedString("Pay day %d", comment: "Paycheck editor: a day of the month")
    static let lastDay = NSLocalizedString("Last day", comment: "Paycheck editor: last day of the month")
    static let removePayDay = NSLocalizedString("Remove pay day %d", comment: "Paycheck editor")
    static let addPayDay = NSLocalizedString("Add pay day", comment: "Paycheck editor")
    static let weekendMove = NSLocalizedString(
        "Move from the clearing account's non-business days", comment: "Paycheck editor: weekend solve mode")
    static let before = NSLocalizedString("before", comment: "Paycheck editor: move before")
    static let after = NSLocalizedString("after", comment: "Paycheck editor: move after")
    static let nextPaycheck = NSLocalizedString("Next paycheck: %@", comment: "Paycheck editor")
    static let incomeCategory = NSLocalizedString("Income category", comment: "Paycheck editor field")
    static let noCategory = NSLocalizedString("No category", comment: "Paycheck editor")
    static let deductionName = NSLocalizedString("Deduction %d name", comment: "Paycheck editor")
    static let deductionAmount = NSLocalizedString("Deduction %d amount", comment: "Paycheck editor")
    static let deductionGoesTo = NSLocalizedString("Deduction %d goes to", comment: "Paycheck editor")
    static let deductionTransfer = NSLocalizedString("Deduction %d transfer account", comment: "Paycheck editor")
    static let deductionCategory = NSLocalizedString("Deduction %d category", comment: "Paycheck editor")
    static let removeDeduction = NSLocalizedString("Remove deduction %d", comment: "Paycheck editor")
    static let category = NSLocalizedString("Category", comment: "Paycheck editor")
    static let transfer = NSLocalizedString("Transfer", comment: "Paycheck editor")
    static let remove = NSLocalizedString("Remove", comment: "Paycheck editor")
    static let addDeduction = NSLocalizedString("Add deduction", comment: "Paycheck editor")
    static let deductionCount = NSLocalizedString("%1$d deductions · %2$@", comment: "Paycheck editor summary")
    static let depositAccount = NSLocalizedString("Deposit %d account", comment: "Paycheck editor")
    static let depositKind = NSLocalizedString("Deposit %d amount type", comment: "Paycheck editor")
    static let depositFixed = NSLocalizedString("Deposit %d fixed amount", comment: "Paycheck editor")
    static let depositPercent = NSLocalizedString("Deposit %d percent", comment: "Paycheck editor")
    static let depositAmount = NSLocalizedString("Deposit %d amount", comment: "Paycheck editor")
    static let removeDeposit = NSLocalizedString("Remove deposit %d", comment: "Paycheck editor")
    static let fixed = NSLocalizedString("Fixed amount", comment: "Paycheck editor")
    static let percent = NSLocalizedString("Percent of net pay", comment: "Paycheck editor")
    static let remainder = NSLocalizedString("Remainder", comment: "Paycheck editor")
    static let postAutomatically = NSLocalizedString("Post automatically", comment: "Paycheck editor")
    static let postNote = NSLocalizedString(
        "A bank-synced deposit merges with the posted one only when its amount is exactly the same. Leave this off for deposits that vary.",
        comment: "Paycheck editor")
    static let daysEarly = NSLocalizedString("Business days early: %d", comment: "Paycheck editor stepper")
    static let calendar = NSLocalizedString("Calendar: %@", comment: "Paycheck editor")
    static let weekendsOnly = NSLocalizedString("weekends only", comment: "Paycheck editor: no business calendar")
    static let appliesToEvery = NSLocalizedString("Applies to every paycheck depositing to %@.", comment: "Paycheck editor")
    static let addDeposit = NSLocalizedString("Add deposit", comment: "Paycheck editor")
    static let deletePaycheck = NSLocalizedString("Delete paycheck", comment: "Paycheck editor")
    static let deleteTitle = NSLocalizedString("Delete paycheck", comment: "Paycheck editor: delete confirmation")
    static let deleteMessage = NSLocalizedString(
        "Delete the paycheck \"%@\" and its schedules? Its clearing account and transactions are kept.", comment: "Paycheck editor")
    static let keepIt = NSLocalizedString("Keep it", comment: "Paycheck editor: cancel delete")
    static let deleteIt = NSLocalizedString("Delete", comment: "Paycheck editor: confirm delete")
    static let discardTitle = NSLocalizedString("Discard changes?", comment: "Paycheck editor: cancel with changes")
    static let discardMessage = NSLocalizedString("Your changes to this paycheck will be lost.", comment: "Paycheck editor")
    static let keepEditing = NSLocalizedString("Keep editing", comment: "Paycheck editor")
    static let discard = NSLocalizedString("Discard", comment: "Paycheck editor")
    static let ok = NSLocalizedString("OK", comment: "Paycheck editor: close an error")
    static let errorPrefix = NSLocalizedString("Error: ", comment: "Paycheck editor: VoiceOver before an error")
}
