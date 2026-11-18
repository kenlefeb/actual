import XCTest

@testable import NativeBridgeCore

// native-bridge: "Web hand-offs are a closed set of messages" (sc-4931, D7a).
// The app checks the action and the account before anything reaches the page.
final class WebAccountActionTests: XCTestCase {
    private let open: Set<String> = ["checking", "savings"]

    func testAddAndLinkTakeNoAccountAndDropOneIfGiven() throws {
        for name in ["add-account", "link-account"] {
            XCTAssertNil(try WebAccountAction(name, accountId: nil, openAccountIds: open).accountId)
            XCTAssertNil(try WebAccountAction(name, accountId: "checking", openAccountIds: open).accountId)
        }
    }

    func testSettingsAndBankSyncNeedAKnownOpenAccount() throws {
        for name in ["account-settings", "bank-sync"] {
            XCTAssertEqual(try WebAccountAction(name, accountId: "savings", openAccountIds: open).accountId, "savings")
            XCTAssertThrowsError(try WebAccountAction(name, accountId: nil, openAccountIds: open))
            XCTAssertThrowsError(try WebAccountAction(name, accountId: "", openAccountIds: open))
            XCTAssertThrowsError(try WebAccountAction(name, accountId: "closed-one", openAccountIds: open))
        }
    }

    func testAnythingOutsideTheClosedSetIsRefused() {
        for name in ["delete-account", "close-account", "", "Add-Account"] {
            XCTAssertThrowsError(try WebAccountAction(name, accountId: "checking", openAccountIds: open))
        }
    }

    func testItCallsOnlyTheChromeHandOffWithItsTwoValues() throws {
        let add = try WebAccountAction("add-account", accountId: nil, openAccountIds: open)
        XCTAssertEqual(add.script, "window.__actualNativeChrome?.webAccountAction?.(action, accountId)")
        XCTAssertEqual(add.arguments["action"] as? String, "add-account")
        XCTAssertTrue(add.arguments["accountId"] is NSNull)
        let sync = try WebAccountAction("bank-sync", accountId: "checking", openAccountIds: open)
        XCTAssertEqual(sync.arguments["accountId"] as? String, "checking")
        XCTAssertEqual(Set(sync.arguments.keys), ["action", "accountId"])
    }
}
