import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// mac-app: "Evicted storage is recovered by download, with a warning" (sc-4942 task 1.4a)
final class StorageLossMonitorTests: XCTestCase {
    private let cloud = "7f3c2a1e-9b4d-4c6e-8a2f-0d1e2f3a4b5c"
    private var defaults: UserDefaults!
    private var suite: String!
    private var warnings = 0

    override func setUp() {
        suite = "StorageLossMonitorTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
        warnings = 0
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    // A fresh launch: a new monitor over the same stored values
    private func launch() -> StorageLossMonitor {
        StorageLossMonitor(defaults: defaults) { [unowned self] in self.warnings += 1 }
    }

    func testEvictedStorageAfterAnOpenBudgetWarns() {
        launch().handle(.open(cloud))
        launch().handle(.none)
        XCTAssertEqual(warnings, 1)
    }

    func testTheWarningShowsOnce() {
        launch().handle(.open(cloud))
        launch().handle(.none)
        let next = launch()
        next.handle(.none)
        next.handle(.none)
        XCTAssertEqual(warnings, 1)
    }

    func testAFirstLaunchDoesNotWarn() {
        launch().handle(.none)
        XCTAssertEqual(warnings, 0)
    }

    func testASlowStartDoesNotWarn() {
        launch().handle(.open(cloud))
        _ = launch()
        XCTAssertEqual(warnings, 0)
        XCTAssertTrue(launch().rememberedOpen)
    }

    func testClosingABudgetForgetsIt() {
        let app = launch()
        app.handle(.open(cloud))
        app.handle(.closed(cloud))
        app.handle(.none)
        launch().handle(.none)
        XCTAssertEqual(warnings, 0)
    }

    func testOnlyTheFlagAndTheCloudFileIdAreStored() {
        launch().handle(.open(cloud))
        let stored = defaults.persistentDomain(forName: suite) ?? [:]
        XCTAssertEqual(Set(stored.keys), [StorageLossMonitor.wasOpenKey, StorageLossMonitor.cloudFileIdKey])
        XCTAssertEqual(stored[StorageLossMonitor.cloudFileIdKey] as? String, cloud)
    }
}
