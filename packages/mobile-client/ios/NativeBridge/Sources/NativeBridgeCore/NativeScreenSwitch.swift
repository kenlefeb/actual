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
}
