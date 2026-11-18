import Foundation

// Fork-only (sc-4942, add-mac-app-shell task 1.4a). The page's `budget-state`
// event in the Mac app: `open` or `closed` with the budget's cloud file id (a
// UUID), or `none` with no id. Any other shape, an extra field included, is
// dropped whole, so nothing else of the page's data reaches Swift. Callers
// pass only messages the page origin guard accepted.
public enum BudgetState: Equatable {
    case open(String)
    case closed(String)
    case none

    public static func parse(_ body: Any) -> BudgetState? {
        guard let message = body as? [String: Any], message["event"] as? String == "budget-state",
            let payload = message["payload"] as? [String: Any], let state = payload["state"] as? String
        else { return nil }
        switch state {
        case "none":
            return payload.count == 1 ? BudgetState.none : nil
        case "open", "closed":
            guard payload.count == 2, let id = payload["cloudFileId"] as? String, let uuid = UUID(uuidString: id) else {
                return nil
            }
            let cloudFileId = uuid.uuidString.lowercased()
            return state == "open" ? .open(cloudFileId) : .closed(cloudFileId)
        default:
            return nil
        }
    }
}
