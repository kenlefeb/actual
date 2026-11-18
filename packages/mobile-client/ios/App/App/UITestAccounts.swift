#if DEBUG
import SwiftUI
import UIKit

// Test-only (sc-5177). The UI-test target launches the app with
// `-UITestAccounts YES`: the window's root is then the native Accounts screen
// on the fixtures below, through a fake transport, with no web view, no
// budget, no sign-in and no network. Compiled in Debug builds only, so a
// Release build has neither this host nor the launch argument. The fixtures
// are copies of packages/loot-core/src/server/native/fixtures/ (the loot-core
// contract tests keep those true); refresh them from there when a shape changes.
enum UITestAccounts {
    static var isOn: Bool { UserDefaults.standard.bool(forKey: "UITestAccounts") }

    @MainActor static func makeRoot() -> UIViewController {
        let client = NativeBridgeClient { name, args in
            switch name {
            case "native/accounts-list": accountsList
            case "native/account-register": args.contains("\"search\"") ? registerSearch : register
            case "native/budget-month": budgetMonth
            default: "null"
            }
        }
        let model = AccountsListViewModel(client: client)
        let nav = AccountsNavigation()
        let handOff = HandOffLabel()
        let actions = AccountsActions(
            navigate: { _ in },
            handOff: { action, _ in handOff.text = action },
            openRegister: { nav.register = AccountRegisterViewModel(client: client, accountId: $0) },
            closeRegister: { nav.register = nil },
            reconcile: { _ in })
        return UIHostingController(
            rootView: UITestAccountsRoot(
                screen: AccountsScreen(model: model, nav: nav, reconcileMonth: ReconcileMonthViewModel(client: client), actions: actions),
                handOff: handOff, model: model))
    }

    private static let accountsList = #"""
    {"currencyCode":"","currencyDecimalPlaces":2,"currencySymbol":"","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,"sections":{"onBudget":{"total":117820,"accounts":[{"id":"checking","name":"Checking","balance":92820,"offbudget":false,"closed":false,"lastSync":"1483228800000","lastTransactionDate":"2016-12-28","bankSync":true,"clearingFor":null},{"id":"savings","name":"Savings","balance":50000,"offbudget":false,"closed":false,"lastSync":null,"lastTransactionDate":"2016-12-20","bankSync":false,"clearingFor":null},{"id":"card","name":"Card","balance":-25000,"offbudget":false,"closed":false,"lastSync":null,"lastTransactionDate":"2016-12-20","bankSync":false,"clearingFor":"Acme"}]},"offBudget":{"total":300000,"accounts":[{"id":"house","name":"House","balance":300000,"offbudget":true,"closed":false,"lastSync":null,"lastTransactionDate":"2016-12-20","bankSync":false,"clearingFor":null}]}},"closed":{"total":700,"accounts":[{"id":"old","name":"Old","balance":700,"offbudget":false,"closed":true,"lastSync":null,"lastTransactionDate":"2016-12-20","bankSync":false,"clearingFor":null}]},"netWorth":417820}
    """#
    private static let register = #"""
    {"currencyCode":"","currencyDecimalPlaces":2,"currencySymbol":"","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,"rows":[{"id":"food","date":"2016-12-28","payee":"Grocer","category":"Groceries","categoryId":"groceries","splitCount":0,"notes":"weekly shop","amount":-4180,"cleared":true,"reconciled":false,"transferAccount":null,"transferReconciled":null,"runningBalance":-12180},{"id":"plain","date":"2016-12-27","payee":null,"category":null,"categoryId":null,"splitCount":0,"notes":null,"amount":-500,"cleared":false,"reconciled":false,"transferAccount":null,"transferReconciled":null,"runningBalance":-8000},{"id":"lock","date":"2016-12-26","payee":null,"category":null,"categoryId":null,"splitCount":0,"notes":"50%_off","amount":2500,"cleared":true,"reconciled":true,"transferAccount":null,"transferReconciled":null,"runningBalance":-7500},{"id":"split","date":"2016-12-25","payee":null,"category":null,"categoryId":null,"splitCount":2,"notes":null,"amount":-3000,"cleared":false,"reconciled":false,"transferAccount":null,"transferReconciled":null,"runningBalance":-10000},{"id":"out","date":"2016-12-24","payee":"Savings","category":null,"categoryId":null,"splitCount":0,"notes":null,"amount":-7000,"cleared":false,"reconciled":false,"transferAccount":{"id":"savings","name":"Savings"},"transferReconciled":true,"runningBalance":-7000}],"nextCursor":null,"header":{"balance":-12180,"cleared":-1680,"uncleared":-10500}}
    """#
    private static let registerSearch = #"""
    {"currencyCode":"","currencyDecimalPlaces":2,"currencySymbol":"","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,"rows":[{"id":"food","date":"2016-12-28","payee":"Grocer","category":"Groceries","categoryId":"groceries","splitCount":0,"notes":"weekly shop","amount":-4180,"cleared":true,"reconciled":false,"transferAccount":null,"transferReconciled":null,"runningBalance":null},{"id":"split","date":"2016-12-25","payee":null,"category":null,"categoryId":null,"splitCount":2,"notes":null,"amount":-3000,"cleared":false,"reconciled":false,"transferAccount":null,"transferReconciled":null,"runningBalance":null}],"nextCursor":null,"header":{"balance":-12180,"cleared":-1680,"uncleared":-10500},"resultCount":2,"resultTotal":-7180}
    """#
    private static let budgetMonth = #"""
    {"month":"2026-03","firstMonth":"2026-02","lastMonth":"2026-03","budgetType":"envelope","currencyCode":"","currencyDecimalPlaces":2,"currencySymbol":"","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,"totals":{"budgeted":-160000,"spent":-120000,"income":300000,"balance":40000,"toBudget":140000,"available":300000,"lastMonthOverspent":0,"forNextMonth":0,"fromLastMonth":0,"budgetedIncome":null,"saved":null},"groups":[{"id":"bills","name":"Bills","isIncome":false,"hidden":false,"budgeted":160000,"spent":-120000,"balance":40000,"categories":[{"id":"power","name":"Power","hidden":true,"budgeted":10000,"spent":0,"balance":10000,"carryover":false},{"id":"rent","name":"Rent","hidden":false,"budgeted":150000,"spent":-120000,"balance":30000,"carryover":false}]},{"id":"income","name":"Income","isIncome":true,"hidden":false,"budgeted":null,"spent":300000,"balance":null,"categories":[{"id":"salary","name":"Salary","hidden":false,"budgeted":null,"spent":300000,"balance":null,"carryover":false}]}]}
    """#
}

@MainActor
final class HandOffLabel: ObservableObject {
    @Published var text = ""
}

// The screen, with the last web hand-off written over it for the tests to read
private struct UITestAccountsRoot: View {
    let screen: AccountsScreen
    @ObservedObject var handOff: HandOffLabel
    let model: AccountsListViewModel

    var body: some View {
        screen
            .overlay(alignment: .bottom) {
                Text(verbatim: handOff.text).font(.caption2).accessibilityIdentifier("uitest.handoff")
            }
            .task { await model.load() }
    }
}
#endif
