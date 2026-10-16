import Foundation

/// Navigation-only policy for the free iPhone companion. Customer photo orders,
/// invoices, merchant Connect, and studio/account settings keep their normal path.
/// Web purchase handlers also guard native fetch mutations independently.
enum NativeCompanionPolicy {
    static let platformBillingReturns: Set<String> = [
        "subscription_success", "subscription_cancel", "credits_success", "credits_cancel", "portal"
    ]
    private static let blockedRoutes = [
        "/pricing", "/prices", "/sign-up", "/signup", "/credits", "/dashboard/membership", "/api/stripe/billing"
    ]
    private static let stripePurchaseHosts: Set<String> = ["checkout.stripe.com", "billing.stripe.com", "buy.stripe.com"]

    static func isStudioURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "studiooscloud.com" || host.hasSuffix(".studiooscloud.com")
    }
    static func normalizedPath(_ url: URL) -> String {
        var path = URLComponents(url: url, resolvingAgainstBaseURL: true)?.percentEncodedPath ?? url.path
        // Decode URL spelling without letting encoded slashes or dot segments
        // bypass the same routes the web application will resolve.
        for _ in 0..<3 {
            guard let decoded = path.removingPercentEncoding, decoded != path else { break }
            path = decoded
        }
        var segments: [String] = []
        for segment in path.replacingOccurrences(of: "\\", with: "/").split(separator: "/") {
            if segment == "." { continue }
            if segment == ".." { if !segments.isEmpty { segments.removeLast() }; continue }
            segments.append(String(segment).lowercased())
        }
        return "/" + segments.joined(separator: "/")
    }
    static func hasPlatformBillingReturn(_ url: URL) -> Bool {
        guard let values = URLComponents(url: url, resolvingAgainstBaseURL: true)?.queryItems else { return false }
        return values.contains { $0.name.lowercased() == "billing" && platformBillingReturns.contains(($0.value ?? "").lowercased()) }
    }
    static func isBlockedStudioPage(_ url: URL) -> Bool {
        guard isStudioURL(url) else { return false }
        let path = normalizedPath(url)
        return path == "/dashboard" || blockedRoutes.contains { path == $0 || path.hasPrefix($0 + "/") } || hasPlatformBillingReturn(url)
    }
    private static func isPlatformPurchaseSource(_ url: URL?) -> Bool {
        guard let url = url, isStudioURL(url) else { return false }
        if isBlockedStudioPage(url) { return true }
        // In the current product, the settings screen launches platform plan,
        // credit and billing-portal URLs. Merchant onboarding uses different
        // Stripe hosts and is deliberately outside stripePurchaseHosts.
        return normalizedPath(url) == "/dashboard/settings"
    }
    static func blocks(_ destination: URL, from source: URL? = nil) -> Bool {
        if isBlockedStudioPage(destination) { return true }
        guard let host = destination.host?.lowercased(), stripePurchaseHosts.contains(host) else { return false }
        if isPlatformPurchaseSource(source) || hasPlatformBillingReturn(destination) { return true }
        // An explicit Studio OS return URL identifies the platform flow without
        // treating opaque customer-order Checkout session URLs as subscriptions.
        let returnNames: Set<String> = ["return_url", "returnurl", "success_url", "cancel_url"]
        return (URLComponents(url: destination, resolvingAgainstBaseURL: true)?.queryItems ?? []).contains { item in
            guard returnNames.contains(item.name.lowercased()), let value = item.value, let url = URL(string: value) else { return false }
            return isBlockedStudioPage(url)
        }
    }
}
