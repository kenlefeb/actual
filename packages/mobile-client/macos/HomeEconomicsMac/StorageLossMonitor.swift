import Foundation
import NativeBridgeCore

/// The three calls the monitor makes, so a test can use memory instead of a
/// UserDefaults suite (whose plist file outlives it, sc-5025).
protocol RememberedValues {
    func bool(forKey key: String) -> Bool
    func set(_ value: Any?, forKey key: String)
    func removeObject(forKey key: String)
}

extension UserDefaults: RememberedValues {}

// Fork-only (sc-4942, add-mac-app-shell task 1.4a). Remembers, outside the web
// view and never in a log, only that a budget was open and its cloud file id.
// When the page, after startup, says no budget is there while one was
// remembered, the web view's data was cleared: it warns once and forgets.
// A slow start sends no state, so it never warns; a first launch has nothing
// remembered.
final class StorageLossMonitor {
    static let wasOpenKey = "budgetWasOpen"
    static let cloudFileIdKey = "openBudgetCloudFileId"

    private let defaults: RememberedValues
    private let warn: () -> Void

    init(defaults: RememberedValues, warn: @escaping () -> Void) {
        self.defaults = defaults
        self.warn = warn
    }

    var rememberedOpen: Bool { defaults.bool(forKey: Self.wasOpenKey) }

    func handle(_ state: BudgetState) {
        switch state {
        case .open(let cloudFileId):
            defaults.set(true, forKey: Self.wasOpenKey)
            defaults.set(cloudFileId, forKey: Self.cloudFileIdKey)
        case .closed:
            forget()
        case .none:
            guard rememberedOpen else { return }
            forget()
            warn()
        }
    }

    private func forget() {
        defaults.removeObject(forKey: Self.wasOpenKey)
        defaults.removeObject(forKey: Self.cloudFileIdKey)
    }
}
