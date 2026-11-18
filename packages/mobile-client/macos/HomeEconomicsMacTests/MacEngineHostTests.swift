import WebKit
import XCTest

@testable import HomeEconomicsMac

// sc-4942 task 1.4: the engine host's origin guard, navigation policy and
// web view configuration
@MainActor
final class MacEngineHostTests: XCTestCase {
    private let hosts: Set<String> = ["actual-staging.owl-becrux.ts.net", "actual-staging.us.auth0.com"]

    private func decide(_ string: String, mainFrame: Bool = true) -> NavigationDecision {
        NavigationPolicy(allowedHosts: hosts).decide(URL(string: string)!, isMainFrame: mainFrame)
    }

    // MARK: Origin guard

    func testTheGuardAcceptsTheAppsOwnPage() {
        XCTAssertTrue(MacEngineHost.acceptsMessage(isMainFrame: true, scheme: "homeeconomics", host: "localhost", port: 0))
    }

    func testTheGuardRefusesTheProviderTheServersWebAppAndFrames() {
        XCTAssertFalse(MacEngineHost.acceptsMessage(isMainFrame: true, scheme: "https", host: "actual-staging.us.auth0.com", port: 0))
        XCTAssertFalse(MacEngineHost.acceptsMessage(isMainFrame: true, scheme: "https", host: "actual-staging.owl-becrux.ts.net", port: 0))
        XCTAssertFalse(MacEngineHost.acceptsMessage(isMainFrame: true, scheme: "https", host: "localhost", port: 0))
        XCTAssertFalse(MacEngineHost.acceptsMessage(isMainFrame: false, scheme: "homeeconomics", host: "localhost", port: 0))
    }

    // MARK: Navigation

    func testTheAppsSchemeStaysInFrame() {
        XCTAssertEqual(decide("homeeconomics://localhost/openid-cb?token=x"), .allow)
    }

    func testHttpsOnTheServerAndProviderStaysInFrame() {
        XCTAssertEqual(decide("https://actual-staging.owl-becrux.ts.net/openid/login"), .allow)
        XCTAssertEqual(decide("https://actual-staging.us.auth0.com/authorize?x=1"), .allow)
    }

    func testAPlainHttpServerIsRefused() {
        XCTAssertEqual(decide("http://actual-staging.owl-becrux.ts.net/"), .cancel)
        XCTAssertEqual(decide("http://192.168.1.10:5006/"), .cancel)
    }

    func testAnotherHostOpensInTheBrowser() {
        XCTAssertEqual(decide("https://actualbudget.org/docs"), .openInBrowser)
        XCTAssertEqual(decide("https://evil.example/actual-staging.us.auth0.com"), .openInBrowser)
    }

    func testAnotherHostInAFrameIsDropped() {
        XCTAssertEqual(decide("https://evil.example/", mainFrame: false), .cancel)
    }

    func testOtherSchemesAreRefused() {
        XCTAssertEqual(decide("file:///etc/passwd"), .cancel)
        XCTAssertEqual(decide("homeeconomics://evil/index.html"), .cancel)
        XCTAssertEqual(decide("javascript:alert(1)"), .cancel)
    }

    func testTheHostListComesFromInfoPlist() {
        let listed = NavigationPolicy.bundledHosts(Bundle(for: MacEngineHost.self))
        XCTAssertTrue(listed.contains("actual-production.owl-becrux.ts.net"))
        XCTAssertTrue(listed.contains("actual-staging.us.auth0.com"))
    }

    // MARK: Web view configuration

    func testTheWebViewIsNotWeakened() {
        let host = MacEngineHost(www: FileManager.default.temporaryDirectory, version: "1.2.3")
        let configuration = host.webView.configuration
        XCTAssertTrue(configuration.userContentController.userScripts.isEmpty)
        XCTAssertNotNil(configuration.urlSchemeHandler(forURLScheme: "homeeconomics"))
        XCTAssertEqual(configuration.applicationNameForUserAgent, "HomeEconomicsMac/1.2.3")
        XCTAssertTrue(configuration.websiteDataStore.isPersistent)
        XCTAssertFalse(configuration.preferences.javaScriptCanOpenWindowsAutomatically)
    }
}
