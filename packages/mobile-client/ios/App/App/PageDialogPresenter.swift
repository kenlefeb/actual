import UIKit

// Fork-only (sc-5399). Shows a page's alert, confirm or prompt in a window of
// its own on the active scene, above the native screens, the notice strip and
// the storage line, so it never lands behind them or on a controller that is
// off screen (Capacitor presents on the bridge's controller, which has no
// window while a native screen shows, so the dialog never appeared and the
// page waited for ever). PageDialogs decides when to answer for the person.
@MainActor
final class PageDialogPresenter {
    private var window: UIWindow?
    private weak var previousKey: UIWindow?

    // Returns how to take the dialog off screen, or nil if it can't show now
    func present(_ request: PageDialogRequest, answer: @escaping @MainActor (PageDialogAnswer) -> Void) -> (() -> Void)? {
        guard window == nil, let scene = Self.activeScene() else { return nil }
        let window = UIWindow(windowScene: scene)
        // Above the storage line (.alert) and the notice strip (.normal + 1)
        window.windowLevel = .alert + 1
        window.backgroundColor = .clear
        window.rootViewController = UIViewController()
        previousKey = scene.windows.first(where: \.isKeyWindow)
        window.makeKeyAndVisible()
        self.window = window

        let alert = UIAlertController(title: request.title, message: request.message, preferredStyle: .alert)
        let ok = NSLocalizedString("OK", comment: "Button in a dialog from the app's page")
        let cancel = NSLocalizedString("Cancel", comment: "Button in a dialog from the app's page")
        switch request.kind {
        case .alert:
            alert.addAction(UIAlertAction(title: ok, style: .default) { [weak self] _ in
                self?.close()
                answer(.dismissed)
            })
        case .confirm:
            alert.addAction(UIAlertAction(title: cancel, style: .cancel) { [weak self] _ in
                self?.close()
                answer(.confirmed(false))
            })
            alert.addAction(UIAlertAction(title: ok, style: .default) { [weak self] _ in
                self?.close()
                answer(.confirmed(true))
            })
        case .prompt(let defaultText):
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: cancel, style: .cancel) { [weak self] _ in
                self?.close()
                answer(.text(nil))
            })
            alert.addAction(UIAlertAction(title: ok, style: .default) { [weak self, weak alert] _ in
                let text = alert?.textFields?.first?.text ?? ""
                self?.close()
                answer(.text(text))
            })
        }
        window.rootViewController?.present(alert, animated: true)
        return { [weak self] in
            self?.window?.rootViewController?.dismiss(animated: true)
            self?.close()
        }
    }

    private func close() {
        window?.isHidden = true
        window = nil
        previousKey?.makeKey()
    }

    private static func activeScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
    }
}
