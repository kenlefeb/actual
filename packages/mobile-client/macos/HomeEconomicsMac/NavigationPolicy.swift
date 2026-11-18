import Foundation

enum NavigationDecision: Equatable { case allow, cancel, openInBrowser }

// Fork-only (sc-4942). What may load in the engine's web view: the app's own
// scheme, and https on the sync servers and their OpenID provider (Info.plist
// `HENavigationHosts`). Plain http is never loaded in-frame, so a server
// address typed as http:// is refused. Any other https link opens in the
// default browser from the main frame, and is dropped from a subframe.
struct NavigationPolicy {
    let allowedHosts: Set<String>

    static func bundledHosts(_ bundle: Bundle = .main) -> Set<String> {
        Set((bundle.object(forInfoDictionaryKey: "HENavigationHosts") as? [String] ?? []).map { $0.lowercased() })
    }

    func decide(_ url: URL, isMainFrame: Bool) -> NavigationDecision {
        let host = url.host?.lowercased() ?? ""
        switch url.scheme?.lowercased() {
        case WWWSchemeHandler.scheme:
            return host == WWWSchemeHandler.host && url.port == nil ? .allow : .cancel
        case "https":
            if allowedHosts.contains(host) && (url.port == nil || url.port == 443) { return .allow }
            return isMainFrame ? .openInBrowser : .cancel
        case "about":
            // An empty frame the page makes itself
            return url.absoluteString == "about:blank" || url.absoluteString == "about:srcdoc" ? .allow : .cancel
        default:
            return .cancel
        }
    }
}
