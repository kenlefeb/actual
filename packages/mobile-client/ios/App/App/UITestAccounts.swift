#if DEBUG
import SwiftUI
import UIKit

// Test-only (sc-5177). The UI-test target launches the app with
// `-UITestAccounts YES`: the window's root is then the native Accounts screen
// on the fixtures below, through a fake transport, with no web view, no
// budget, no sign-in and no network. Compiled in Debug builds only (the
// `native-swift` check and the archive step of fork-ios.yml keep it out of a
// Release build). The fixtures are copies of
// packages/loot-core/src/server/native/fixtures/ (the loot-core contract tests
// keep those true); refresh them from there when a shape changes.
//
// The fake honours the register's scope the way loot-core does (uncleared and
// uncategorized drop rows), and the web hand-offs and Reconcile entries are
// written on screen as "<action>:<account>" for the tests to read.
enum UITestAccounts {
    static var isOn: Bool { UserDefaults.standard.bool(forKey: "UITestAccounts") }

    // `-UITestStorageLine saving|unstored` holds the storage line up, to see it over the
    // fixtures without slow storage. Kept alive with the window.
    private static var storageLine: WriteStorageLine?

    // Also on the real app shell, to see the line over real screens
    @MainActor static func holdStorageLine(_ status: WriteStorageStatus) {
        guard let state = UserDefaults.standard.string(forKey: "UITestStorageLine") else { return }
        if state == "saving" {
            status.writeBegan()
            return
        }
        status.record(.notStored)
        // The page's load clears it, as a restart would: put it back
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            MainActor.assumeIsolated {
                status.acknowledgeMayNotBeSaved()
                status.record(.notStored)
            }
        }
    }

    @MainActor static func showStorageLine(over root: UIViewController, in scene: UIWindowScene) {
        guard UserDefaults.standard.string(forKey: "UITestStorageLine") != nil else { return }
        let status = WriteStorageStatus()
        holdStorageLine(status)
        storageLine = WriteStorageLine(
            status: status, scene: scene, barHeight: { 0 },
            reserve: { [weak root] height, keyboard in
                (root as? TabContainerViewController)?.reserveBottom(height)
                root?.presentedViewController?.additionalSafeAreaInsets.bottom = height + keyboard
            })
    }

    @MainActor static func makeRoot() -> UIViewController {
        // A held read must stay held: the default 5 s deadline would turn it into the error screen
        let holding = ["UITestSlowList", "UITestSlowRegister"].contains { UserDefaults.standard.bool(forKey: $0) }
        let client = NativeBridgeClient(timeout: holding ? 300 : NativeBridgeClient.defaultTimeout) { name, args in
            // Launch arguments that hold a read in flight or make it fail, to see the loading and failed states
            let defaults = UserDefaults.standard
            if name == "native/accounts-list" || name == "native/account-register" {
                let key = name == "native/accounts-list" ? "List" : "Register"
                if defaults.bool(forKey: "UITestSlow\(key)") { try await Task.sleep(nanoseconds: 120_000_000_000) }
                if defaults.bool(forKey: "UITestFail\(key)") { throw NSError(domain: "UITest", code: 1) }
            }
            switch name {
            case "native/accounts-list": return accountsList
            case "native/account-register": return registerPage(args.contains("\"search\"") ? registerSearch : register, args: args)
            case "native/budget-month": return budgetMonth
            case "native/reconcile-month": return reconcileMonth
            default: return "null"
            }
        }
        let model = AccountsListViewModel(client: client)
        let nav = AccountsNavigation()
        let monthModel = ReconcileMonthViewModel(client: client)
        let handOff = HandOffLabel()
        // The system's context menu and sheets never report "animations complete" on the
        // simulator, so each UI-test step waited a minute for the idle timeout
        if UserDefaults.standard.bool(forKey: "UITestNoAnimations") { UIView.setAnimationsEnabled(false) }
        let actions = AccountsActions(
            navigate: { _ in },
            handOff: { action, id in handOff.text = "\(action):\(id ?? "")" },
            openRegister: { nav.register = AccountRegisterViewModel(client: client, accountId: $0) },
            closeRegister: { nav.register = nil },
            reconcile: { handOff.text = "reconcile:\($0 ?? "checklist")" })
        let screen = UIHostingController(
            rootView: UITestAccountsRoot(
                screen: AccountsScreen(model: model, nav: nav, reconcileMonth: monthModel, actions: actions),
                handOff: handOff, model: model, month: monthModel))
        guard UserDefaults.standard.string(forKey: "UITestStorageLine") != nil else { return screen }
        // Laid out as in the app, so the line's reserved space is the real one
        let container = TabContainerViewController(tab: .accounts)
        container.tabBarVisible = true
        container.embed(screen)
        return container
    }

    // loot-core filters by scope on its side; the fake does the same to the fixture
    private static func registerPage(_ page: String, args: String) -> String {
        guard let scope = (try? JSONSerialization.jsonObject(with: Data(args.utf8)) as? [String: Any])?["scope"] as? String,
            scope != "all",
            var object = (try? JSONSerialization.jsonObject(with: Data(page.utf8))) as? [String: Any],
            let rows = object["rows"] as? [[String: Any]]
        else { return page }
        object["rows"] = rows.filter { scope == "uncleared" ? $0["cleared"] as? Bool == false : ($0["categoryId"] == nil || $0["categoryId"] is NSNull) }
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return page }
        return String(decoding: data, as: UTF8.self)
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
    private static let reconcileMonth = #"""
    {"currencyCode":"","currencyDecimalPlaces":2,"currencySymbol":"","currencySymbolPosition":"before","currencySpace":false,"numberFormat":"comma-dot","hideFraction":false,"month":"2017-01","excluded":[],"hidden":[],"accounts":[{"id":"checking","name":"Checking","status":"due","detail":{"cleared":105000,"statement":null},"last_reconciled":null,"sync_source":null},{"id":"savings","name":"Savings","status":"due","detail":{"cleared":0,"statement":null},"last_reconciled":null,"sync_source":null},{"id":"card","name":"Card","status":"due","detail":{"cleared":0,"statement":null},"last_reconciled":null,"sync_source":null}]}
    """#
}

@MainActor
final class HandOffLabel: ObservableObject {
    @Published var text = ""
}

// The custom actions (the actions rotor) each accessibility element offers, read from
// the live accessibility tree of the window: XCUITest cannot list them. "<label>=[a|b]; ..."
@MainActor
enum UITestActionsProbe {
    // The accessibility elements VoiceOver can land on, as "label|value" in tree order: a view or
    // element hidden from accessibility, and everything under it, is skipped. XCUITest cannot be
    // used for this: it lists accessibility-hidden elements too (checked with a hidden probe).
    static func elements() -> String {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.windows.first(where: \.isKeyWindow) }).first else { return "no window" }
        var found: [String] = []
        var seen = Set<ObjectIdentifier>()
        func visit(_ object: NSObject) {
            guard seen.insert(ObjectIdentifier(object)).inserted else { return }
            if let view = object as? UIView, view.accessibilityElementsHidden || view.isHidden || view.alpha == 0 { return }
            if object.isAccessibilityElement {
                found.append("\(object.accessibilityLabel ?? "")|\(object.accessibilityValue ?? "")")
                return
            }
            if let elements = object.accessibilityElements as? [NSObject] {
                elements.forEach(visit)
                return
            }
            let count = object.accessibilityElementCount()
            if count != NSNotFound, count > 0 {
                for index in 0..<count {
                    if let element = object.accessibilityElement(at: index) as? NSObject { visit(element) }
                }
                return
            }
            (object as? UIView)?.subviews.forEach(visit)
        }
        visit(window)
        return found.joined(separator: "; ")
    }

    static func dump() -> String {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.windows.first(where: \.isKeyWindow) }).first else { return "no window" }
        var found: [String] = []
        var seen = Set<ObjectIdentifier>()
        func visit(_ object: NSObject) {
            guard seen.insert(ObjectIdentifier(object)).inserted else { return }
            if let actions = object.accessibilityCustomActions, !actions.isEmpty {
                found.append("\(object.accessibilityLabel ?? "?")=[\(actions.map(\.name).joined(separator: "|"))]")
            }
            if let view = object as? UIView {
                view.subviews.forEach(visit)
            }
            if let elements = object.accessibilityElements as? [NSObject] {
                elements.forEach(visit)
            }
            let count = object.accessibilityElementCount()
            if count != NSNotFound, count > 0 {
                for index in 0..<count {
                    if let element = object.accessibilityElement(at: index) as? NSObject { visit(element) }
                }
            }
        }
        visit(window)
        return found.joined(separator: "; ")
    }
}

// What the screens asked VoiceOver to announce (AccessibilityAnnouncer), for the tests to read
@MainActor
final class UITestAnnouncements: ObservableObject {
    static let shared = UITestAnnouncements()
    @Published private(set) var log: [String] = []

    func record(_ text: String) {
        guard UITestAccounts.isOn else { return }
        log.append(text)
    }
}

// The screen, with the last hand-off written over it for the tests to read
private struct UITestAccountsRoot: View {
    let screen: AccountsScreen
    @ObservedObject var handOff: HandOffLabel
    let model: AccountsListViewModel
    let month: ReconcileMonthViewModel
    @ObservedObject private var announcements = UITestAnnouncements.shared
    @State private var actionsDump = ""
    @State private var elementsDump = ""

    var body: some View {
        screen
            .overlay(alignment: .bottom) {
                VStack(spacing: 0) {
                    Text(verbatim: handOff.text).font(.caption2).accessibilityIdentifier("uitest.handoff")
                    // "<how many>|<the last one>"
                    Text(verbatim: "\(announcements.log.count)|\(announcements.log.last ?? "")").font(.caption2)
                        .accessibilityIdentifier("uitest.announcements")
                    Button("dump") { actionsDump = UITestActionsProbe.dump() }.font(.caption2).accessibilityIdentifier("uitest.dumpActions")
                    Text(verbatim: actionsDump).font(.system(size: 1)).accessibilityIdentifier("uitest.actions")
                    Button("elements") { elementsDump = UITestActionsProbe.elements() }.font(.caption2).accessibilityIdentifier("uitest.dumpElements")
                    Text(verbatim: elementsDump).font(.system(size: 1)).accessibilityIdentifier("uitest.elements")
                }
            }
            // As NativeAccountsViewController does when the screen becomes active: the list, then the Reconcile banner's month
            .task {
                await model.load()
                await month.load()
            }
    }
}
#endif
