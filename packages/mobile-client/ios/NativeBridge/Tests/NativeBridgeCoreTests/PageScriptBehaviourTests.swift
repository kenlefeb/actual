#if canImport(JavaScriptCore)
import Foundation
import JavaScriptCore
import XCTest

@testable import NativeBridgeCore

// native-bridge: "The origin is checked again where the call runs", "An origin
// refusal reveals nothing about the foreign page" and "Injected page scripts
// act only on the app's own page" (sc-3859). The real script text runs in
// JavaScriptCore, as WebKit runs a script call: an async function body
// whose parameters are the argument names.
@MainActor
final class JSContextPage: PageScriptRunner {
    let context = JSContext()!
    var mainFrameURL: URL?

    init(swiftSees url: String, origin: String, prelude: String = "") {
        mainFrameURL = URL(string: url)
        context.evaluateScript("var window = this; var spied = []; var location = { origin: '\(origin)' };\n\(prelude)")
    }

    var spied: [String] { context.objectForKeyedSubscript("spied").toArray() as? [String] ?? [] }

    func callPageMainFrame(_ script: String, arguments: [String: Any]) async throws -> Any? {
        let names = arguments.keys.sorted()
        let function = context.evaluateScript("(async function(\(names.joined(separator: ", "))) {\n\(script)\n})")!
        let promise = function.call(withArguments: names.map { arguments[$0]! })!
        var settled: Result<Any?, Error>?
        let resolve: @convention(block) (JSValue) -> Void = { settled = .success($0.toObject()) }
        let reject: @convention(block) (JSValue) -> Void = { settled = .failure(NSError(domain: "WKErrorDomain", code: 4, userInfo: ["WKJavaScriptExceptionMessage": $0.toString() ?? ""])) }
        promise.invokeMethod("then", withArguments: [JSValue(object: resolve, in: context)!, JSValue(object: reject, in: context)!])
        for _ in 0..<100 where settled == nil { await Task.yield() }
        return try XCTUnwrap(settled).get()
    }
}

@MainActor
final class PageScriptBehaviourTests: XCTestCase {
    private let server = URL(string: "capacitor://localhost")!
    private let foreignURL = "https://login.example.com/authorize?state=abc"

    // A foreign page that replaced the globals a script might touch
    private var hostilePrelude: String {
        """
        JSON.parse = function () { spied.push('JSON.parse'); return {}; };
        Error = function () { spied.push('Error'); throw '\(foreignURL)'; };
        window.__actualNativeBridge = { call: function () { spied.push('bridge'); return '{"fake":1}'; } };
        """
    }

    private func assertRefusedQuietly(_ page: JSContextPage, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "budget/budget-amount", argsJSON: #"{"amount":1}"#)
            XCTFail("expected the origin error", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .pageOrigin, file: file, line: line)
            let text = "\(error) \(String(reflecting: error)) \(error.localizedDescription)"
            XCTAssertFalse(text.contains("login.example.com"), file: file, line: line)
        }
        XCTAssertEqual(page.spied, [], "no page function may run", file: file, line: line)
    }

    // Swift's check passed, then a foreign page committed before the script ran
    func testANavigationBetweenTheTwoChecksIsRefusedInThePage() async {
        await assertRefusedQuietly(JSContextPage(swiftSees: "capacitor://localhost/budget", origin: "https://login.example.com", prelude: hostilePrelude))
    }

    func testTheScriptReturnsTheSentinelBeforeTouchingAnything() async throws {
        let page = JSContextPage(swiftSees: "capacitor://localhost/budget", origin: "https://login.example.com", prelude: hostilePrelude)
        let result = try await page.callPageMainFrame(PageCall.script(PageCall.bridgeCallBody), arguments: [
            "name": "budget/budget-amount", "args": "{}", PageCall.originArgument: "capacitor://localhost",
        ])
        XCTAssertEqual(result as? String, PageCall.sentinel)
        XCTAssertEqual(page.spied, [])
    }

    func testTheAppsOwnPageReturnsTheConfirmedResult() async throws {
        let page = JSContextPage(swiftSees: "capacitor://localhost/budget", origin: "capacitor://localhost", prelude: """
            window.__actualNativeBridge = { call: async function (name, args) { return JSON.stringify({ name: name, month: args.month }); } };
            """)
        let json = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "native/budget-month", argsJSON: #"{"month":"2026-11"}"#)
        XCTAssertEqual(json, #"{"name":"native/budget-month","month":"2026-11"}"#)
    }

    func testABridgeErrorOnTheAppsOwnPageComesBackInsideTheConfirmedShape() async {
        let page = JSContextPage(swiftSees: "capacitor://localhost/budget", origin: "capacitor://localhost", prelude: """
            window.__actualNativeBridge = { call: async function () { throw new Error('native/budget-month: no budget for month 2020-01'); } };
            """)
        do {
            _ = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "native/budget-month", argsJSON: "{}")
            XCTFail("expected the bridge error")
        } catch {
            XCTAssertEqual(BudgetLoadError.from(error), .noBudgetForMonth)
            XCTAssertNotEqual(error as? NativeBridgeError, .pageOrigin)
        }
    }

    func testAnAppPageWithNoBridgeYetIsABridgeErrorNotARefusal() async {
        let page = JSContextPage(swiftSees: "capacitor://localhost/budget", origin: "capacitor://localhost")
        do {
            _ = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "query", argsJSON: "{}")
            XCTFail("expected the bridge error")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .page("native bridge: page not ready"))
        }
    }

    // MARK: NativeScreensScript (10.4)

    private func screens(origin: String, expected: String?) -> JSValue? {
        let context = JSContext()!
        context.evaluateScript("var window = this; var location = { origin: '\(origin)' };")
        let defaults = UserDefaults(suiteName: "PageScriptBehaviourTests")!
        defaults.set(true, forKey: NativeScreenSwitch.key(for: .budget))
        context.evaluateScript(NativeScreensScript.source(defaults: defaults, expectedOrigin: expected))
        let value = context.objectForKeyedSubscript("__actualNativeScreens")
        return value?.isUndefined == false ? value : nil
    }

    func testASignInPageGetsNoNativeScreens() {
        XCTAssertNil(screens(origin: "https://login.example.com", expected: "capacitor://localhost"))
        XCTAssertNil(screens(origin: "capacitor://localhost", expected: nil))
    }

    func testTheAppsPageGetsTheSwitchValues() {
        XCTAssertEqual(screens(origin: "capacitor://localhost", expected: "capacitor://localhost")?.forProperty("budget")?.toBool(), true)
    }
}
#endif
