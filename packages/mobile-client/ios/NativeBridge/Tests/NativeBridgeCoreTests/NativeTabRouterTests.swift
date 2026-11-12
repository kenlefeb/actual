import XCTest

@testable import NativeBridgeCore

// native-appearance: "iPhone uses a native tab bar" (sc-3514). One web view
// serves every web tab, so the router remembers each tab's last screen.
final class NativeTabRouterTests: XCTestCase {
    func testATabOpensItsSectionFirst() {
        var router = NativeTabRouter()
        XCTAssertEqual(router.select(.accounts), "/accounts")
        XCTAssertEqual(router.selected, .accounts)
    }

    func testSwitchingBackReturnsToWhereTheTabWas() {
        var router = NativeTabRouter()
        XCTAssertNil(router.pageDidRoute(to: "/budget"))
        XCTAssertNil(router.pageDidRoute(to: "/categories/c1"))

        _ = router.select(.accounts)
        XCTAssertNil(router.pageDidRoute(to: "/accounts/a1"))

        XCTAssertEqual(router.select(.budget), "/categories/c1")
        XCTAssertEqual(router.select(.accounts), "/accounts/a1")
    }

    func testAPageLinkToAnotherSectionSelectsItsTab() {
        var router = NativeTabRouter()
        XCTAssertEqual(router.pageDidRoute(to: "/reports/r1"), .reports)
        XCTAssertEqual(router.selected, .reports)
        XCTAssertEqual(router.select(.reports), "/reports/r1")
    }

    func testAddOpensTheNewTransactionScreenInTheCurrentTab() {
        var router = NativeTabRouter()
        _ = router.select(.accounts)
        XCTAssertNil(router.pageDidRoute(to: NativeTabRouter.addPath))
        XCTAssertEqual(router.selected, .accounts)
        XCTAssertEqual(NativeTabRouter.addPath, "/transactions/new")
    }

    func testOnlyTheFourSectionsAreTabs() {
        XCTAssertEqual(NativeTab.allCases.map(\.rootPath), ["/budget", "/accounts", "/reports", "/settings"])
        XCTAssertEqual(NativeTab.owning(path: "/settings/files"), .settings)
        XCTAssertNil(NativeTab.owning(path: "/schedules"))
        XCTAssertNil(NativeTab.owning(path: "/"))
    }
}
