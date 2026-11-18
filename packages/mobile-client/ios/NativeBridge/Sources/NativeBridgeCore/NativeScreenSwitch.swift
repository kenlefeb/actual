import Foundation

// Fork-only (sc-3751). The per-screen switch: a tab shows its native screen
// only while `NativeScreen.<tab>` is on in UserDefaults; unset or off means the
// web screen, exactly as before. Settings flips it through the native chrome plugin.
public enum NativeScreen: Equatable, Sendable { case web, native }

public enum NativeScreenSwitch {
    // Only the Budget tab has a native screen so far
    public static let nativeTabs: Set<NativeTab> = [.budget]

    public static func key(for tab: NativeTab) -> String { "NativeScreen.\(tab.rawValue)" }

    public static func screen(for tab: NativeTab, defaults: UserDefaults = .standard) -> NativeScreen {
        nativeTabs.contains(tab) && defaults.bool(forKey: key(for: tab)) ? .native : .web
    }

    // sc-4341: Schedules & Paychecks is not a tab, so it has its own key
    public static let paychecksKey = "NativeScreen.paychecks"

    public static func isPaychecksNative(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: paychecksKey)
    }

    // sc-4931 (native-accounts-screen D4): the Accounts screen. It reads OFF while unset: the
    // default flips to on in story 3611's PR, which ships the screens. Until then a person can
    // turn it on in Settings; with it off the Accounts tab is the web screens as today.
    public static let accountsKey = "NativeScreen.accounts"

    public static func isAccountsNative(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: accountsKey)
    }

    // sc-4801: the Reconcile flow ships on, so unset reads as on (Ken,
    // 2026-11-15); Settings stores false to turn it off
    public static let reconcileKey = "NativeScreen.reconcile"

    public static func isReconcileNative(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: reconcileKey) == nil || defaults.bool(forKey: reconcileKey)
    }
}

// The script that tells the page which native screens are on, at the start of
// every page load. It is built from the current switch, so the app rebuilds it
// when the switch changes; a reload after a toggle then reads the new value.
// It acts only on the app's own page (PageCall.expectedOrigin, sc-3859), so a
// sign-in page gets nothing; no expected origin means it does nothing.
public enum NativeScreensScript {
    public static func source(defaults: UserDefaults = .standard, expectedOrigin: String?) -> String {
        guard let origin = expectedOrigin, let literal = try? JSONEncoder().encode(origin) else { return "" }
        let screens = NativeTab.allCases.filter(NativeScreenSwitch.nativeTabs.contains).map {
            "\"\($0.rawValue)\": \(NativeScreenSwitch.screen(for: $0, defaults: defaults) == .native)"
        } + [
            "\"accounts\": \(NativeScreenSwitch.isAccountsNative(defaults: defaults))",
            "\"paychecks\": \(NativeScreenSwitch.isPaychecksNative(defaults: defaults))",
            "\"reconcile\": \(NativeScreenSwitch.isReconcileNative(defaults: defaults))",
        ]
        return "if (location.origin === \(String(decoding: literal, as: UTF8.self))) { window.__actualNativeScreens = {\(screens.joined(separator: ", "))}; }"
    }
}
