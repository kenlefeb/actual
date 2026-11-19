#if DEBUG
import UIKit
import WebKit

// Test-only (sc-5399). `-UITestPageDialog alert|confirm|prompt` makes the app's
// own page open that dialog once it has loaded, and writes on screen what the
// page got back and whether the page still answers afterwards, for
// PageDialogsUITests to read. `-UITestPageDialogCover YES` first presents a
// full-screen native screen, as the native tabs and Reconcile do, so the page's
// own view is not on screen. `-UITestPageDialogReloadAfter N` reloads the page
// N seconds after the dialog opens, as the page going away would. Debug builds only.
@MainActor
enum UITestPageDialogs {
    private static var kind: String? { UserDefaults.standard.string(forKey: "UITestPageDialog") }
    private static var cover: Bool { UserDefaults.standard.bool(forKey: "UITestPageDialogCover") }
    private static var reloadAfter: Double { UserDefaults.standard.double(forKey: "UITestPageDialogReloadAfter") }
    private static var report: UILabel?

    static func startIfRequested(webView: WKWebView, serverURL: URL) {
        guard let kind else { return }
        let page = PageCall(runner: webView, serverURL: serverURL)
        Task {
            await settle(webView)
            if cover { presentCover(over: webView) }
            let script: String
            switch kind {
            case "confirm": script = "return String(confirm('Delete the Groceries category?'))"
            case "prompt": script = "return String(prompt('Name the new category', 'Groceries'))"
            default: script = "alert('We had an unknown problem opening the budget.'); return 'closed'"
            }
            if reloadAfter > 0 {
                Task {
                    try? await Task.sleep(nanoseconds: UInt64(reloadAfter * 1_000_000_000))
                    webView.reload()
                }
            }
            let answer = (try? await page.run(script)) as? String ?? "no answer"
            let after = (try? await page.run("return 'answers'")) as? String ?? "silent"
            show("answer=\(answer) page=\(after)")
        }
    }

    // A full-screen native screen, as a native tab or the Reconcile flow covers the page
    private static func presentCover(over webView: WKWebView) {
        guard var top = webView.window?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let screen = UIViewController()
        screen.view.backgroundColor = .systemBackground
        screen.modalPresentationStyle = .fullScreen
        let label = UILabel()
        label.text = "Native screen"
        label.accessibilityIdentifier = "uiTestDialogCover"
        label.translatesAutoresizingMaskIntoConstraints = false
        screen.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: screen.view.centerXAnchor),
            label.topAnchor.constraint(equalTo: screen.view.safeAreaLayoutGuide.topAnchor, constant: 80),
        ])
        top.present(screen, animated: false)
    }

    private static func settle(_ webView: WKWebView) async {
        for _ in 0..<300 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if !webView.isLoading && webView.url != nil { break }
        }
        // The page's own start-up may still be under way
        try? await Task.sleep(nanoseconds: 2_000_000_000)
    }

    // On whatever is on top, at the bottom of the screen
    private static func show(_ text: String) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: { $0.windowLevel == .normal })?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let label = UILabel(frame: CGRect(x: 0, y: top.view.bounds.height - 120, width: top.view.bounds.width, height: 40))
        label.text = text
        label.font = .systemFont(ofSize: 12)
        label.backgroundColor = .systemBackground
        label.accessibilityIdentifier = "uiTestPageDialog"
        top.view.addSubview(label)
        report = label
    }
}
#endif
