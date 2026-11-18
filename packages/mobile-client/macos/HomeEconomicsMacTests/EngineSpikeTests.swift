import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// sc-4942 task 1.7, criterion 1 (the part that needs no server): the staged
// web build loads from homeeconomics://localhost, recognizes the Mac shell and
// starts loot-core in the direct Worker in the fallback mode. Skipped when no
// www is bundled (CI builds without a web build).
@MainActor
final class EngineSpikeTests: XCTestCase {
    func testTheBundledPageStartsTheEngine() async throws {
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: www.appendingPathComponent("index.html").path), "no staged www")

        let host = MacEngineHost(www: www, version: "spike")
        host.load()
        let page = PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL)
        let probe = """
            return JSON.stringify({
              isolated: self.crossOriginIsolated,
              sharedArrayBuffer: typeof SharedArrayBuffer,
              override: localStorage.getItem('SharedArrayBufferOverride'),
              bridge: typeof window.__actualNativeBridge,
              userAgent: navigator.userAgent,
            });
            """
        var facts: [String: Any] = [:]
        for _ in 0..<60 {
            if let json = try? await page.run(probe) as? String,
                let decoded = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
            {
                facts = decoded
                if facts["bridge"] as? String == "object" { break }
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        // Recorded, not asserted: the design expected crossOriginIsolated to
        // be false; on macOS 27 it reports true, yet SharedArrayBuffer is still
        // missing, so the fallback mode is what runs either way
        print("engine spike facts: \(facts)")
        XCTAssertEqual(facts["override"] as? String, "true")
        XCTAssertEqual(facts["bridge"] as? String, "object")
        XCTAssertTrue((facts["userAgent"] as? String ?? "").contains("HomeEconomicsMac/spike"))

        // A round trip through the backend Worker: sync answers (here with no
        // budget open) instead of timing out, so the engine is running
        let start = Date()
        let sync = try await host.client.sync()
        print("engine spike sync with no budget: \(sync) in \(Int(Date().timeIntervalSince(start) * 1000)) ms")
    }
}
