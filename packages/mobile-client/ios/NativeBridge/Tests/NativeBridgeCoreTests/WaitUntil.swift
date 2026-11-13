import XCTest

// Fork-only (sc-3947). Yields until `condition` holds, for tests that hold a fake
// transport on a gate. Bounded, so a regression fails the test instead of hanging
// the suite.
struct WaitTimedOut: Error {}

@MainActor
func waitUntil(
    _ what: String, limit: Int = 10_000, file: StaticString = #filePath, line: UInt = #line,
    _ condition: () -> Bool
) async throws {
    for _ in 0..<limit {
        if condition() { return }
        await Task.yield()
    }
    XCTFail("never happened: \(what)", file: file, line: line)
    throw WaitTimedOut()
}
