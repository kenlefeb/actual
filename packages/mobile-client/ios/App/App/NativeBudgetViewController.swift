import Combine
import SwiftUI
import UIKit

// Fork-only (sc-3751, native-budget-screen spec). The read-only native Budget
// tab: the current month of an envelope budget. Every number is a loot-core
// cell, read through native/budget-month and shown as it came; this file adds
// nothing up and writes nothing. NativeTabBarController lays it over the web
// Budget screen while the switch is on, so the web view stays in the window.
final class NativeBudgetViewController: UIHostingController<BudgetTabView> {
    private let model: BudgetViewModel
    private var stateObserver: AnyCancellable?
    private var lifecycleObservers: [NSObjectProtocol] = []

    // A tracking budget has no native screen yet: the web Budget screen shows
    var onUseWebScreen: (() -> Void)?

    init(client: NativeBridgeClient) {
        model = BudgetViewModel(client: client)
        super.init(rootView: BudgetTabView(model: model))
        stateObserver = model.$state.sink { [weak self] state in
            if state == .useWebScreen { self?.onUseWebScreen?() }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The page's change events (NativeBridgePlugin.onEvent) end here
    func changeEventReceived() { model.changeEventReceived() }

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

    var body: some View {
        NavigationView {
            content
                .navigationBarTitle(Text(monthTitle), displayMode: .large)
        }
        .navigationViewStyle(.stack)
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading, .useWebScreen:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let month):
            BudgetMonthList(month: month)
        case .failed(let error):
            VStack(spacing: 12) {
                Text(verbatim: error.message).multilineTextAlignment(.center)
                if error.canRetry {
                    Button(NSLocalizedString("Retry", comment: "Native Budget tab: try loading again")) {
                        Task { await model.load() }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var monthTitle: String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: model.month) else { return model.month }
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
    static let overspent = NSLocalizedString("Overspent", comment: "Native Budget tab: a negative balance")
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

private struct BudgetMonthList: View {
    let month: BudgetMonth

    var body: some View {
        List {
            if let toBudget = month.totals.toBudget {
                Section {
                    HStack {
                        Text(Words.toBudget).font(.headline)
                        Spacer()
                        Text(format(toBudget)).font(.headline).monospacedDigit()
                            .foregroundColor(moneyColor(BudgetAmountFormat.tone(toBudget)))
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
        Section(header: GroupHeader(group: group, format: format)) {
            ForEach(group.visibleCategories) { category in
                CategoryRow(category: category, isIncome: group.isIncome, format: format)
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
    let format: (Int?) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(group.name)
            // Only the totals loot-core has for this group (an income group has no budgeted or balance)
            let parts = [(Words.budgeted, group.budgeted), (group.isIncome ? Words.received : Words.spent, group.spent), (Words.balance, group.balance)]
                .compactMap { title, amount in amount.map { "\(title) \(format($0))" } }
            if !parts.isEmpty {
                Text(verbatim: parts.joined(separator: "  ")).font(.caption2).monospacedDigit().textCase(nil)
            }
        }
    }
}

private struct CategoryRow: View {
    let category: BudgetMonth.Category
    let isIncome: Bool
    let format: (Int?) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(category.name)
            HStack(alignment: .top) {
                if category.budgeted != nil { column(Words.budgeted, category.budgeted) }
                column(isIncome ? Words.received : Words.spent, category.spent)
                if category.balance != nil { column(Words.balance, category.balance, colored: true) }
            }
        }
        .padding(.vertical, 2)
    }

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
