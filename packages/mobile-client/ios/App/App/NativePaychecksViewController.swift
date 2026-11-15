import Combine
import SwiftUI
import UIKit

// Fork-only (sc-4341, native-paychecks-screen spec). The native Schedules &
// Paychecks list: paychecks first, then the other schedules, every date and
// amount as native/schedules-paychecks returned it. Swift formats them and
// adds nothing up (ADR 11). NativeTabBarController lays it over the web
// Schedules screen while the switch is on; it hides itself while the
// paychecks feature is off, so the web screen below shows unchanged.
final class NativePaychecksViewController: UIHostingController<PaychecksScreen> {
    private let model: PaychecksViewModel
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var stateObserver: AnyCancellable?

    // `navigate` asks the page to show a path (the web editor and forms, or back)
    init(client: NativeBridgeClient, backPath: String, navigate: @escaping (String) -> Void) {
        model = PaychecksViewModel(client: client)
        super.init(rootView: PaychecksScreen(model: model, backPath: backPath, navigate: navigate))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // A page event (NativeBridgePlugin.onPaychecksEvent)
    func eventReceived(_ event: String, tables: [String]) {
        if event == "ready" {
            Task { await model.pageReady() }
        } else {
            model.eventReceived(event, tables: tables)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
        // An alert draws outside this view, so `.tint` never reaches it: the skip
        // confirm button takes the accent through the alert's own appearance.
        // App-wide, which is the accent's job anyway (DESIGN.native.md §3)
        UIView.appearance(whenContainedInInstancesOf: [UIAlertController.self]).tintColor = UIColor(PaychecksTokens.skipConfirm)
        // Hidden until loot-core says paychecks are on, so the web screen shows
        // while they are off, or before the first read
        view.isHidden = true
        stateObserver = model.$state.sink { [weak self] state in
            switch state {
            case .loaded(let read), .stale(let read, _): self?.view.isHidden = !read.enabled
            case .failed: self?.view.isHidden = false
            case .loading: break
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
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        model.leave()
    }

    deinit {
        for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
    }
}

// The confirm button of "Skip next": the normal teal accent, not destructive
// styling (Ken, 2026-11-14). One token, so it can be swapped in one place.
enum PaychecksTokens {
    static let skipConfirm = Color(NativeTabBarController.accent)
}

struct PaychecksScreen: View {
    @ObservedObject var model: PaychecksViewModel
    let backPath: String
    let navigate: (String) -> Void
    @State private var expanded: Set<String> = []
    @State private var confirmingSkip: SchedulesPaychecks.Paycheck?
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        NavigationView {
            content
                .navigationBarTitle(Text(Words.title), displayMode: .large)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button {
                            navigate(backPath)
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .accessibilityLabel(Text(Words.back))
                    }
                }
        }
        .navigationViewStyle(.stack)
        .task { await model.load() }
        .safeAreaInset(edge: .bottom) { undoBar }
        // After the inset, so the Undo button takes the accent too
        .tint(PaychecksTokens.skipConfirm)
        .onChange(of: model.announcement) { message in
            if let message { UIAccessibility.post(notification: .announcement, argument: message) }
        }
        // One alert for the view, so the skip confirmation and an error never compete
        .alert(alertTitle, isPresented: isAlertShown, presenting: alert.wrappedValue) { alert in
            switch alert {
            case .skip(let paycheck):
                Button(Words.keepIt, role: .cancel) {}
                // The preferred action takes the teal accent, not destructive styling
                Button(Words.skipIt) { Task { _ = await model.skipNext(paycheck.id) } }
                    .keyboardShortcut(.defaultAction)
            case .error:
                Button(Words.ok, role: .cancel) {}
            }
        } message: { alert in
            if case .skip = alert { Text(Words.skipCanUndo) }
        }
    }

    private var alertTitle: String {
        switch alert.wrappedValue {
        case .skip(let paycheck): String(format: Words.skipQuestion, Dates.long(paycheck.next?.date ?? ""))
        case .error(let message): message
        case nil: ""
        }
    }

    private var isAlertShown: Binding<Bool> {
        Binding(get: { alert.wrappedValue != nil }, set: { if !$0 { alert.wrappedValue = nil } })
    }

    private enum ScreenAlert: Identifiable {
        case skip(SchedulesPaychecks.Paycheck)
        case error(String)

        var id: String {
            switch self {
            case .skip(let paycheck): "skip-\(paycheck.id)"
            case .error(let message): "error-\(message)"
            }
        }
    }

    // The skip confirmation first; a failed skip or Undo after it closes
    private var alert: Binding<ScreenAlert?> {
        Binding(
            get: {
                if let paycheck = confirmingSkip { return .skip(paycheck) }
                return model.actionError.map { .error($0.message) }
            },
            set: { value in
                guard value == nil else { return }
                if confirmingSkip != nil { confirmingSkip = nil } else { model.clearActionError() }
            })
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(Text(Words.loading))
        case .loaded(let read):
            list(read)
        case .stale(let read, let error):
            VStack(spacing: 0) {
                errorMessage(error).padding().frame(maxWidth: .infinity).background(Color(.secondarySystemGroupedBackground))
                list(read).opacity(contrast == .increased ? 0.75 : 0.5).disabled(true)
            }
        case .failed(let error):
            errorMessage(error).padding().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // The Budget screen's refresh-failure messages, with a retry
    private func errorMessage(_ error: BudgetLoadError) -> some View {
        VStack(spacing: 12) {
            Text(verbatim: error.message).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            Button(NSLocalizedString("Retry", comment: "Native Paychecks: try loading again")) {
                Task { await model.load() }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func list(_ read: SchedulesPaychecks) -> some View {
        List {
            Section(header: header(Words.paychecks, add: Words.addPaycheck) { navigate("/paychecks/new") }) {
                if read.paychecks.isEmpty {
                    emptyRow(Words.noPaychecks, action: Words.addPaycheck) { navigate("/paychecks/new") }
                }
                ForEach(read.paychecks) { paycheck in
                    PaycheckRow(
                        paycheck: paycheck, style: read.amountStyle, isExpanded: expanded.contains(paycheck.id),
                        onEdit: { navigate("/paychecks/\(paycheck.id)") },
                        onToggleMore: {
                            if expanded.contains(paycheck.id) { expanded.remove(paycheck.id) } else { expanded.insert(paycheck.id) }
                        },
                        onSkip: { confirmingSkip = paycheck })
                }
            }
            Section(header: header(Words.schedules, add: Words.addSchedule) { navigate("/schedules/new") }) {
                if model.visibleSchedules.isEmpty {
                    emptyRow(Words.noSchedules, action: Words.addSchedule) { navigate("/schedules/new") }
                }
                ForEach(model.visibleSchedules) { schedule in
                    Button {
                        navigate("/schedules/\(schedule.id)")
                    } label: {
                        ScheduleRow(schedule: schedule, style: read.amountStyle)
                    }
                    .foregroundColor(.primary)
                }
                if model.hasCompletedSchedules {
                    Button(model.showCompleted ? Words.hideCompleted : Words.showCompleted) { model.showCompleted.toggle() }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func header(_ title: String, add: String, action: @escaping () -> Void) -> some View {
        HStack {
            Text(title).font(.headline).foregroundColor(.primary).accessibilityAddTraits(.isHeader)
            Spacer()
            Button(action: action) { Image(systemName: "plus") }
                .accessibilityLabel(Text(add))
                .frame(minWidth: 44, minHeight: 44)
        }
        .textCase(nil)
    }

    private func emptyRow(_ text: String, action: String, _ perform: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
            Button(action, action: perform).buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var undoBar: some View {
        if let offer = model.undoOffer {
            HStack {
                Text(String(format: Words.skipped, Dates.long(offer.date))).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(Words.undo) { Task { await model.undo() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isWorking)
            }
            .padding()
            .background(.regularMaterial)
        }
    }
}

private struct PaycheckRow: View {
    let paycheck: SchedulesPaychecks.Paycheck
    let style: BudgetAmountStyle
    let isExpanded: Bool
    let onEdit: () -> Void
    let onToggleMore: () -> Void
    let onSkip: () -> Void

    // A List row with several buttons sends a tap to every button in it, or
    // to the wrong one, unless each button has its own style; no gesture on the
    // row itself (sc-4341 review: "Skip next" did nothing, "Show more" skipped)
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onEdit) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(paycheck.name).font(.headline)
                    if let next = paycheck.next {
                        planned(next)
                    } else {
                        Text(Words.noUpcoming).foregroundColor(.secondary)
                    }
                    ForEach(paycheck.skipped, id: \.self) { date in
                        Label(String(format: Words.skippedLine, Dates.medium(date)), systemImage: "forward.end")
                            .foregroundColor(Money.warning)
                    }
                    if let warning = paycheck.clearingWarning {
                        Label(warningText(warning), systemImage: "exclamationmark.triangle.fill")
                            .foregroundColor(Money.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if isExpanded { ForEach(paycheck.later, id: \.date) { planned($0) } }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            HStack(spacing: 12) {
                if !paycheck.later.isEmpty {
                    Button(isExpanded ? Words.showLess : Words.showMore, action: onToggleMore).buttonStyle(.bordered)
                }
                if paycheck.next != nil {
                    Button(Words.skipNext, action: onSkip).buttonStyle(.bordered)
                }
            }
        }
        .padding(.vertical, 4)
        // One VoiceOver element: net pay, next date, state and warning; the buttons are actions
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenLabel))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: Text(Words.edit), onEdit)
        .modifier(OptionalAction(name: isExpanded ? Words.showLess : Words.showMore, isOn: !paycheck.later.isEmpty, action: onToggleMore))
        .modifier(OptionalAction(name: Words.skipNext, isOn: paycheck.next != nil, action: onSkip))
    }

    private func planned(_ plan: SchedulesPaychecks.PlannedPaycheck) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ViewThatFitsRow {
                Text(Dates.long(plan.date))
                Text(Money.incoming(paycheck.netAmount, style)).font(.body.weight(.semibold)).monospacedDigit().foregroundColor(Money.positive)
            }
            ForEach(plan.deposits) { deposit in
                (Text("\(deposit.accountName) · ")
                    + Text(Money.incoming(deposit.amount, style)).foregroundColor(Money.positive)
                    + Text(" · \(Dates.medium(deposit.date))"))
                    .font(.subheadline).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func warningText(_ warning: SchedulesPaychecks.ClearingWarning) -> String {
        let amount = BudgetAmountFormat.string(warning.balance, style: style)
        let missing = warning.missingDeposits.map(\.accountName)
        if missing.isEmpty {
            return String(format: Words.stillIn, amount, warning.clearingAccountName)
        }
        return String(format: Words.stillInWaiting, amount, warning.clearingAccountName, ListFormatter.localizedString(byJoining: missing))
    }

    private var spokenLabel: String {
        var parts = [paycheck.name]
        if let next = paycheck.next {
            parts.append(String(format: Words.spokenNext, Dates.long(next.date), Money.incoming(paycheck.netAmount, style)))
        } else {
            parts.append(Words.noUpcoming)
        }
        parts += paycheck.skipped.map { String(format: Words.skippedLine, Dates.medium($0)) }
        if let warning = paycheck.clearingWarning { parts.append(Words.warning + ": " + warningText(warning)) }
        if isExpanded { parts += paycheck.later.map { Dates.long($0.date) } }
        return parts.joined(separator: ", ")
    }
}

private struct OptionalAction: ViewModifier {
    let name: String
    let isOn: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if isOn { content.accessibilityAction(named: Text(name), action) } else { content }
    }
}

// Side by side, stacked at the accessibility text sizes so nothing truncates
private struct ViewThatFitsRow<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        if sizeCategory.isAccessibilityCategory {
            VStack(alignment: .leading, spacing: 2) { content }.fixedSize(horizontal: false, vertical: true)
        } else {
            HStack(spacing: 10) { content }
        }
    }
}

private struct ScheduleRow: View {
    let schedule: SchedulesPaychecks.Schedule
    let style: BudgetAmountStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ViewThatFitsRow {
                Text(schedule.name ?? Words.unnamed).foregroundColor(schedule.name == nil ? .secondary : .primary)
                Spacer(minLength: 0)
                Text(Words.status(schedule.status)).font(.caption.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .overlay(Capsule().stroke(Color.secondary))
            }
            ViewThatFitsRow {
                Text([schedule.payeeName, schedule.accountName].compactMap { $0 }.joined(separator: " · ")).foregroundColor(.secondary)
                Spacer(minLength: 0)
                Text(amountText).monospacedDigit().foregroundColor(schedule.amount > 0 ? Money.positive : .secondary)
            }
            .font(.subheadline)
            if let date = schedule.nextDate { Text(Dates.medium(date)).font(.subheadline).foregroundColor(.secondary) }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var amountText: String { schedule.amountText(style: style) }
}

// Money in is the only coloured money (DESIGN.native.md, money/positive with "+")
enum Money {
    static let positive = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x30 / 255, green: 0xD1 / 255, blue: 0x58 / 255, alpha: 1)
            : UIColor(red: 0x1F / 255, green: 0x7A / 255, blue: 0x35 / 255, alpha: 1)
    })

    // DESIGN.native.md status/warning-text: 5.8:1 on the warning tint in light
    static let warning = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255, alpha: 1)
            : UIColor(red: 0xA8 / 255, green: 0x2B / 255, blue: 0x00 / 255, alpha: 1)
    })

    static func incoming(_ amount: Int, _ style: BudgetAmountStyle) -> String {
        (amount > 0 ? "+" : "") + BudgetAmountFormat.string(amount, style: style)
    }
}

// loot-core's yyyy-MM-dd days, shown in the user's locale
enum Dates {
    private static let parser: DateFormatter = {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.locale = Locale(identifier: "en_US_POSIX")
        return parser
    }()

