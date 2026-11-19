import Foundation

// Fork-only (sc-5296, the Designer's rule on PR 494). While the keyboard is up
// the storage line takes at most a third of the space between the top safe
// area and the keyboard: the full text if it fits, else a one-line short form,
// else nothing. Heights include the line's 8-point margins.
public enum WriteStorageLineFit: Equatable {
    case full, short, hidden

    // Pending the Product Owner's confirmation; this is its only copy
    public static let stillSavingShort = NSLocalizedString(
        "Still saving…", comment: "Native screens, short form while the keyboard is up: a change is not yet stored on this device")

    public static func choose(fullHeight: CGFloat, shortHeight: CGFloat, available: CGFloat) -> Self {
        if fullHeight <= available / 3 { return .full }
        return shortHeight <= available / 3 ? .short : .hidden
    }

    // Story 5383, the Designer's rule: the line hides while a context menu,
    // alert or confirmation is presented, and stays over sheets and full-screen
    // screens. A context menu is presented as neither a sheet nor full screen.
    public static func stepsAside(isAlert: Bool, isSheet: Bool, isFullScreen: Bool) -> Bool {
        isAlert || (!isSheet && !isFullScreen)
    }

    // "Saving…" is already short
    public static func shortForm(of message: String) -> String {
        message == WriteStorageStatus.notYetStoredMessage ? stillSavingShort : message
    }
}
