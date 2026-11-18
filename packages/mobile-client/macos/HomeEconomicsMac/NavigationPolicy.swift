import Foundation

enum NavigationDecision: Equatable { case allow, cancel, openInBrowser, refuseSignIn }

// Where a navigation started: the page that showed the link
struct PageOrigin: Equatable {
    let scheme: String
    let host: String
    let port: Int
    let isMainFrame: Bool
}

// Fork-only (sc-4942). What may load in the engine's web view: the app's own
// scheme, and https on the sync servers and their OpenID provider (Info.plist
// `HENavigationHosts`). Plain http is never loaded in-frame, so a server
// address typed as http:// is refused. Another https host opens in the
// default browser only for a link the user clicked on the app's own page
// (story 5014); a click on another page is cancelled. A
// redirect, script navigation or form post there is refused (`refuseSignIn`),
// and the app tells the user to sign in with a password.
struct NavigationPolicy {
    let allowedHosts: Set<String>

    static func bundledHosts(_ bundle: Bundle = .main) -> Set<String> {
        Set((bundle.object(forInfoDictionaryKey: "HENavigationHosts") as? [String] ?? []).map { $0.lowercased() })
    }

    func decide(_ url: URL, isMainFrame: Bool, userClicked: Bool, fromAppPage: Bool) -> NavigationDecision {
        let host = url.host?.lowercased() ?? ""
        switch url.scheme?.lowercased() {
        case WWWSchemeHandler.scheme:
            return host == WWWSchemeHandler.host && url.port == nil ? .allow : .cancel
        case "https":
            if allowedHosts.contains(host) && (url.port == nil || url.port == 443) { return .allow }
            guard isMainFrame else { return .cancel }
            // Only a link the user clicked goes to the browser. A redirect,
            // script navigation or form post can carry a sign-in token or code
            // (PR 413 round 3), so it is refused and nothing leaves the app.
            guard userClicked else { return .refuseSignIn }
            // Story 5014: only a link on the app's own page. A click on the
            // provider's or server's page could carry sign-in on in the browser.
            return fromAppPage ? .openInBrowser : .cancel
        case "about":
            // An empty frame the page makes itself
            return url.absoluteString == "about:blank" || url.absoluteString == "about:srcdoc" ? .allow : .cancel
        default:
            return .cancel
        }
    }
}
