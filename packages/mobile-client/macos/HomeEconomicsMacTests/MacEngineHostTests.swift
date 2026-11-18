import NativeBridgeCore
import WebKit
import XCTest

@testable import HomeEconomicsMac

// sc-4942 task 1.4: the engine host's origin guard, navigation policy and
// web view configuration
@MainActor
final class MacEngineHostTests: XCTestCase {
    private let hosts: Set<String> = ["actual-staging.owl-becrux.ts.net", "actual-staging.us.auth0.com"]

    private func decide(_ string: String, mainFrame: Bool = true, userClicked: Bool = false, fromAppPage: Bool = true)
        -> NavigationDecision
    {
        NavigationPolicy(allowedHosts: hosts).decide(
            URL(string: string)!, isMainFrame: mainFrame, userClicked: userClicked, fromAppPage: fromAppPage)
    }

    private static let appPage = PageOrigin(scheme: "homeeconomics", host: "localhost", port: 0, isMainFrame: true)
    private static let providerPage = PageOrigin(scheme: "https", host: "actual-staging.us.auth0.com", port: 0, isMainFrame: true)

    // A navigation as WebKit reports it: a click (link, mouse button) or not
    private final class FakeAction: WKNavigationAction {
        private let fakeRequest: URLRequest
        private let fakeType: WKNavigationType
        private let fakeButton: Int
        // The page that showed the link (WKSecurityOrigin can't be made in a test)
        let source: PageOrigin?
        init(_ url: String, type: WKNavigationType, button: Int = 0, source: PageOrigin? = MacEngineHostTests.appPage) {
            fakeRequest = URLRequest(url: URL(string: url)!)
            fakeType = type
            fakeButton = button
            self.source = source
            super.init()
        }
        override var request: URLRequest { fakeRequest }
        override var navigationType: WKNavigationType { fakeType }
        override var buttonNumber: Int { fakeButton }
        // nil: the main frame, as for a new-window request
        override var targetFrame: WKFrameInfo? { nil }
    }

    private var opened: [URL] = []
    private var refusedSignIns = 0

    private func host() -> MacEngineHost {
        let host = MacEngineHost(
            www: FileManager.default.temporaryDirectory, version: "test", policy: NavigationPolicy(allowedHosts: hosts),
            openInBrowser: { [unowned self] in self.opened.append($0) })
        host.onRefusedSignIn = { [unowned self] in self.refusedSignIns += 1 }
        host.sourceOrigin = { ($0 as? FakeAction)?.source }
        return host
    }