    private static func format(_ day: String, _ template: String) -> String {
        guard let date = parser.date(from: day) else { return day }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    static func long(_ day: String) -> String { format(day, "EEEEMMMMdyyyy") }
    static func medium(_ day: String) -> String { format(day, "EEEEMMMMd") }
    static func short(_ day: String) -> String { format(day, "EEEMMMd") }
}

private enum Words {
    static let title = NSLocalizedString("Schedules & Paychecks", comment: "Native Paychecks: screen title")
    static let back = NSLocalizedString("Back", comment: "Native Paychecks: leave the screen")
    static let loading = NSLocalizedString("Loading", comment: "Native Paychecks: VoiceOver label on the spinner")
    static let paychecks = NSLocalizedString("Paychecks", comment: "Native Paychecks: section")
    static let schedules = NSLocalizedString("Schedules", comment: "Native Paychecks: section")
    static let addPaycheck = NSLocalizedString("Add paycheck", comment: "Native Paychecks: add action")
    static let addSchedule = NSLocalizedString("Add schedule", comment: "Native Paychecks: add action")
    static let noPaychecks = NSLocalizedString(
        "Set up a paycheck to see what lands in each account, and when.", comment: "Native Paychecks: no paychecks")
    static let noSchedules = NSLocalizedString("No schedules yet.", comment: "Native Paychecks: no schedules")
    static let noUpcoming = NSLocalizedString("No upcoming paychecks", comment: "Native Paychecks: a paycheck that ended")
    static let showMore = NSLocalizedString("Show more", comment: "Native Paychecks: later pay dates")
    static let showLess = NSLocalizedString("Show less", comment: "Native Paychecks: hide later pay dates")
    static let skipNext = NSLocalizedString("Skip next paycheck", comment: "Native Paychecks: skip action")
    static let edit = NSLocalizedString("Edit paycheck", comment: "Native Paychecks: VoiceOver action")
    static let skipQuestion = NSLocalizedString("Skip the paycheck on %@?", comment: "Native Paychecks: skip confirmation title")
    static let skipCanUndo = NSLocalizedString(
        "Its deposits are skipped too. You can undo this right after.", comment: "Native Paychecks: skip confirmation message")
    static let keepIt = NSLocalizedString("Keep it", comment: "Native Paychecks: cancel the skip")
    static let skipIt = NSLocalizedString("Skip it", comment: "Native Paychecks: confirm the skip")
    static let skipped = NSLocalizedString("Skipped the paycheck on %@.", comment: "Native Paychecks: after a skip")
    static let ok = NSLocalizedString("OK", comment: "Native Paychecks: close an error")
    static let undo = NSLocalizedString("Undo", comment: "Native Paychecks: undo the skip")
    static let skippedLine = NSLocalizedString("Skipped: %@", comment: "Native Paychecks: a skipped pay date")
    static let warning = NSLocalizedString("Needs attention", comment: "Native Paychecks: VoiceOver prefix of a clearing warning")
    static let stillIn = NSLocalizedString("%1$@ is still in \"%2$@\".", comment: "Native Paychecks: clearing warning")
    static let stillInWaiting = NSLocalizedString(
        "%1$@ is still in \"%2$@\", waiting on the deposits to %3$@.", comment: "Native Paychecks: clearing warning with missing deposits")
    static let spokenNext = NSLocalizedString("next %1$@, %2$@ net", comment: "Native Paychecks: VoiceOver next paycheck")
    static let unnamed = NSLocalizedString("Unnamed schedule", comment: "Native Paychecks: a schedule without a name")
    static let showCompleted = NSLocalizedString("Show completed schedules", comment: "Native Paychecks: show completed")
    static let hideCompleted = NSLocalizedString("Hide completed schedules", comment: "Native Paychecks: hide completed")

    // Status words, not colour alone
    static func status(_ status: SchedulesPaychecks.Status) -> String {
        switch status {
        case .completed: NSLocalizedString("Completed", comment: "Schedule status")
        case .paid: NSLocalizedString("Paid", comment: "Schedule status")
        case .due: NSLocalizedString("Due", comment: "Schedule status")
        case .upcoming: NSLocalizedString("Upcoming", comment: "Schedule status")
        case .missed: NSLocalizedString("Missed", comment: "Schedule status")
        case .scheduled: NSLocalizedString("Scheduled", comment: "Schedule status")
        case .other(let word): word.capitalized
        }
    }
}
