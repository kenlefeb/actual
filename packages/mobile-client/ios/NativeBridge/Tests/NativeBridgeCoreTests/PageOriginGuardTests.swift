import XCTest

@testable import NativeBridgeCore

// native-bridge: "The bridge accepts messages only from the app's own page" (sc-3697)
final class PageOriginGuardTests: XCTestCase {
    private let server = URL(string: "https://app.example.com")!

    // WKSecurityOrigin reports port 0 for a scheme's default port
    private func accepts(main: Bool = true, scheme: String = "https", host: String = "app.example.com", port: Int = 0) -> Bool {
        PageOriginGuard.accepts(isMainFrame: main, scheme: scheme, host: host, port: port, serverURL: server)
    }

    func testTheAppsMainFrameIsAccepted() {
        XCTAssertTrue(accepts())
    }

    func testAServerOnAnExplicitPortIsAccepted() {
        let url = URL(string: "http://localhost:3001")!
        XCTAssertTrue(PageOriginGuard.accepts(isMainFrame: true, scheme: "http", host: "localhost", port: 3001, serverURL: url))
    }

    func testASubframeIsRejected() {
        XCTAssertFalse(accepts(main: false))
    }

    func testAnotherHostIsRejected() {
        XCTAssertFalse(accepts(host: "tenant.auth0.com"))
    }

    func testAnotherSchemeIsRejected() {
        XCTAssertFalse(accepts(scheme: "http"))
    }

    func testAnotherPortIsRejected() {
        XCTAssertFalse(accepts(port: 8443))
    }

    func testAMixedCaseServerURLIsAccepted() {
        let url = URL(string: "HTTPS://App.Example.COM")!
        XCTAssertTrue(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "app.example.com", port: 0, serverURL: url))
    }

    func testAMixedCaseMessageOriginIsAccepted() {
        XCTAssertTrue(accepts(scheme: "HTTPS", host: "APP.example.com"))
    }

    // A default-port message (port 0) matches a server URL that spells the default port out
    func testDefaultPortMessageMatchesExplicitDefaultPortServer() {
        let url = URL(string: "https://app.example.com:443")!
        XCTAssertTrue(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "app.example.com", port: 0, serverURL: url))
    }

    func testDefaultPortMessageIsRejectedForANonDefaultPortServer() {
        let url = URL(string: "https://app.example.com:8443")!
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "app.example.com", port: 0, serverURL: url))
    }

    func testHttpDefaultPortIs80() {
        let url = URL(string: "http://app.example.com:80")!
        XCTAssertTrue(PageOriginGuard.accepts(isMainFrame: true, scheme: "http", host: "app.example.com", port: 0, serverURL: url))
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "http", host: "app.example.com", port: 443, serverURL: url))
    }

    func testNoServerURLRejectsEverything() {
        XCTAssertFalse(PageOriginGuard.accepts(isMainFrame: true, scheme: "https", host: "app.example.com", port: 0, serverURL: nil))
    }
}
