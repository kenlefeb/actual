import XCTest

@testable import HomeEconomicsMac

// sc-4942 task 1.2: the scheme serves only the bundled web build
final class WWWSchemeHandlerTests: XCTestCase {
    private var base: URL!
    private var www: URL!
    private var logged: [String] = []
    private var handler: WWWSchemeHandler!

    override func setUpWithError() throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        www = base.appendingPathComponent("www")
        let fm = FileManager.default
        try fm.createDirectory(at: www.appendingPathComponent("assets"), withIntermediateDirectories: true)
        try fm.createDirectory(at: base.appendingPathComponent("www2"), withIntermediateDirectories: true)
        try Data("<html>index</html>".utf8).write(to: www.appendingPathComponent("index.html"))
        try Data("console.log(1)".utf8).write(to: www.appendingPathComponent("assets/app.js"))
        try Data([0, 97, 115, 109]).write(to: www.appendingPathComponent("assets/sql.wasm"))
        try Data("{}".utf8).write(to: www.appendingPathComponent("manifest.webmanifest"))
        try Data("secret".utf8).write(to: base.appendingPathComponent("Info.plist"))
        try Data("secret".utf8).write(to: base.appendingPathComponent("www2/secret.txt"))
        logged = []
        handler = WWWSchemeHandler(root: www) { [unowned self] in self.logged.append($0) }
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func get(_ string: String) -> WWWResponse {
        handler.response(for: URL(string: string)!)
    }

    private func body(_ r: WWWResponse) -> String { String(decoding: r.body, as: UTF8.self) }

    func testServesAFileWithItsTypeAndIsolationHeaders() {
        let r = get("homeeconomics://localhost/assets/app.js")
        XCTAssertEqual(r.status, 200)
        XCTAssertEqual(body(r), "console.log(1)")
        XCTAssertEqual(r.headers["Content-Type"], "text/javascript")
        XCTAssertEqual(r.headers["Cross-Origin-Opener-Policy"], "same-origin")
        XCTAssertEqual(r.headers["Cross-Origin-Embedder-Policy"], "require-corp")
    }

    func testMimeTypes() {
        XCTAssertEqual(get("homeeconomics://localhost/assets/sql.wasm").headers["Content-Type"], "application/wasm")
        XCTAssertEqual(get("homeeconomics://localhost/index.html").headers["Content-Type"], "text/html")
        XCTAssertEqual(get("homeeconomics://localhost/manifest.webmanifest").headers["Content-Type"], "application/manifest+json")
    }

    func testTheRootServesIndex() {
        XCTAssertEqual(body(get("homeeconomics://localhost/")), "<html>index</html>")
        XCTAssertEqual(body(get("homeeconomics://localhost")), "<html>index</html>")
    }

    func testClientRoutesServeIndex() {
        for path in ["/openid-cb?token=x", "/budget", "/accounts/abc", "/openid-cb#frag"] {
            let r = get("homeeconomics://localhost\(path)")
            XCTAssertEqual(r.status, 200, path)
            XCTAssertEqual(body(r), "<html>index</html>", path)
            XCTAssertEqual(r.headers["Cross-Origin-Embedder-Policy"], "require-corp", path)
        }
    }

    func testAMissingAssetIsNotFound() {
        let r = get("homeeconomics://localhost/missing.js")
        XCTAssertEqual(r.status, 404)
        XCTAssertTrue(r.body.isEmpty)
    }

    func testRefusesTraversalAndOddPaths() {
        for path in [
            "/%2e%2e/Info.plist",
            "/..%2f..%2fInfo.plist",
            "/%252e%252e/Info.plist",
            "/%2e%2e/www2/secret.txt",
            "/assets/..%2f..%2fwww2/secret.txt",
            "/index.html%00.js",
            "/assets%5capp.js",
            "//etc/passwd",
        ] {
            let r = get("homeeconomics://localhost\(path)")
            XCTAssertEqual(r.status, 403, path)
            XCTAssertTrue(r.body.isEmpty, path)
        }
    }

    func testRefusesOtherHostsAndSchemes() {
        XCTAssertEqual(get("homeeconomics://evil.example/index.html").status, 403)
        XCTAssertEqual(get("homeeconomics://localhost:8080/index.html").status, 403)
        XCTAssertEqual(get("https://localhost/index.html").status, 403)
    }

    func testTheQueryAndFragmentAreNeverLogged() {
        _ = get("homeeconomics://localhost/openid-cb?token=SECRET-TOKEN#SECRET-FRAG")
        _ = get("homeeconomics://localhost/%2e%2e/Info.plist?token=SECRET-TOKEN#SECRET-FRAG")
        _ = get("homeeconomics://evil.example/x?token=SECRET-TOKEN")
        XCTAssertFalse(logged.isEmpty, "a refused request logs its path")
        for line in logged {
            XCTAssertFalse(line.contains("SECRET"), line)
            XCTAssertFalse(line.contains("token"), line)
        }
    }
}
