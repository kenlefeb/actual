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

    // A tracking budget has no native screen yet: the web Budget screen shows
    var onUseWebScreen: (() -> Void)?

    init(client: NativeBridgeClient) {
        model = BudgetViewModel(client: client, month: BudgetViewModel.currentMonth())
        super.init(rootView: BudgetTabView(model: model))
        stateObserver = model.$state.sink { [weak self] state in
            if state == .useWebScreen { self?.onUseWebScreen?() }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // Until change events land (sc-3796), the tab re-reads each time it shows
    func reload() {
        Task { await model.load() }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Opaque, so the web Budget screen under it never shows through, and
        // modal, so VoiceOver skips that web view while this screen shows
        view.backgroundColor = .systemGroupedBackground
        view.accessibilityViewIsModal = true
    }
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
                Text(message(for: error)).multilineTextAlignment(.center)
                Button("Retry") { Task { await model.load() } }.buttonStyle(.borderedProminent)
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

    private func message(for error: BudgetLoadError) -> String {
        switch error {
        case .timedOut: return NSLocalizedString("The budget did not answer in time.", comment: "Native Budget tab")
        case .message(let text): return text
        }
    }
}

private struct BudgetMonthList: View {
    let month: BudgetMonth

    var body: some View {
        List {
            if let toBudget = month.totals.toBudget {
                Section {
                    HStack {
                        Text("To budget").font(.headline)
                        Spacer()
                        Text(format(toBudget)).font(.headline).monospacedDigit()
                    }
                }
            }
            ForEach(month.groups.filter { !$0.hidden }) { group in
                Section(header: Text(group.name)) {
                    ForEach(group.categories.filter { !$0.hidden }) { category in
                        CategoryRow(category: category, format: format)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func format(_ amount: Int?) -> String {
        BudgetAmountFormat.string(amount, decimalPlaces: month.currencyDecimalPlaces, currencyCode: month.currencyCode)
    }
}

private struct CategoryRow: View {
    let category: BudgetMonth.Category
    let format: (Int?) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(category.name)
            HStack {
                column("Budgeted", category.budgeted)
                column("Spent", category.spent)
                column("Balance", category.balance)
            }
        }
        .padding(.vertical, 2)
    }

    private func column(_ title: LocalizedStringKey, _ amount: Int?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption2).foregroundColor(.secondary)
            Text(format(amount).isEmpty ? "-" : format(amount)).font(.footnote).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
