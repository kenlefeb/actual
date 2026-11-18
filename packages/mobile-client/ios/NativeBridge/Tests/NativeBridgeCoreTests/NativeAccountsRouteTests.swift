import XCTest

@testable import NativeBridgeCore

// native-accounts-screen D4 and D5 (sc-4931): which page paths the native
// Accounts screen lies over, and the switch that turns it on. With the switch
// unset or off the Accounts tab is the web screens exactly as today.
final class NativeAccountsRouteTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let suite = "NativeAccountsRouteTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }

    func testTheAccountsTabHasANativeScreenBehindAnOffByDefaultSwitch() {
        let defaults = defaults()
        XCTAssertTrue(NativeScreenSwitch.nativeTabs.contains(.accounts))
        XCTAssertEqual(NativeScreenSwitch.screen(for: .accounts, defaults: defaults), .web)
        defaults.set(true, forKey: "NativeScreen.accounts")
        XCTAssertEqual(NativeScreenSwitch.screen(for: .accounts, defaults: defaults), .native)
        defaults.set(false, forKey: "NativeScreen.accounts")
        XCTAssertEqual(NativeScreenSwitch.screen(for: .accounts, defaults: defaults), .web)
        // The page is told once, under the tab's name
        let source = NativeScreensScript.source(defaults: defaults, expectedOrigin: "capacitor://localhost")
        XCTAssertEqual(source.components(separatedBy: "\"accounts\"").count - 1, 1)
    }

    func testTheListAndAKnownAccountPathAreNativeAndTheRestStayWeb() {
        XCTAssertEqual(NativeAccountsRoute.target(path: "/accounts"), .list)
        XCTAssertEqual(NativeAccountsRoute.target(path: "/accounts/"), .list)
        XCTAssertEqual(NativeAccountsRoute.target(path: "/accounts/checking-1"), .register("checking-1"))
        for web in ["/accounts/all", "/accounts/a/b", "/accounts/a b", "/transactions/t1", "/budget", "/accounts/..", ""] {
            XCTAssertNil(NativeAccountsRoute.target(path: web), web)
        }
    }

    func testItIsWantedOnlyWithTheSwitchOnTheTabBarShownAndTheTabSelected() {
        func wanted(on: Bool = true, bar: Bool = true, path: String = "/accounts/c1", tab: NativeTab = .accounts) -> NativeAccountsRoute? {
            NativeAccountsRoute.wanted(switchOn: on, tabBarShown: bar, path: path, selected: tab)
        }
        XCTAssertEqual(wanted(), .register("c1"))
        XCTAssertEqual(wanted(path: "/accounts"), .list)
        // Off or unset: web, whatever the path
        XCTAssertNil(wanted(on: false))
        // A sheet or the web editor hides the bar, so the screen steps aside, and is back on close
        XCTAssertNil(wanted(bar: false))
        XCTAssertNil(wanted(path: "/transactions/t1"))
        XCTAssertNil(wanted(path: "/accounts/all"))
        XCTAssertNil(wanted(tab: .budget))
    }

    private func list(_ ids: [String], closed: [String] = []) throws -> AccountsList {
        func account(_ id: String, _ isClosed: Bool) -> [String: Any] {
            [
                "id": id, "name": id, "balance": 0, "offbudget": false, "closed": isClosed, "lastSync": NSNull(),
                "lastTransactionDate": NSNull(), "bankSync": false, "clearingFor": NSNull(),
            ]
        }
        let section = { (total: Int, accounts: [[String: Any]]) -> [String: Any] in ["total": total, "accounts": accounts] }
        let json: [String: Any] = [
            "currencyCode": "", "currencyDecimalPlaces": 2, "currencySymbol": "", "currencySymbolPosition": "before",
            "currencySpace": false, "numberFormat": "comma-dot", "hideFraction": false,
            "sections": ["onBudget": section(0, ids.map { account($0, false) }), "offBudget": section(0, [])],
            "closed": section(0, closed.map { account($0, true) }), "netWorth": 0,
        ]
        return try JSONDecoder().decode(AccountsList.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testAnUnknownAccountIsNotShownNatively() throws {
        let known = try list(["c1"], closed: ["old"])
        XCTAssertTrue(NativeAccountsRoute.list.isKnown(in: known))
        XCTAssertTrue(NativeAccountsRoute.register("c1").isKnown(in: known))
        XCTAssertTrue(NativeAccountsRoute.register("old").isKnown(in: known))
        XCTAssertFalse(NativeAccountsRoute.register("nope").isKnown(in: known))
    }

    func testTheOpenAccountIdsAreWhatAHandOffMayName() throws {
        XCTAssertEqual(NativeAccountsRoute.openAccountIds(in: try list(["a", "b"], closed: ["old"])), ["a", "b"])
    }
}