    private func navigate(_ host: MacEngineHost, _ action: WKNavigationAction) async -> WKNavigationActionPolicy {
        await host.webView(host.webView, decidePolicyFor: action)
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

    // MARK: Page messages (task 1.4a)

    func testBudgetStateFromTheAppsPageIsDelivered() {
        let host = host()
        var states: [BudgetState] = []
        host.onBudgetState = { states.append($0) }
        host.receive(["event": "budget-state", "payload": ["state": "none"]], isMainFrame: true, scheme: "homeeconomics", host: "localhost", port: 0)
        XCTAssertEqual(states, [BudgetState.none])
    }

    func testBudgetStateFromAnotherPageOrFrameIsIgnored() {
        let host = host()
        var states: [BudgetState] = []
        host.onBudgetState = { states.append($0) }
        let body = ["event": "budget-state", "payload": ["state": "none"]] as [String: Any]
        host.receive(body, isMainFrame: true, scheme: "https", host: "actual-staging.us.auth0.com", port: 0)
        host.receive(body, isMainFrame: false, scheme: "homeeconomics", host: "localhost", port: 0)
        XCTAssertTrue(states.isEmpty)
    }

    func testAMalformedBudgetStateIsIgnored() {
        let host = host()
        var states: [BudgetState] = []
        host.onBudgetState = { states.append($0) }
        host.receive(["event": "budget-state", "payload": ["state": "none", "cloudFileId": "x"]], isMainFrame: true, scheme: "homeeconomics", host: "localhost", port: 0)
        XCTAssertTrue(states.isEmpty)
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

    func testAClickedLinkToAnotherHostOpensInTheBrowser() {
        XCTAssertEqual(decide("https://actualbudget.org/docs", userClicked: true), .openInBrowser)
        XCTAssertEqual(decide("https://evil.example/actual-staging.us.auth0.com", userClicked: true), .openInBrowser)
    }

    // PR 413 round 3: a redirect or script navigation can carry a token or code
    func testAnUnclickedNavigationToAnotherHostIsRefusedNotOpened() {
        XCTAssertEqual(decide("https://idp.example/authorize?code=x"), .refuseSignIn)
        XCTAssertEqual(decide("https://evil.example/", mainFrame: false, userClicked: true), .cancel)
    }

    // Story 5014: a click on the provider's or server's page could carry sign-in on outside the app
    func testAClickedLinkOnAnotherPageIsCancelled() {
        XCTAssertEqual(decide("https://accounts.google.com/o/oauth2/auth?x=1", userClicked: true, fromAppPage: false), .cancel)
    }

    func testTheDelegateCancelsAClickOnTheProvidersPage() async {
        let host = host()
        let link = FakeAction("https://accounts.google.com/o/oauth2/auth?state=SECRET", type: .linkActivated, source: Self.providerPage)
        let policy = await navigate(host, link)
        XCTAssertEqual(policy, .cancel)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertEqual(refusedSignIns, 0)
    }

    func testTheDelegateCancelsAClickWithNoKnownSourcePage() async {
        let host = host()
        let policy = await navigate(host, FakeAction("https://actualbudget.org/", type: .linkActivated, source: nil))
        XCTAssertEqual(policy, .cancel)
        XCTAssertTrue(opened.isEmpty)
    }

    func testANewWindowFromTheProvidersPageOpensNothing() {
        let host = host()
        let action = FakeAction("https://accounts.google.com/", type: .linkActivated, source: Self.providerPage)
        XCTAssertNil(host.webView(host.webView, createWebViewWith: WKWebViewConfiguration(), for: action, windowFeatures: WKWindowFeatures()))
        XCTAssertTrue(opened.isEmpty)
    }

    func testAClickedHttpLinkIsRefused() {
        XCTAssertEqual(decide("http://example.com/", userClicked: true), .cancel)
    }

    func testTheDelegateOpensOnlyAClickedLink() async {
        let host = host()
        let policy = await navigate(host, FakeAction("https://actualbudget.org/docs", type: .linkActivated, button: 0))
        XCTAssertEqual(policy, .cancel)
        XCTAssertEqual(opened, [URL(string: "https://actualbudget.org/docs")!])
        XCTAssertEqual(refusedSignIns, 0)
    }

    func testARedirectWithATokenIsCancelledAndNeverOpened() async {
        let host = host()
        // A server redirect reports .other, as a script navigation does
        let policy = await navigate(host, FakeAction("https://unlisted.example/openid-cb?token=SECRET&code=SECRET", type: .other))
        XCTAssertEqual(policy, .cancel)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertEqual(refusedSignIns, 1)
    }

    func testAFormPostOrReloadToAnotherHostIsNeverOpened() async {
        let host = host()
        for type in [WKNavigationType.formSubmitted, .formResubmitted, .reload, .backForward] {
            let policy = await navigate(host, FakeAction("https://unlisted.example/cb?code=SECRET", type: type))
            XCTAssertEqual(policy, .cancel)
        }
        XCTAssertTrue(opened.isEmpty)
    }

    func testANewWindowOpensOnlyForAClickedLink() {
        let host = host()
        let config = WKWebViewConfiguration()
        let features = WKWindowFeatures()
        XCTAssertNil(host.webView(host.webView, createWebViewWith: config, for: FakeAction("https://unlisted.example/?token=SECRET", type: .other), windowFeatures: features))
        XCTAssertTrue(opened.isEmpty)
        XCTAssertNil(host.webView(host.webView, createWebViewWith: config, for: FakeAction("https://actualbudget.org/", type: .linkActivated, button: 0), windowFeatures: features))
        XCTAssertEqual(opened, [URL(string: "https://actualbudget.org/")!])
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

    // Story 5186: Safari's Web Inspector can attach only to Debug builds
    func testOnlyADebugBuildIsInspectable() {
        XCTAssertFalse(MacEngineHost.isInspectable(debugBuild: false))
        XCTAssertTrue(MacEngineHost.isInspectable(debugBuild: true))
    }

    func testTheWebViewFollowsItsBuild() {
        let host = MacEngineHost(www: FileManager.default.temporaryDirectory, version: "1.2.3")
        #if DEBUG
        XCTAssertTrue(host.webView.isInspectable)
        #else
        XCTAssertFalse(host.webView.isInspectable)
        #endif
    }
}
