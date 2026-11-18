import Foundation

// Fork-only (sc-4931, native-accounts-screen D4 and D5). Which page paths the
// native Accounts screen lies over. Only `/accounts` and `/accounts/<id>` do;
// `/accounts/all` stays web until sc-4387, and `/transactions/<id>` (the web
// editor) is web until sc-3602. A sheet or the editor hides the tab bar, so the
// screen steps aside and is back, re-reading, when it returns.
public enum NativeAccountsRoute: Equatable {
    case list
    case register(String)

    // nil for any path that stays web
    public static func target(path: String) -> NativeAccountsRoute? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.first == "accounts", parts.count <= 2, path.hasPrefix("/accounts") else { return nil }
        guard parts.count == 2 else { return .list }
        let id = parts[1]
        guard id != "all", id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return nil }
        return .register(id)
    }

    // The route the screen shows now, or nil while the web screen should
    public static func wanted(switchOn: Bool, tabBarShown: Bool, path: String, selected: NativeTab) -> NativeAccountsRoute? {
        guard switchOn, tabBarShown, selected == .accounts else { return nil }
        return target(path: path)
    }

    // An account id the list does not hold (open or closed) is left to the web screen
    public func isKnown(in list: AccountsList) -> Bool {
        switch self {
        case .list: return true
        case .register(let id): return (list.sections.onBudget.accounts + list.sections.offBudget.accounts + list.closed.accounts).contains { $0.id == id }
        }
    }

    // What a web hand-off may name: the open accounts only (D7a)
    public static func openAccountIds(in list: AccountsList) -> Set<String> {
        Set((list.sections.onBudget.accounts + list.sections.offBudget.accounts).map(\.id))
    }
}
