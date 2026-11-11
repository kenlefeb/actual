import UIKit

// Fork-only (sc-3584). Lets Ken run the ADR 11 latency benchmark on his iPhone
// from a TestFlight (Release) build: hold two fingers anywhere for 3 seconds,
// confirm, and the result shows on screen with a Share button.
// - Read-only: it times `native/budget-month` on the open budget through the
//   allowlisted client, and seeds or changes nothing.
// - Never automatic: only this gesture, then a confirmation, starts it. No URL
//   scheme, because any web page or app could open one.
@MainActor
final class NativeBridgeBenchmarkTrigger: NSObject, UIGestureRecognizerDelegate {
    private weak var controller: UIViewController?
    private let client: NativeBridgeClient
    private var running = false

    init(controller: UIViewController, client: NativeBridgeClient) {
        self.controller = controller
        self.client = client
        super.init()
        let press = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
        press.numberOfTouchesRequired = 2
        press.minimumPressDuration = 3
        press.cancelsTouchesInView = false
        press.delegate = self
        controller.view.addGestureRecognizer(press)
    }

    // The web page keeps every touch it would otherwise get
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func pressed(_ press: UILongPressGestureRecognizer) {
        guard press.state == .began, !running else { return }
        let month = NativeBridgeBenchmark.currentMonth()
        present(
            "Native bridge benchmark",
            "Reads this month (\(month)) of the open budget 55 times and shows how long each read takes. Nothing is changed.",
            actions: [
                UIAlertAction(title: "Cancel", style: .cancel),
                UIAlertAction(title: "Run", style: .default) { [weak self] _ in self?.run(month) },
            ]
        )
    }

    private func run(_ month: String) {
        running = true
        // Start only once the alert is up, so dismissing it can't race its presentation
        present("Running…", "About 55 reads of \(month).", actions: []) { [weak self] in self?.measure(month) }
    }

    private func measure(_ month: String) {
        Task {
            let message: String
            do {
                message = try await NativeBridgeBenchmark.run(client: client, month: month).summary
            } catch {
                message = "The benchmark couldn't run: \(error). Open a budget first, then try again."
            }
            running = false
            controller?.dismiss(animated: true) { [weak self] in self?.showResult(message) }
        }
    }

    private func showResult(_ message: String) {
        present("Benchmark result", message, actions: [
            UIAlertAction(title: "Share", style: .default) { [weak self] _ in
                guard let self, let view = self.controller?.view else { return }
                let share = UIActivityViewController(activityItems: [message], applicationActivities: nil)
                share.popoverPresentationController?.sourceView = view
                self.presentWhenFree(share)
            },
            UIAlertAction(title: "Done", style: .cancel),
        ])
    }

    private func present(_ title: String, _ message: String, actions: [UIAlertAction], then: (() -> Void)? = nil) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        actions.forEach(alert.addAction)
        presentWhenFree(alert, then: then)
    }

    // UIKit drops a presentation made while the previous alert is still animating away
    // (gives up after about 3 seconds if something else stays on screen)
    private func presentWhenFree(_ next: UIViewController, then: (() -> Void)? = nil, tries: Int = 30) {
        guard let controller else { return }
        if controller.transitionCoordinator != nil || controller.presentedViewController != nil {
            guard tries > 0 else { running = false; return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.presentWhenFree(next, then: then, tries: tries - 1)
            }
        } else {
            controller.present(next, animated: true, completion: then)
        }
    }
}
