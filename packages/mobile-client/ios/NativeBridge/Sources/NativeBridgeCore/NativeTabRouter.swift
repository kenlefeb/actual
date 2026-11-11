// Fork-only (sc-3514, ADR 11). The platform-free half of the iPhone tab root
// (NativeTabBarController.swift). One web view serves every web tab, so the
// router remembers each tab's last screen and decides which path to show when
// the user picks a tab, and which tab to select when the page moves to another
// section by itself.
public enum NativeTab: String, CaseIterable, Sendable {
    case budget, accounts, reports, settings

    public var rootPath: String { "/" + rawValue }

    // The tab whose section a path is in; nil for screens that belong to
    // whichever tab opened them, such as a transaction or a category
    public static func owning(path: String) -> NativeTab? {
        path.split(separator: "/").first.flatMap { NativeTab(rawValue: String($0)) }
    }
}

public struct NativeTabRouter: Sendable {
    public static let addPath = "/transactions/new"

    public private(set) var selected: NativeTab = .budget
    private var lastPath: [NativeTab: String] = [:]

    public init() {}

    // The page shows `path`; returns the tab to select if that is a different
    // section's tab
    public mutating func pageDidRoute(to path: String) -> NativeTab? {
        let owner = NativeTab.owning(path: path) ?? selected
        lastPath[owner] = path
        guard owner != selected else { return nil }
        selected = owner
        return owner
    }

    // The user picked `tab`; returns the path the page should show
    public mutating func select(_ tab: NativeTab) -> String {
        selected = tab
        return lastPath[tab] ?? tab.rootPath
    }
}
