import Foundation

@main
struct NativeCompanionPolicyTests {
    static func main() {
        struct Case: Decodable {
            let destination: String
            let source: String?
            let blocked: Bool
        }
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("native-companion-routes.json")
        guard let data = try? Data(contentsOf: fixtureURL), let cases = try? JSONDecoder().decode([Case].self, from: data), !cases.isEmpty else {
            print("FAIL: native companion route fixtures could not be read")
            exit(1)
        }
        var failures = 0
        for fixture in cases {
            let destination = fixture.destination, source = fixture.source, expected = fixture.blocked
            let value = NativeCompanionPolicy.blocks(URL(string: destination)!, from: source.flatMap(URL.init(string:)))
            if value != expected { failures += 1; print("FAIL: \(destination) from \(source ?? "nil") expected \(expected), got \(value)") }
        }
        print("NativeCompanionPolicy: \(cases.count) navigation cases, \(failures) failures")
        if failures > 0 { exit(1) }
    }
}
