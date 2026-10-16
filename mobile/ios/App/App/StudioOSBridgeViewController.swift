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
    private var companionUIDelegate: StudioOSCompanionUIDelegate?

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let source = """
        (() => {
          window.__STUDIO_OS_NATIVE__ = true;
          const mark = () => {
            if (!document.documentElement) return false;
            document.documentElement.classList.add("studio-os-native");
            return true;
          };
          if (!mark()) {
            const observer = new MutationObserver(() => { if (mark()) observer.disconnect(); });
            observer.observe(document, { childList: true });
          }
        })();
        """
        configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        return super.webView(with: frame, configuration: configuration)
    }
    override func capacitorDidLoad() {
        guard let bridge = bridge as? CapacitorBridge else { return }
        let handler = bridge.webViewDelegationHandler
        let guardHandler = StudioOSCameraMessageGuard(delegate: handler, url: bridge.config.serverURL)
        handler.contentController.removeScriptMessageHandler(forName: "bridge")
        handler.contentController.add(guardHandler, name: "bridge")
        cameraMessageGuard = guardHandler
        bridge.registerPluginInstance(StudioOSCameraPlugin())
        let companion = StudioOSCompanionPlugin()
        bridge.registerPluginInstance(companion)
        let uiDelegate = StudioOSCompanionUIDelegate(original: webView?.uiDelegate, companion: companion)
        companionUIDelegate = uiDelegate
        webView?.uiDelegate = uiDelegate
    }
}
