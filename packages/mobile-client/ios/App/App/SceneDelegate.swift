import UIKit
import Capacitor

// Apps built with the iOS 27 SDK must use the scene life cycle or they do not
// launch. The window's root is the native tab bar (sc-3514), which owns the
// app's one bridge view controller; URL opens are forwarded to Capacitor so the
// App plugin keeps receiving them.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?
    private var backgroundFlush: BackgroundFlush<UIBackgroundTaskIdentifier>?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        #if DEBUG
        // Test-only (sc-5177): the UI tests launch the Accounts screen on fixtures
        if UITestAccounts.isOn {
            window.rootViewController = UITestAccounts.makeRoot()
            self.window = window
            window.makeKeyAndVisible()
            return
        }
        #endif
        let root = NativeTabBarController()
        // sc-5219 (D8): this app uses scenes, so this is where it learns it is going away
        let client = root.bridgeController.nativeBridge.client
        backgroundFlush = BackgroundFlush(
            begin: { onExpiry in
                UIApplication.shared.beginBackgroundTask(withName: "store-changes") { MainActor.assumeIsolated(onExpiry) }
            },
            end: { UIApplication.shared.endBackgroundTask($0) },
            flush: { _ = await client.flushStorage() })
        window.rootViewController = root
        self.window = window
        window.makeKeyAndVisible()
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        backgroundFlush?.run()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

}
