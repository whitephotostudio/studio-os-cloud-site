import Capacitor
import WebKit

// Capacitor calls do not expose WKFrameInfo to individual plugins. Check the
// originating frame before forwarding camera calls into the normal bridge.
private final class StudioOSCameraMessageGuard: NSObject, WKScriptMessageHandler {
    weak var delegate: WebViewDelegationHandler?
    let host: String
    let port: Int
    init(delegate: WebViewDelegationHandler, url: URL) {
        self.delegate = delegate; host = url.host ?? ""; port = url.port ?? 443
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any], body["pluginId"] as? String == "StudioOSCamera" {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame, origin.protocol == "https", origin.host == host,
                  (origin.port == 0 ? 443 : origin.port) == port else { return }
        }
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

final class StudioOSBridgeViewController: CAPBridgeViewController {
    private var cameraMessageGuard: StudioOSCameraMessageGuard?
    override func capacitorDidLoad() {
        guard let bridge = bridge as? CapacitorBridge else { return }
        let handler = bridge.webViewDelegationHandler
        let guardHandler = StudioOSCameraMessageGuard(delegate: handler, url: bridge.config.serverURL)
        handler.contentController.removeScriptMessageHandler(forName: "bridge")
        handler.contentController.add(guardHandler, name: "bridge")
        cameraMessageGuard = guardHandler
        bridge.registerPluginInstance(StudioOSCameraPlugin())
    }
}
