import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge: "Swift calls into the page only while it is the app's own
// page" and "The expected origin comes from the server URL" (sc-3859)
@MainActor
final class FakePage: PageScriptRunner {
    var mainFrameURL: URL?
    var calls: [(script: String, arguments: [String: Any])] = []
    var reply: Any? = ["confirmed": true, "value": "{}"]
    var failure: Error?

    init(_ url: String?) { mainFrameURL = url.flatMap(URL.init(string:)) }

    func callPageMainFrame(_ script: String, arguments: [String: Any]) async throws -> Any? {
        calls.append((script, arguments))
        if let failure { throw failure }
        return reply
    }
}

@MainActor
final class PageCallTests: XCTestCase {
    private let server = URL(string: "capacitor://localhost")!

    private func refused(_ page: FakePage, _ work: (PageCall) async throws -> Void) async {
        do {
            try await work(PageCall(runner: page, serverURL: server))
            XCTFail("expected the origin error")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .pageOrigin)
        }
        XCTAssertTrue(page.calls.isEmpty, "the page must never be called")
    }

    private static let foreignPages: [String?] = [
        "https://tenant.auth0.com/authorize?state=abc",
        "http://localhost/",  // another scheme
        "capacitor://localhost:8080/",  // another port
        "https://actual.example.com/budget",  // the web app on the sync server
        "about:blank",
        nil,
    ]

    func testEveryCallIsRefusedOnAForeignOrMissingPage() async {
        for url in Self.foreignPages {
            await refused(FakePage(url)) { try await _ = $0.bridgeCall(name: "native/budget-month", argsJSON: #"{"month":"2026-11"}"#) }
            await refused(FakePage(url)) { try await _ = $0.bridgeCall(name: "budget/budget-amount", argsJSON: #"{"amount":1}"#) }
            await refused(FakePage(url)) { try await _ = $0.run("window.__actualNativeChrome?.navigate(path)", arguments: ["path": "/budget"]) }
        }
    }

    func testTheClientGetsTheOriginErrorAndNoArguments() async {
        let page = FakePage("https://login.example.com/authorize?state=abc")
        let client = NativeBridgeClient { name, args in try await PageCall(runner: page, serverURL: self.server).bridgeCall(name: name, argsJSON: args) }
        do {
            _ = try await client.budgetMonth("2026-11")
            XCTFail("expected the origin error")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .pageOrigin)
        }
        XCTAssertTrue(page.calls.isEmpty)
    }

    func testTheAppsOwnPageIsCalledOnceWithTheNameAndArguments() async throws {
        let page = FakePage("capacitor://localhost/budget")
        page.reply = ["confirmed": true, "value": #"{"ok":1}"#]
        let json = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "query", argsJSON: "{}")
        XCTAssertEqual(json, #"{"ok":1}"#)
        XCTAssertEqual(page.calls.count, 1)
        XCTAssertEqual(page.calls.first?.arguments["name"] as? String, "query")
        XCTAssertEqual(page.calls.first?.arguments["args"] as? String, "{}")
    }

    func testABridgeErrorInsideTheConfirmedShapeIsReturnedAsBefore() async {
        let page = FakePage("capacitor://localhost/budget")
        page.reply = ["confirmed": true, "error": "native/budget-month: no budget for month 2020-01"]
        do {
            _ = try await PageCall(runner: page, serverURL: server).bridgeCall(name: "native/budget-month", argsJSON: "{}")
            XCTFail("expected the bridge error")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .page("native/budget-month: no budget for month 2020-01"))
            XCTAssertEqual(BudgetLoadError.from(error), .noBudgetForMonth)
        }
    }

    // native-bridge: "Swift trusts only a confirmed result"
    func testAnUnconfirmedResultIsTheOriginError() async {
        let unconfirmed: [Any?] = [PageCall.sentinel, "https://login.example.com", 1, ["value": "{}"], ["confirmed": "yes", "value": "{}"], nil]
        for reply in unconfirmed {
            let page = FakePage("capacitor://localhost/budget")
            page.reply = reply
            do {
                _ = try await PageCall(runner: page, serverURL: server).run("return 1")
                XCTFail("expected the origin error for \(String(describing: reply))")
            } catch {
                XCTAssertEqual(error as? NativeBridgeError, .pageOrigin)
            }
        }
    }

    // A WebKit exception from an unconfirmed call can carry the foreign URL
    func testAWebKitErrorWithAForeignSourceURLIsTheOriginError() async {
        let page = FakePage("capacitor://localhost/budget")
        page.failure = NSError(domain: "WKErrorDomain", code: 4, userInfo: [
            "WKJavaScriptExceptionSourceURL": URL(string: "https://login.example.com/authorize?state=abc")!,
            "WKJavaScriptExceptionMessage": "https://login.example.com/authorize?state=abc",
            NSLocalizedDescriptionKey: "A JavaScript exception occurred at https://login.example.com",
        ])
        do {
            _ = try await PageCall(runner: page, serverURL: server).run("return 1")
            XCTFail("expected the origin error")
        } catch {
            XCTAssertEqual(error as? NativeBridgeError, .pageOrigin)
            let text = "\(error) \(String(reflecting: error)) \(error.localizedDescription) \((error as NSError).userInfo)"
            XCTAssertFalse(text.contains("login.example.com"))
            XCTAssertFalse(text.contains("state=abc"))
        }
    }

    // MARK: The expected origin (10.2)

    func testTheExpectedOriginIsInLocationOriginForm() {
        let cases: [(String, String)] = [
            ("capacitor://localhost", "capacitor://localhost"),
            ("http://localhost:3001", "http://localhost:3001"),
            ("https://host:443", "https://host"),
            ("http://host:80/", "http://host"),
            ("HTTPS://App.Example.COM/path?q=1", "https://app.example.com"),
            ("https://host:8443", "https://host:8443"),
            ("http://[::1]:3001", "http://[::1]:3001"),
            ("https://[2001:db8::1]:443", "https://[2001:db8::1]"),
        ]
        for (server, origin) in cases {
            XCTAssertEqual(PageCall.expectedOrigin(serverURL: URL(string: server)), origin, server)
        }
        XCTAssertNil(PageCall.expectedOrigin(serverURL: nil))
    }

    func testAnExplicitDefaultPortServerAcceptsItsPage() async throws {
        let page = FakePage("https://host/budget")
        _ = try await PageCall(runner: page, serverURL: URL(string: "https://host:443")!).run("return 1")
        XCTAssertEqual(page.calls.count, 1)
    }

    func testTheExpectedOriginIsAnArgumentNotNamedLocationOrWindow() async throws {
        let page = FakePage("http://localhost:3001/budget")
        _ = try await PageCall(runner: page, serverURL: URL(string: "http://localhost:3001")!).run("return 1", arguments: ["location": "x"])
        let arguments = try XCTUnwrap(page.calls.first?.arguments)
        XCTAssertEqual(arguments[PageCall.originArgument] as? String, "http://localhost:3001")
        XCTAssertFalse(["location", "window"].contains(PageCall.originArgument))
        // A caller cannot pass an argument that shadows the check
        XCTAssertNil(arguments["location"])
        XCTAssertNil(arguments["window"])
    }
}

// native-bridge: "Back on the app's own page" (sc-3859). The page bridge posts
// "ready" when it installs; the screen re-reads on it, so a refusal while a
// sign-in page showed does not leave it on the error state.
@MainActor
final class BudgetReadyTests: XCTestCase {
    private var envelopeJSON: String {
        get throws {
            let url = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("loot-core/src/server/native/fixtures/budget-month-envelope.json")
            return String(decoding: try Data(contentsOf: url), as: UTF8.self)
        }
    }

    func testTheReadyMessageReReadsAfterAnOriginRefusal() async throws {
        let json = try envelopeJSON
        var foreign = true
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in
            if foreign { throw NativeBridgeError.pageOrigin }
            return json
        })
        await model.load()
        guard case .failed = model.state else { return XCTFail("expected failed, got \(model.state)") }
        foreign = false
        await model.pageReady()
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    // sc-3965: "ready" re-reads only after a refused or failed read, or before any month loaded
    func testTheReadyMessageMakesNoExtraReadWhenTheMonthIsLoaded() async throws {
        let json = try envelopeJSON
        var reads = 0
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in reads += 1; return json })
        await model.load()
        XCTAssertEqual(reads, 1)
        await model.pageReady()
        XCTAssertEqual(reads, 1)
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testTheReadyMessageLoadsOnAColdStart() async throws {
        let json = try envelopeJSON
        var reads = 0
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in reads += 1; return json })
        await model.pageReady()
        XCTAssertEqual(reads, 1)
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testTheReadyMessageReReadsAfterAFailedRead() async throws {
        let json = try envelopeJSON
        var fail = true
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in
            if fail { throw NativeBridgeError.timedOut("native/budget-month") }
            return json
        })
        await model.load()
        guard case .failed = model.state else { return XCTFail("expected failed, got \(model.state)") }
        fail = false
        await model.pageReady()
        guard case .loaded = model.state else { return XCTFail("expected loaded, got \(model.state)") }
    }

    func testTheReadyMessageWaitsWhileTheSceneIsInactive() async throws {
        let json = try envelopeJSON
        var reads = 0
        let model = BudgetViewModel(client: NativeBridgeClient { _, _ in reads += 1; return json })
        await model.setSceneActive(false)
        await model.pageReady()
        XCTAssertEqual(reads, 0)
        // The read on becoming active covers it
        await model.setSceneActive(true)
        XCTAssertEqual(reads, 1)
    }
}
