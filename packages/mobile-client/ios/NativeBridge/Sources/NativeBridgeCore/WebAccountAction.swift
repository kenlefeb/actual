import Foundation

// Fork-only (sc-4931, native-accounts-screen D7a). The native Accounts screen
// hands a few things to the web while the screen is on: adding or linking an
// account, an account's settings menu and its bank sync. The chrome sends the
// page one of a closed set of actions, with a known open account for the last
// two; anything else never reaches the page. These are stepping stones until
// sc-4949 and sc-4385 make them native.
public struct WebAccountAction: Equatable {
    static let withoutAccount: Set<String> = ["add-account", "link-account"]
    static let withAccount: Set<String> = ["account-settings", "bank-sync"]

    public let action: String
    // nil for add-account and link-account
    public let accountId: String?

    public init(_ action: String, accountId: String?, openAccountIds: Set<String>) throws {
        if Self.withoutAccount.contains(action) {
            (self.action, self.accountId) = (action, nil)
        } else if Self.withAccount.contains(action), let accountId, openAccountIds.contains(accountId) {
            (self.action, self.accountId) = (action, accountId)
        } else {
            throw NativeBridgeError.invalidWrite("webAccountAction")
        }
    }

    // The one page call this makes: the page checks the shape again
    public var script: String { "window.__actualNativeChrome?.webAccountAction?.(action, accountId)" }

    public var arguments: [String: Any] { ["action": action, "accountId": accountId ?? NSNull()] }
}
