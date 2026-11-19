import NativeBridgeCore
import WebKit
import XCTest

@testable import HomeEconomicsMac

// sc-5399: without a UI delegate for them, WebKit drops a page's alert and
// answers confirm and prompt with nothing, so the person sees a blank page.
// The host shows them and gives the page the answer. A real page, served from
// a temporary www folder, opens each dialog.
@MainActor
final class MacPageDialogsTests: XCTestCase {
    private var www: URL!
    private var shown: [PageDialogRequest] = []

    override func setUp() async throws {
        www = FileManager.default.temporaryDirectory.appendingPathComponent("dialogs-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: www, withIntermediateDirectories: true)
        try Data("<!doctype html><title>dialogs</title><p>dialogs</p>".utf8).write(to: www.appendingPathComponent("index.html"))
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: www)
    }

    // A host whose dialogs are answered at once with `answer`
    private func loadedHost(answering answer: PageDialogAnswer) async throws -> MacEngineHost {
        let host = MacEngineHost(www: www, version: "test")
        host.presentDialog = { [unowned self] request, reply in
            self.shown.append(request)
            reply(answer)
            return {}
        }
        host.load()
        for _ in 0..<100 where host.webView.isLoading || host.webView.url == nil {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertFalse(host.webView.isLoading, "the test page never loaded")
        return host
    }

    private func run(_ host: MacEngineHost, _ script: String) async throws -> Any? {
        try await PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL).run(script)
    }

    func testAnAlertIsShownWithoutATitle() async throws {
        let host = try await loadedHost(answering: .dismissed)
        let result = try await run(host, "alert('We had an unknown problem opening the budget.'); return 'closed'")
        XCTAssertEqual(result as? String, "closed")
        XCTAssertEqual(shown, [PageDialogRequest(kind: .alert, message: "We had an unknown problem opening the budget.", title: nil)])
    }

    func testConfirmGetsThePersonsAnswer() async throws {
        let host = try await loadedHost(answering: .confirmed(true))
        let result = try await run(host, "return confirm('Delete the Groceries category?')")
        XCTAssertEqual(result as? Bool, true)
        XCTAssertEqual(shown.map(\.kind), [.confirm])
    }

    func testPromptGetsTheTextAndSeesTheDefault() async throws {
        let host = try await loadedHost(answering: .text("Food"))
        let result = try await run(host, "return prompt('Name the new category', 'Groceries')")
        XCTAssertEqual(result as? String, "Food")
        XCTAssertEqual(shown.map(\.kind), [.prompt(defaultText: "Groceries")])
    }

    // The page going away takes its dialog off the window and answers it once
    func testAReloadTakesTheDialogAway() async throws {
        let host = MacEngineHost(www: www, version: "test")
        var dismissed = 0
        host.presentDialog = { [unowned self] request, _ in
            self.shown.append(request)
            return { dismissed += 1 }
        }
        host.load()
        for _ in 0..<100 where host.webView.isLoading || host.webView.url == nil {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        var answered = false
        let call = Task {
            _ = try? await self.run(host, "return confirm('Delete the Groceries category?')")
            answered = true
        }
        for _ in 0..<100 where shown.isEmpty { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(shown.count, 1, "the dialog never showed")
        host.webView.reload()
        for _ in 0..<100 where dismissed == 0 { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(dismissed, 1, "the dialog stayed over the reloaded page")
        // Bounded: a dialog nobody answers holds the page's call, and an
        // unbounded wait for it hung the whole suite on CI
        for _ in 0..<100 where !answered { try await Task.sleep(nanoseconds: 50_000_000) }
        call.cancel()
        XCTAssertTrue(answered, "the page's call was never answered")
        XCTAssertEqual(dismissed, 1)
    }

    func testACancelledPromptGivesThePageNull() async throws {
        let host = try await loadedHost(answering: .text(nil))
        let result = try await run(host, "return String(prompt('Name the new category'))")
        XCTAssertEqual(result as? String, "null")
    }
}
