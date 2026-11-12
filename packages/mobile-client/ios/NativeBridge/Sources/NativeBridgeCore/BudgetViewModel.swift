import Combine
import Foundation

// Fork-only (sc-3751, native-budget-screen spec). The read-only Budget tab's
// state. It holds the month exactly as loot-core returned it; the SwiftUI view
// renders those numbers and never adds them up.
public enum BudgetLoadError: Equatable {
    case timedOut
    case message(String)
}

public enum BudgetLoadState: Equatable {
    case loading
    case loaded(BudgetMonth)
    case failed(BudgetLoadError)
    // Tracking budgets show the web Budget screen until sc-3778 builds them
    case useWebScreen
}

@MainActor
public final class BudgetViewModel: ObservableObject {
    @Published public private(set) var state: BudgetLoadState = .loading
    public let month: String
    private let client: NativeBridgeClient

    public init(client: NativeBridgeClient, month: String) {
        self.client = client
        self.month = month
    }

    // Also the retry action of the error state
    public func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let result = try await client.budgetMonth(month)
            state = result.budgetType == .tracking ? .useWebScreen : .loaded(result)
        } catch NativeBridgeError.timedOut {
            state = .failed(.timedOut)
        } catch {
            state = .failed(.message(String(describing: error)))
        }
    }

    public static func currentMonth(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month], from: now)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
