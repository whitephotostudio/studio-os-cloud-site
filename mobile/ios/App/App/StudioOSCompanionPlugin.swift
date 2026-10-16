import Capacitor
import UIKit
import WebKit

/// Public Capacitor navigation hook; does not expose another JavaScript API.
@objc(StudioOSCompanionPlugin)
final class StudioOSCompanionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "StudioOSCompanionPlugin"
    let jsName = "StudioOSCompanion"
    let pluginMethods: [CAPPluginMethod] = []
    private var navigationObserver: NSKeyValueObservation?
    private var lastAllowedURL: URL?
    private var returningHome = false
    private var lastNotice = Date.distantPast

    override func load() {
        navigationObserver = bridge?.webView?.observe(\.url, options: [.new]) { [weak self] webView, _ in
            guard let self = self, let url = webView.url else { return }
            // Next.js client transitions use history rather than a document
            // navigation. Observe the committed URL as a second native boundary.
            if NativeCompanionPolicy.blocks(url, from: self.lastAllowedURL) {
                guard !self.returningHome else { return }
                self.returningHome = true
                DispatchQueue.main.async { [weak self, weak webView] in
                    guard let self = self, let webView = webView else { return }
                    if let origin = self.bridge?.config.serverURL, let home = URL(string: "/m", relativeTo: origin)?.absoluteURL {
                        webView.load(URLRequest(url: home))
                    }
                    self.returningHome = false
                    self.explainUnavailableScreen()
                }
            } else {
                self.lastAllowedURL = url
            }
        }
    }
    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let destination = navigationAction.request.url else { return nil }
        let source = sourceURL(for: navigationAction)
        guard NativeCompanionPolicy.blocks(destination, from: source) else { return nil }
        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            explainUnavailableScreen()
        }
        return NSNumber(value: true)
    }
    func blocksNewWindow(_ action: WKNavigationAction) -> Bool {
        guard let url = action.request.url else { return false }
        return NativeCompanionPolicy.blocks(url, from: sourceURL(for: action))
    }
    private func sourceURL(for action: WKNavigationAction) -> URL? {
        // The originating frame request can retain its first document URL across
        // Next.js history transitions; prefer the observed current main page.
        if action.sourceFrame.isMainFrame { return lastAllowedURL ?? bridge?.webView?.url ?? action.sourceFrame.request.url }
        return action.sourceFrame.request.url ?? lastAllowedURL
    }
    func explainUnavailableScreen() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, Date().timeIntervalSince(self.lastNotice) > 1,
                  UIApplication.shared.applicationState == .active,
                  let controller = self.bridge?.viewController, controller.presentedViewController == nil else { return }
            self.lastNotice = Date()
            let alert = UIAlertController(title: "Studio OS", message: "This screen isn’t available in Studio OS for iPhone.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            controller.present(alert, animated: true)
        }
    }
}

/// Capacitor normally opens target=_blank URLs directly in the system browser.
/// Apply the same policy first, forwarding other documented WKUIDelegate calls.
final class StudioOSCompanionUIDelegate: NSObject, WKUIDelegate {
    weak var original: WKUIDelegate?
    weak var companion: StudioOSCompanionPlugin?
    init(original: WKUIDelegate?, companion: StudioOSCompanionPlugin) {
        self.original = original; self.companion = companion
    }
    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || original?.responds(to: aSelector) == true
    }
    override func forwardingTarget(for aSelector: Selector!) -> Any? { original }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if companion?.blocksNewWindow(navigationAction) == true {
            companion?.explainUnavailableScreen()
            return nil
        }
        return original?.webView?(webView, createWebViewWith: configuration, for: navigationAction, windowFeatures: windowFeatures)
    }
}
